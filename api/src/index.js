import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { inferCategory } from './categories.js';
import { buildInsights } from './insights.js';
import { aiAlertConfigured, classifySpendAlert } from './alert-ai.js';
import { validMonthKey, validateTransactionInput } from './request-validation.js';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));

const supabaseUrl = process.env.SUPABASE_URL;
function resolveSupabasePublicKey(namedKeys) {
  if (namedKeys) {
    try {
      const parsed = JSON.parse(namedKeys);
      const defaultKey = parsed && typeof parsed === 'object' && typeof parsed.default === 'string'
        ? parsed.default.trim()
        : '';
      if (defaultKey) return defaultKey;
    } catch {
      // Fall through to the legacy project-scoped public key below.
    }
  }
  return process.env.SUPABASE_ANON_KEY?.trim() || process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || '';
}
const supabaseKey = resolveSupabasePublicKey(process.env.SUPABASE_PUBLISHABLE_KEYS);
const authClient = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
}) : null;
const aiRequestWindows = new Map();

function tokenIssuer(token) {
  try {
    const payload = token.split('.')[1];
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof claims.iss === 'string' ? new URL(claims.iss).origin : null;
  } catch { return null; }
}

function authFailure(error) {
  const detail = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
  if (/invalid api key|invalid apikey|api key not found|project ref/.test(detail)) {
    return { status: 503, code: 'SUPABASE_API_KEY_MISMATCH', error: 'The spending API key is invalid for this Supabase project. Update the server key to match SUPABASE_URL.' };
  }
  if (Number(error?.status) >= 500 || !error?.status) {
    return { status: 503, code: 'AUTH_SERVICE_UNAVAILABLE', error: 'Supabase could not verify the session just now. Your local data is safe; try syncing again shortly.' };
  }
  return { status: 401, code: 'INVALID_SESSION', error: 'Supabase rejected this sign-in session. Refresh your sign-in, then retry cloud sync.' };
}

function allowAiRequest(userId) {
  const now = Date.now();
  const current = aiRequestWindows.get(userId);
  if (!current || now - current.startedAt >= 60_000) {
    aiRequestWindows.set(userId, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= 10) return false;
  current.count += 1;
  return true;
}

async function requireUser(req, res, next) {
  const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Sign in to access your spending data.' });
  if (!authClient) return res.status(503).json({ code: 'AUTH_SERVER_NOT_CONFIGURED', error: 'The spending API is missing its Supabase URL or public API key.' });
  let expectedIssuer = null;
  try { expectedIssuer = new URL(supabaseUrl).origin; } catch { /* Supabase configuration is checked below. */ }
  const issuer = tokenIssuer(token);
  if (issuer && expectedIssuer && issuer !== expectedIssuer) {
    return res.status(401).json({ code: 'AUTH_PROJECT_MISMATCH', error: 'This sign-in belongs to a different Supabase project than the spending API. Point the app and API at the same project, then sign in again.' });
  }
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    const failure = authFailure(error ?? { status: 401 });
    return res.status(failure.status).json({ code: failure.code, error: failure.error });
  }
  req.user = data.user;
  req.db = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  next();
}

app.get('/health', async (_req, res) => {
  res.json({ status: 'ok', database: authClient ? 'configured' : 'unconfigured' });
});

app.get('/api/transactions', requireUser, async (req, res, next) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  try {
    const { data, error } = await req.db.from('transactions')
      .select('id, client_ref, amount_paise, description, merchant, category, payment_method, transaction_type, transaction_date, transaction_at')
      .eq('user_id', req.user.id).order('transaction_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw error;
    res.json(data);
  } catch (error) { next(error); }
});

app.get('/api/alerts/ai-status', requireUser, (_req, res) => {
  res.json({ enabled: aiAlertConfigured() });
});

app.post('/api/alerts/classify', requireUser, async (req, res) => {
  if (!aiAlertConfigured()) return res.status(503).json({ error: 'Optional AI alert review is not configured.' });
  const { text, source } = req.body ?? {};
  if (typeof text !== 'string' || !text.trim() || text.length > 1200 || (source != null && typeof source !== 'string')) {
    return res.status(400).json({ error: 'Provide a short readable alert and source app.' });
  }
  if (!allowAiRequest(req.user.id)) return res.status(429).json({ error: 'AI alert review is temporarily rate limited. Try again in a minute.', retryAfterSeconds: 60 });
  try {
    const { data: quota, error: quotaError } = await req.db.rpc('consume_spending_ai_request');
    if (quotaError) {
      console.error('AI usage quota is unavailable:', quotaError.message);
      return res.status(503).json({ error: 'AI usage protection is not installed. Apply migration 004 before enabling cloud AI.' });
    }
    const budget = Array.isArray(quota) ? quota[0] : quota;
    if (!budget?.allowed) return res.status(429).json({ error: 'Daily AI review limit reached. It will be available again tomorrow.', retryAfterSeconds: Number(budget?.retry_after_seconds) || 3600 });
    res.json(await classifySpendAlert({ text, source: source || 'Android app' }));
  } catch (error) {
    console.error('AI alert classification failed:', error.message);
    res.status(502).json({ error: 'Could not classify this alert. It remains on this device.' });
  }
});

app.post('/api/transactions', requireUser, async (req, res, next) => {
  const validation = validateTransactionInput(req.body);
  if (validation.error) return res.status(400).json({ error: validation.error });
  const { clientRef, amountPaise, description, merchant, category, paymentMethod, transactionType, date, transactionAt } = validation.value;
  const finalCategory = inferCategory(description, category, merchant);
  const transaction = {
    user_id: req.user.id, client_ref: clientRef || null, amount_paise: amountPaise,
    description: description.trim(), merchant: merchant?.trim() || null,
    category: finalCategory, payment_method: paymentMethod, transaction_type: transactionType, transaction_date: date || undefined,
    transaction_at: transactionAt || undefined,
  };
  try {
    const query = clientRef
      ? req.db.from('transactions').upsert(transaction, { onConflict: 'user_id,client_ref' })
      : req.db.from('transactions').insert(transaction);
    const { data, error } = await query.select('id, client_ref, amount_paise, description, merchant, category, payment_method, transaction_type, transaction_date, transaction_at').single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) { next(error); }
});

app.delete('/api/transactions', requireUser, async (req, res, next) => {
  try {
    const { error } = await req.db.from('transactions').delete().eq('user_id', req.user.id);
    if (error) throw error;
    res.status(204).end();
  } catch (error) { next(error); }
});

app.delete('/api/transactions/:id', requireUser, async (req, res, next) => {
  try {
    const { data, error } = await req.db.from('transactions').delete().eq('id', req.params.id)
      .eq('user_id', req.user.id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Transaction not found.' });
    res.status(204).end();
  } catch (error) { next(error); }
});

app.get('/api/summary', requireUser, async (req, res, next) => {
  const requestedMonth = req.query.month;
  if (requestedMonth != null && !validMonthKey(requestedMonth)) return res.status(400).json({ error: 'Month must use YYYY-MM and be a real calendar month.' });
  const month = requestedMonth || new Date().toISOString().slice(0, 7);
  const [year, monthNumber] = month.split('-').map(Number);
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  try {
    const { data, error } = await req.db.from('transactions').select('category, amount_paise, transaction_type')
      .eq('user_id', req.user.id).gte('transaction_date', `${month}-01`).lt('transaction_date', nextMonth);
    if (error) throw error;
    const totals = new Map();
    for (const item of data) {
      const category = totals.get(item.category) || { category: item.category, total_paise: 0, transaction_count: 0 };
      if (item.transaction_type === 'expense') category.total_paise += Number(item.amount_paise);
      else if (item.transaction_type === 'refund') category.total_paise -= Number(item.amount_paise);
      if (item.transaction_type === 'expense' || item.transaction_type === 'refund') category.transaction_count += 1;
      totals.set(item.category, category);
    }
    const categories = [...totals.values()].filter(row => row.total_paise > 0).sort((a, b) => b.total_paise - a.total_paise);
    const totalPaise = Math.max(0, categories.reduce((sum, row) => sum + row.total_paise, 0));
    res.json({ month, totalPaise, categories, insights: buildInsights(categories) });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error('Paisa Pilot API request failed:', error.message);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
  res.status(status).json({ error: status < 500 ? 'The request body or parameters are invalid.' : 'The spending service could not complete that request.' });
});

const port = Number(process.env.PORT) || 4000;
const server = app.listen(port, '0.0.0.0', () => console.log(`Paisa Pilot API listening on 0.0.0.0:${port}`));

process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
