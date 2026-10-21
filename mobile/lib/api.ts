const API_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, '');
const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
export const apiConfigured = Boolean(API_URL);

export type ApiTransaction = {
  id: number | string;
  client_ref: string | null;
  amount_paise: number | string;
  description: string;
  merchant: string | null;
  category: string;
  payment_method: string;
  transaction_date: string;
};

export type ApiSummary = {
  month: string;
  totalPaise: number;
  categories: { category: string; total_paise: number | string; transaction_count: number }[];
  insights: { title: string; body: string; tone: 'calm' | 'warm' }[];
};

async function request<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  if (!API_URL) throw new Error('Add EXPO_PUBLIC_API_URL to connect the spending API.');
  const endpoint = API_URL.includes('/functions/v1/spending-api')
    ? `${API_URL}?route=${encodeURIComponent(path)}`
    : `${API_URL}${path}`;
  const response = await fetch(endpoint, {
    ...options,
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, ...options.headers },
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `API request failed (${response.status}).`);
  }
  return response.status === 204 ? undefined as T : response.json();
}

export const getTransactions = (token: string) => request<ApiTransaction[]>('/api/transactions', token);
export const getMonthlySummary = (token: string) => request<ApiSummary>('/api/summary', token);
export const createTransaction = (token: string, item: { id: string; amount: number; description: string; category: string; paymentMethod: string; date: string }) =>
  request<ApiTransaction>('/api/transactions', token, { method: 'POST', body: JSON.stringify(item) });
