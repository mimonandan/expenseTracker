import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAlertDeterministically, classifySpendAlert, redactAlertText, selectTransactionAmount } from './alert-ai.js';

// Regression corpus for bank, wallet, shopping, ride, subscription and noisy notices.
// These are intentionally deterministic and do not call an AI provider.
const cases = [
  { name: 'bank debit plus available balance', text: 'INR 1,000 was debited from your account. Available balance INR 25,000.', amount: 1000 },
  { name: 'spent wording with currency amount', text: 'You spent INR 500 at Amazon.', amount: 500 },
  { name: 'debit label and masked account', text: 'Amount Debited: INR 1,950. Account Number XX8421.', amount: 1950 },
  { name: 'fare charged with unrelated balance', text: 'Rapido ride completed. Fare charged INR 149. Wallet balance INR 600.', amount: 149 },
  { name: 'order total with balance', text: 'Zomato order delivered. Order total INR 620. Current balance INR 3,000.', amount: 620 },
  { name: 'debit beside offer amount', text: 'Special offer worth INR 2,500. Subscription payment debited INR 499.', amount: 499 },
  { name: 'due amount and completed smaller payment', text: 'Payment due INR 2,000. Paid INR 1,000 successfully today.', amount: 1000 },
  { name: 'refund and new purchase', text: 'Refund INR 100 credited. New purchase INR 500 charged successfully.', amount: 500 },
  { name: 'membership offer only', text: 'Cult.fit membership offer worth INR 2,500. Join now.', amount: null },
  { name: 'payment request only', text: 'Payment request: please pay INR 850 by tomorrow.', amount: null },
  { name: 'available balance only', text: 'Your available balance is INR 850.', amount: null },
  { name: 'salary credited', text: 'Salary INR 80,000 credited to your account.', amount: null },
  { name: 'fare estimate', text: 'Estimated fare INR 340. Book now.', amount: null },
  { name: 'credit-card payment settlement', text: 'Credit card bill payment INR 12,000 completed.', amount: null },
  { name: 'two equally supported outgoing amounts', text: 'Paid INR 100 and debited INR 200.', amount: null },
];

for (const example of cases) {
  test(`amount guard: ${example.name}`, () => {
    const selected = selectTransactionAmount(example.text);
    assert.equal(selected?.amount ?? null, example.amount);
  });
}

const deterministicCases = [
  { text: 'Credit card bill payment INR 12,000 completed.', eventType: 'transfer' },
  { text: 'Wallet top-up successful INR 500.', eventType: 'transfer' },
  { text: 'Salary INR 80,000 credited to your account.', eventType: 'income' },
  { text: 'Refund INR 150 credited for a cancelled order.', eventType: 'refund' },
  { text: 'Payment due INR 2,000 by 10 November.', eventType: 'payment_due' },
  { text: 'Transaction failed. INR 149 was debited and will be reversed.', eventType: 'not_transaction' },
  { text: 'Your card payment was declined for INR 499.', eventType: 'not_transaction' },
  { text: 'Ride cancelled. Fare INR 300 will be refunded.', eventType: 'not_transaction' },
  { text: 'Cult.fit offer worth INR 2,500. Join today.', eventType: 'offer' },
  { text: 'Rapido fare INR 149 debited from your account.', eventType: null },
  { text: 'Zomato order delivered. Total paid INR 620.', eventType: null },
];

for (const example of deterministicCases) {
  test(`event guard: ${example.eventType ?? 'completed payment needs grounded review'} — ${example.text}`, () => {
    const result = classifyAlertDeterministically(example.text);
    assert.equal(result?.eventType ?? null, example.eventType);
    assert.equal(result?.shouldReview ?? false, false);
  });
}

test('privacy redaction removes contact and account identifiers before cloud review', () => {
  const redacted = redactAlertText('UPI user.name@okaxis paid from account 1234567890123456. Call 9876543210. PAN ABCDE1234F.');
  assert.match(redacted, /\[email\]|\[upi-id\]/);
  assert.match(redacted, /\[private-id\]/);
  assert.match(redacted, /\[phone\]/);
  assert.match(redacted, /\[pan\]/);
  assert.doesNotMatch(redacted, /1234567890123456|9876543210|ABCDE1234F/);
});

const previousAiEnvironment = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL };
process.env.OPENAI_API_KEY = 'test-key';
process.env.OPENAI_MODEL = 'test-model';

function responseWithClassification(classification) {
  return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(classification) }] }] }) };
}

const classification = (overrides = {}) => ({
  event_type: 'expense', amount: 229, currency: 'INR', merchant: 'Zepto', category: 'Grocery delivery', evidence: 'purchase_receipt', ...overrides,
});

test('AI classification accepts only an alert-grounded amount and gives dynamic category under review', async t => {
  let sentBody;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return responseWithClassification(classification());
  });
  const result = await classifySpendAlert({
    text: 'Zepto order delivered. Total paid INR 229. Account number 1234567890123456. user.name@okaxis. Call 9876543210.',
    source: 'Zepto',
  });

  assert.equal(result.eventType, 'expense');
  assert.equal(result.amount, 229);
  assert.equal(result.merchant, 'Zepto');
  assert.equal(result.category, 'Groceries');
  assert.equal(result.shouldReview, true);
  assert.equal(sentBody.store, false);
  assert.doesNotMatch(sentBody.input, /1234567890123456|9876543210|user\.name@okaxis/);
});

test('AI cannot invent the merchant or category when neither is present in the alert', async t => {
  t.mock.method(globalThis, 'fetch', async () => responseWithClassification(classification({ merchant: 'Paw House', category: 'Pet care', amount: 420 })));
  const result = await classifySpendAlert({ text: 'Payment completed INR 420 debited from your account.', source: 'Bank' });

  assert.equal(result.merchant, null);
  assert.equal(result.category, 'Other');
  assert.equal(result.categoryConfidence, 0);
  assert.equal(result.shouldReview, true);
});

test('AI cannot select an offer amount when another amount is the actual debit', async t => {
  t.mock.method(globalThis, 'fetch', async () => responseWithClassification(classification({ amount: 249 })));
  const result = await classifySpendAlert({ text: 'Offer worth INR 249. Subscription payment debited INR 499.', source: 'Email' });

  assert.equal(result.eventType, 'uncertain');
  assert.equal(result.amount, null);
  assert.equal(result.shouldReview, false);
});

test('AI output cannot override failed or reversal-pending payment language', async t => {
  t.mock.method(globalThis, 'fetch', async () => responseWithClassification(classification({ amount: 149 })));
  const result = await classifySpendAlert({ text: 'Transaction failed. INR 149 was debited and will be reversed.', source: 'Bank' });
  assert.equal(result.eventType, 'not_transaction');
  assert.equal(result.amount, null);
  assert.equal(result.shouldReview, false);
});

test('deterministic payment-due and provider failures never become an accepted expense', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests += 1; return { ok: false, status: 503 }; });
  const due = await classifySpendAlert({ text: 'Payment request: please pay INR 850 by tomorrow.', source: 'Bank' });
  assert.equal(due.eventType, 'payment_due');
  assert.equal(due.shouldReview, false);
  assert.equal(requests, 0);
  await assert.rejects(() => classifySpendAlert({ text: 'Bank payment successful. Paid INR 850.', source: 'Bank' }), /returned 503/);
});

process.on('exit', () => {
  if (previousAiEnvironment.key === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousAiEnvironment.key;
  if (previousAiEnvironment.model === undefined) delete process.env.OPENAI_MODEL;
  else process.env.OPENAI_MODEL = previousAiEnvironment.model;
});
