import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { inferCategory } from './categories.js';
import { buildInsights } from './insights.js';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const authClient = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
}) : null;

async function requireUser(req, res, next) {
  const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !authClient) return res.status(401).json({ error: 'Sign in to access your spending data.' });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Your session is invalid or expired. Sign in again.' });
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
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  try {
    const { data, error } = await req.db.from('transactions')
      .select('id, client_ref, amount_paise, description, merchant, category, payment_method, transaction_date')
      .eq('user_id', req.user.id).order('transaction_date', { ascending: false }).order('id', { ascending: false }).limit(limit);
    if (error) throw error;
    res.json(data);
  } catch (error) { next(error); }
});

app.post('/api/transactions', requireUser, async (req, res, next) => {
  const { id: clientRef, amount, description, merchant = null, category = 'Auto-detect', paymentMethod = 'Other', date } = req.body ?? {};
  const amountPaise = Math.round(Number(amount) * 100);
  if (!Number.isFinite(amountPaise) || amountPaise <= 0 || !description?.trim()) {
    return res.status(400).json({ error: 'Enter a positive amount and a description.' });
  }
  const finalCategory = inferCategory(description, category);
  const transaction = {
    user_id: req.user.id, client_ref: clientRef || null, amount_paise: amountPaise,
    description: description.trim(), merchant: merchant?.trim() || null,
    category: finalCategory, payment_method: paymentMethod, transaction_date: date || undefined,
  };
  try {
    const query = clientRef
      ? req.db.from('transactions').upsert(transaction, { onConflict: 'user_id,client_ref' })
      : req.db.from('transactions').insert(transaction);
    const { data, error } = await query.select('id, client_ref, amount_paise, description, merchant, category, payment_method, transaction_date').single();
    if (error) throw error;
    res.status(201).json(data);
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
  const month = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const [year, monthNumber] = month.split('-').map(Number);
  const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  try {
    const { data, error } = await req.db.from('transactions').select('category, amount_paise')
      .eq('user_id', req.user.id).gte('transaction_date', `${month}-01`).lt('transaction_date', nextMonth);
    if (error) throw error;
    const totals = new Map();
    for (const item of data) {
      const category = totals.get(item.category) || { category: item.category, total_paise: 0, transaction_count: 0 };
      category.total_paise += Number(item.amount_paise);
      category.transaction_count += 1;
      totals.set(item.category, category);
    }
    const categories = [...totals.values()].sort((a, b) => b.total_paise - a.total_paise);
    const totalPaise = categories.reduce((sum, row) => sum + row.total_paise, 0);
    res.json({ month, totalPaise, categories, insights: buildInsights(categories) });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error('Paisa Pilot API request failed:', error.message);
  res.status(500).json({ error: 'The spending service could not complete that request.' });
});

const port = Number(process.env.PORT) || 4000;
const server = app.listen(port, '0.0.0.0', () => console.log(`Paisa Pilot API listening on 0.0.0.0:${port}`));

process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
