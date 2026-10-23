import type { Obligation } from './budget';

export type StoredTransaction = {
  id: string;
  description: string;
  category: string;
  amount: number;
  date: string;
  method: string;
  icon: string;
  color: string;
  transactionType: 'expense' | 'refund' | 'transfer' | 'income';
};

const transactionTypes = new Set(['expense', 'refund', 'transfer', 'income']);
const finitePositive = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export function normalizeTransactions(value: unknown): StoredTransaction[] {
  if (!Array.isArray(value)) return [];
  const rows: StoredTransaction[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const row = candidate as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const description = typeof row.description === 'string' ? row.description.trim() : '';
    const date = typeof row.date === 'string' ? row.date : '';
    const amount = finitePositive(row.amount);
    const category = typeof row.category === 'string' && row.category.trim().length <= 40 ? row.category.trim() : 'Other';
    if (!id || !description || !date || !Number.isFinite(new Date(date).getTime()) || amount == null || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id, description, category: category || 'Other', amount, date,
      method: typeof row.method === 'string' && row.method.trim() ? row.method.trim().slice(0, 50) : 'Unknown',
      icon: typeof row.icon === 'string' ? row.icon : '✦',
      color: typeof row.color === 'string' ? row.color : '#9CA8A1',
      transactionType: transactionTypes.has(String(row.transactionType))
        ? row.transactionType as StoredTransaction['transactionType'] : 'expense',
    });
  }
  return rows;
}

export function normalizeObligations(value: unknown): Obligation[] {
  if (!Array.isArray(value)) return [];
  const rows: Obligation[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const item = candidate as Record<string, unknown>;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim().replace(/\s+/g, ' ') : '';
    const category = typeof item.category === 'string' ? item.category.trim() : '';
    const amount = finitePositive(item.amount);
    const normalizedName = name.toLocaleLowerCase();
    if (!id || name.length < 3 || name.length > 60 || category.length > 40 || amount == null
      || seenIds.has(id) || seenNames.has(normalizedName) || rows.length >= 20) continue;
    seenIds.add(id);
    seenNames.add(normalizedName);
    rows.push({ id, name, amount, category: category || 'Bills & utilities' });
  }
  return rows;
}

export function parseStoredTransactions(value: string | null): StoredTransaction[] {
  if (!value) return [];
  try { return normalizeTransactions(JSON.parse(value)); } catch { return []; }
}

export function parseStoredObligations(value: string | null): Obligation[] {
  if (!value) return [];
  try { return normalizeObligations(JSON.parse(value)); } catch { return []; }
}
