import { supabase } from './supabase';

const API_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');
const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
const AUTH_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const isSupabaseFunction = /\/functions\/v1\/spending-api(?:$|\/)/.test(API_URL);

function projectRef(value: string) {
  try {
    return new URL(value).hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i)?.[1]?.toLowerCase() ?? null;
  } catch { return null; }
}

const authProjectRef = projectRef(AUTH_SUPABASE_URL);
const apiProjectRef = projectRef(API_URL);
export const apiConfigurationIssue = !API_URL
  ? 'Cloud API URL is missing from this app session. Add EXPO_PUBLIC_API_URL to mobile/.env, then restart Expo.'
  : isSupabaseFunction && !SUPABASE_PUBLISHABLE_KEY
    ? 'Supabase publishable key is missing. Add EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY to mobile/.env, then restart Expo.'
    : isSupabaseFunction && authProjectRef && apiProjectRef && authProjectRef !== apiProjectRef
      ? 'The sign-in and spending API use different Supabase projects. Set both URLs to the same project, then restart Expo.'
      : null;
export const apiConfigured = !apiConfigurationIssue;

export type ApiTransaction = {
  id: number | string;
  client_ref: string | null;
  amount_paise: number | string;
  description: string;
  merchant: string | null;
  category: string;
  payment_method: string;
  transaction_type: 'expense' | 'refund' | 'transfer' | 'income';
  transaction_date: string;
  transaction_at: string;
};

export type ApiSummary = {
  month: string;
  totalPaise: number;
  categories: { category: string; total_paise: number | string; transaction_count: number }[];
  insights: { title: string; body: string; tone: 'calm' | 'warm' }[];
};

export type AiAlertClassification = {
  eventType: 'expense' | 'transfer' | 'income' | 'offer' | 'refund' | 'estimate' | 'payment_due' | 'not_transaction' | 'uncertain';
  amount: number | null;
  currency: 'INR' | 'Other';
  merchant: string | null;
  category: string;
  categoryConfidence?: number;
  confidence: number;
  evidence: string;
  shouldReview: boolean;
};

async function request<T>(path: string, token: string, options: RequestInit = {}, allowSessionRefresh = true): Promise<T> {
  if (apiConfigurationIssue) throw Object.assign(new Error(apiConfigurationIssue), { code: 'API_CONFIGURATION' });
  const queryStart = path.indexOf('?');
  const route = queryStart < 0 ? path : path.slice(0, queryStart);
  const query = queryStart < 0 ? '' : path.slice(queryStart + 1);
  const endpoint = API_URL.includes('/functions/v1/spending-api')
    ? `${API_URL}?route=${encodeURIComponent(route)}${query ? `&${query}` : ''}`
    : `${API_URL}${path}`;
  const response = await fetch(endpoint, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(SUPABASE_PUBLISHABLE_KEY ? { apikey: SUPABASE_PUBLISHABLE_KEY } : {}),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    let result: { error?: string; message?: string; code?: string; retryAfterSeconds?: number } = {};
    try { result = JSON.parse(responseText); } catch { /* Some gateways return plain text. */ }
    const gatewayRejectedToken = response.status === 401
      && (result.code === 'UNAUTHORIZED_ASYMMETRIC_JWT' || /invalid jwt|asymmetric jwt/i.test(result.message || responseText));
    const projectMismatch = result.code === 'AUTH_PROJECT_MISMATCH' || result.code === 'SUPABASE_API_KEY_MISMATCH';
    if (response.status === 401 && allowSessionRefresh && !gatewayRejectedToken && !projectMismatch && supabase) {
      const { data, error } = await supabase.auth.refreshSession();
      const refreshedToken = data.session?.access_token;
      if (!error && refreshedToken && refreshedToken !== token) return request<T>(path, refreshedToken, options, false);
    }
    const legacySessionFailure = response.status === 401 && /session is invalid or expired/i.test(result.error || result.message || responseText);
    const message = gatewayRejectedToken
      ? 'The Supabase function gateway rejected this token before the API could verify it. Disable the legacy Verify JWT check for spending-api; the function still checks the user session with Supabase Auth.'
      : response.status === 404
        ? 'The configured spending API does not include this route yet. Update the API to the current source; local alert matching still works.'
        : legacySessionFailure
          ? 'The running API rejected this sign-in. Confirm its Supabase URL and public key match the app, then update or restart it. If those already match, sign out and back in.'
          : result.error || result.message || `API request failed (${response.status}).`;
    throw Object.assign(new Error(message), {
      status: response.status,
      code: result.code || (gatewayRejectedToken ? 'AUTH_GATEWAY_REJECTED' : undefined),
      retryAfterSeconds: Number(result.retryAfterSeconds) || undefined,
    });
  }
  return response.status === 204 ? undefined as T : response.json();
}

export const getTransactions = async (token: string) => {
  const rows: ApiTransaction[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const page = await request<ApiTransaction[]>(`/api/transactions?limit=${pageSize}&offset=${offset}`, token);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
};
export const getMonthlySummary = (token: string, month?: string) => request<ApiSummary>(`/api/summary${month ? `?month=${encodeURIComponent(month)}` : ''}`, token);
export const getAiAlertStatus = (token: string) => request<{ enabled: boolean }>('/api/alerts/ai-status', token);
export const classifySpendAlert = (token: string, item: { text: string; source: string }) =>
  request<AiAlertClassification>('/api/alerts/classify', token, { method: 'POST', body: JSON.stringify(item) });
export const createTransaction = (token: string, item: { id: string; amount: number; description: string; category: string; paymentMethod: string; transactionType?: 'expense' | 'refund' | 'transfer' | 'income'; date: string; transactionAt?: string }) =>
  request<ApiTransaction>('/api/transactions', token, { method: 'POST', body: JSON.stringify(item) });
export const deleteAllTransactions = (token: string) => request<void>('/api/transactions', token, { method: 'DELETE' });
