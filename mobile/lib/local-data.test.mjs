import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeObligations, normalizeTransactions, parseStoredObligations, parseStoredTransactions } from './local-data.ts';

test('stored transaction recovery rejects corrupt shapes, duplicate IDs, bad dates, and unsafe amounts', () => {
  assert.deepEqual(parseStoredTransactions(null), []);
  assert.deepEqual(parseStoredTransactions('{bad json'), []);
  assert.deepEqual(parseStoredTransactions('{"id":"not-an-array"}'), []);
  const rows = normalizeTransactions([
    { id: 'one', description: 'Groceries', category: 'Groceries', amount: 120, date: '2026-10-01T10:00:00.000Z', method: 'UPI', transactionType: 'expense' },
    { id: 'one', description: 'Duplicate', amount: 99, date: '2026-10-01T11:00:00.000Z' },
    { id: 'bad-date', description: 'Bad date', amount: 5, date: 'not-a-date' },
    { id: 'bad-amount', description: 'Bad amount', amount: -4, date: '2026-10-01T10:00:00.000Z' },
    { id: 'unknown-type', description: 'Legacy transaction', amount: '24', date: '2026-10-01T10:00:00.000Z', category: '', transactionType: 'unknown' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].amount, 120);
  assert.equal(rows[1].amount, 24);
  assert.equal(rows[1].category, 'Other');
  assert.equal(rows[1].transactionType, 'expense');
});

test('stored commitments validate positive amounts, deduplicate, and stay within the supported limit', () => {
  assert.deepEqual(parseStoredObligations('null'), []);
  const items = Array.from({ length: 22 }, (_, index) => ({ id: `bill-${index}`, name: `Bill ${index}`, amount: 100, category: 'Bills & utilities' }));
  items.push({ id: 'negative', name: 'Negative', amount: -1, category: 'Bills & utilities' });
  items.push({ id: 'duplicate-name', name: 'BILL 1', amount: 200, category: 'Bills & utilities' });
  const result = normalizeObligations(items);
  assert.equal(result.length, 20);
  assert.equal(result[0].amount, 100);
  assert.equal(result.some(item => item.id === 'negative'), false);
  assert.equal(result.some(item => item.id === 'duplicate-name'), false);
});
