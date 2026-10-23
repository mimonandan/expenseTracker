import test from 'node:test';
import assert from 'node:assert/strict';
import { validMonthKey, validateTransactionInput } from './request-validation.js';

const base = { id: 'device-ref-1', amount: 12.34, description: 'Groceries', category: 'Groceries', paymentMethod: 'UPI', transactionType: 'expense', date: '2026-10-24', transactionAt: '2026-10-24T08:15:00+05:30' };

test('transaction input accepts valid money and normalizes timestamps', () => {
  const result = validateTransactionInput(base);
  assert.equal(result.error, undefined);
  assert.equal(result.value.amountPaise, 1234);
  assert.equal(result.value.clientRef, 'device-ref-1');
  assert.equal(result.value.transactionAt, '2026-10-24T02:45:00.000Z');
});

for (const [name, patch] of [
  ['zero amount', { amount: 0 }],
  ['negative amount', { amount: -10 }],
  ['amount with more than two decimal places', { amount: 1.239 }],
  ['non-finite amount', { amount: 'not money' }],
  ['precision outside safe integer range', { amount: Number.MAX_SAFE_INTEGER }],
  ['missing description', { description: '  ' }],
  ['overlong description', { description: 'x'.repeat(241) }],
  ['invalid transaction type', { transactionType: 'offer' }],
  ['non-string merchant', { merchant: { name: 'fake' } }],
  ['overlong dynamic category', { category: 'x'.repeat(41) }],
  ['empty payment method', { paymentMethod: '' }],
  ['overlong reference', { id: 'x'.repeat(129) }],
  ['impossible calendar date', { date: '2026-02-30' }],
  ['invalid timestamp', { transactionAt: 'not-a-time' }],
]) {
  test(`transaction input rejects ${name}`, () => {
    assert.equal(typeof validateTransactionInput({ ...base, ...patch }).error, 'string');
  });
}

test('transaction input rejects arrays and null bodies', () => {
  assert.ok(validateTransactionInput(null).error);
  assert.ok(validateTransactionInput([]).error);
});

test('month keys validate calendar months and reject malformed or impossible values', () => {
  assert.equal(validMonthKey('2026-01'), true);
  assert.equal(validMonthKey('2026-12'), true);
  assert.equal(validMonthKey('2026-00'), false);
  assert.equal(validMonthKey('2026-13'), false);
  assert.equal(validMonthKey('0000-01'), false);
  assert.equal(validMonthKey('26-01'), false);
});
