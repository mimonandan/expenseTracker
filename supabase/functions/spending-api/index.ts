import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

const categoryRules: [string, RegExp][] = [
  ['Groceries', /grocery|supermarket|vegetable|veggie|fruit|milk|dairy|kirana|bigbasket|blinkit|zepto|instamart/i],
  ['Daily essentials', /pharmacy|chemist|household|cleaning|personal care|toiletries|medicine/i],
  ['Dining & outings', /restaurant|cafe|food|dining|swiggy|zomato|district|outing|bar|pizza/i],
  ['Transport', /uber|ola|metro|fuel|petrol|cab|bus|train|parking/i],
  ['Entertainment', /movie|cinema|book\s?my\s?show|netflix|hotstar|spotify|prime video|youtube|game|concert/i],
  ['Shopping', /myntra|fashion|clothing|shopping/i],
  ['Bills & utilities', /electricity|water bill|internet|broadband|mobile recharge|gas bill/i],
  ['Loan & EMI', /loan|emi|installment|mortgage/i],
];

function inferCategory(description: string, requested?: string) {
  if (requested && requested !== 'Auto-detect') return requested;
  return categoryRules.find(([, pattern]) => pattern.test(description))?.[0] ?? 'Other';
}

function buildInsights(rows: { category: string; total_paise: number }[]) {
  const totals = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    total += Number(row.total_paise);
    totals.set(row.category, (totals.get(row.category) ?? 0) + Number(row.total_paise));
  }
  if (!total) return [{ title: 'Start with one small step', body: 'Add a few expenses to see where your money goes and get tailored ideas.', tone: 'calm' }];

  const discretionary = ['Dining & outings', 'Entertainment', 'Shopping']
    .reduce((sum, category) => sum + (totals.get(category) ?? 0), 0);
  const suggestions: { title: string; body: string; tone: string }[] = [];
  if (discretionary / total > 0.28) {
    suggestions.push({
      title: 'Pick a weekly fun budget',
      body: `${Math.round(discretionary / total * 100)}% of this month's tracked spend is in dining, entertainment, or shopping. A weekly cap could help you keep the plans you value and trim the rest.`,
      tone: 'warm',
    });
  }
  const biggest = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
  if (biggest && suggestions.length < 2) {
    suggestions.push({
      title: `Review ${biggest[0].toLowerCase()} spending`,
      body: `It's your largest tracked category this month. Check for subscriptions, duplicate purchases, or a cheaper plan that still works for you.`,
      tone: 'calm',
    });
  }
  if (!suggestions.length) suggestions.push({ title: 'A steady month so far', body: 'Your tracked spending is spread across categories. Keep logging purchases to spot patterns over time.', tone: 'calm' });
  return suggestions;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const authHeader = request.headers.get('authorization');
  if (!supabaseUrl || !supabaseKey) return json({ error: 'Spending service is not configured.' }, 503);

  const url = new URL(request.url);
  const route = url.searchParams.get('route') || url.pathname.split('/spending-api').pop() || '/';
  if (route === '/health' && request.method === 'GET') return json({ status: 'ok', database: 'configured' });
  if (!authHeader?.match(/^Bearer\s+.+$/i)) return json({ error: 'Sign in to access your spending data.' }, 401);

  const authClient = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const { data: userData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !userData.user) return json({ error: 'Your session is invalid or expired. Sign in again.' }, 401);

  const userDb = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  try {
    if (route === '/api/transactions' && request.method === 'GET') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 500);
      const { data, error } = await userDb.from('transactions')
        .select('id, client_ref, amount_paise, description, merchant, category, payment_method, transaction_date')
        .eq('user_id', userData.user.id).order('transaction_date', { ascending: false })
        .order('id', { ascending: false }).limit(limit);
      if (error) throw error;
      return json(data);
    }

    if (route === '/api/transactions' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const { id: clientRef, amount, description, merchant = null, category = 'Auto-detect', paymentMethod = 'Other', date } = body;
      const amountPaise = Math.round(Number(amount) * 100);
      if (!Number.isFinite(amountPaise) || amountPaise <= 0 || !description?.trim()) {
        return json({ error: 'Enter a positive amount and a description.' }, 400);
      }
      const transaction = {
        user_id: userData.user.id, client_ref: clientRef || null, amount_paise: amountPaise,
        description: description.trim(), merchant: merchant?.trim() || null,
        category: inferCategory(description, category), payment_method: paymentMethod, transaction_date: date || undefined,
      };
      const query = clientRef
        ? userDb.from('transactions').upsert(transaction, { onConflict: 'user_id,client_ref' })
        : userDb.from('transactions').insert(transaction);
      const { data, error } = await query.select('id, client_ref, amount_paise, description, merchant, category, payment_method, transaction_date').single();
      if (error) throw error;
      return json(data, 201);
    }

    const deleteMatch = route.match(/^\/api\/transactions\/([^/]+)$/);
    if (deleteMatch && request.method === 'DELETE') {
      const { data, error } = await userDb.from('transactions').delete().eq('id', deleteMatch[1])
        .eq('user_id', userData.user.id).select('id').maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'Transaction not found.' }, 404);
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (route === '/api/summary' && request.method === 'GET') {
      const requestedMonth = url.searchParams.get('month') ?? '';
      const month = /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : new Date().toISOString().slice(0, 7);
      const [year, monthNumber] = month.split('-').map(Number);
      const nextMonth = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
      const { data, error } = await userDb.from('transactions').select('category, amount_paise')
        .eq('user_id', userData.user.id).gte('transaction_date', `${month}-01`).lt('transaction_date', nextMonth);
      if (error) throw error;
      const totals = new Map<string, { category: string; total_paise: number; transaction_count: number }>();
      for (const item of data ?? []) {
        const category = totals.get(item.category) ?? { category: item.category, total_paise: 0, transaction_count: 0 };
        category.total_paise += Number(item.amount_paise);
        category.transaction_count += 1;
        totals.set(item.category, category);
      }
      const categories = [...totals.values()].sort((a, b) => b.total_paise - a.total_paise);
      const totalPaise = categories.reduce((sum, row) => sum + row.total_paise, 0);
      return json({ month, totalPaise, categories, insights: buildInsights(categories) });
    }

    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    console.error('Paisa Pilot API request failed:', error instanceof Error ? error.message : error);
    return json({ error: 'The spending service could not complete that request.' }, 500);
  }
});
