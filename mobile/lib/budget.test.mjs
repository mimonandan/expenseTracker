import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMonthlyPlan } from './budget.ts';

const dateAt = (day, month = 9, year = 2026, hour = 12) => new Date(year, month, day, hour, 0, 0);
const tx = (id, description, amount, date, category = 'Other', transactionType = 'expense') => ({
  id, description, amount, date: date.toISOString(), category, transactionType,
});
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.01, `${actual} should be close to ${expected}`);

test('monthly commitments are reserved once even when paid in the first week', () => {
  const commitments = [
    { id: 'loan', name: 'Personal loan', amount: 18000, category: 'Loan & EMI' },
    { id: 'rent', name: 'Rent', amount: 22000, category: 'Bills & utilities' },
  ];
  const transactions = [
    tx('loan-payment', 'Personal loan EMI', 18000, dateAt(3), 'Loan & EMI'),
    tx('rent-payment', 'Rent', 22000, dateAt(5), 'Bills & utilities'),
  ];
  const plan = calculateMonthlyPlan(100000, commitments, transactions, dateAt(7));

  assert.equal(plan.matchedExpense, 40000);
  assert.equal(plan.outstandingObligations, 0);
  assert.equal(plan.discretionaryNet, 0);
  assert.equal(plan.budgetRemaining, 60000);
  closeTo(plan.dailyGuide, 60000 / 25);
});

test('daily allowance rolls forward unused flexible budget and adjusts after overspend', () => {
  const previousPurchase = tx('yesterday', 'Groceries', 500, dateAt(1));
  const todayPurchase = tx('today', 'Lunch', 1200, dateAt(2));
  const plan = calculateMonthlyPlan(30000, [], [previousPurchase, todayPurchase], dateAt(2));

  closeTo(plan.dailyGuide, 29500 / 30);
  closeTo(plan.todayNetSpend, 1200);
  closeTo(plan.todayRemaining, Math.max(0, 29500 / 30 - 1200));
  assert.equal(plan.daysRemaining, 30);
});

test('matched bill transfer is not treated as discretionary spend or double-counted', () => {
  const obligations = [{ id: 'emi', name: 'Education loan', amount: 8000, category: 'Loan & EMI' }];
  const payment = tx('emi-transfer', 'Education loan repayment', 8000, dateAt(4), 'Loan & EMI', 'transfer');
  const plan = calculateMonthlyPlan(50000, obligations, [payment], dateAt(8));

  assert.equal(plan.matchedTransfers, 8000);
  assert.equal(plan.outstandingObligations, 0);
  assert.equal(plan.todayNetSpend, 0);
  assert.equal(plan.budgetRemaining, 42000);
  closeTo(plan.dailyGuide, 42000 / 24);
});

test('amount-only match is rejected; payment remains visible as flexible spend', () => {
  const obligations = [{ id: 'rent', name: 'Rent', amount: 20000, category: 'Bills & utilities' }];
  const unrelated = tx('shop', 'Electronics store', 20000, dateAt(2), 'Shopping');
  const plan = calculateMonthlyPlan(60000, obligations, [unrelated], dateAt(3));

  assert.equal(plan.outstandingObligations, 20000);
  assert.equal(plan.matchedExpense, 0);
  assert.equal(plan.todayNetSpend, 0);
  assert.equal(plan.monthNetSpend, 20000);
  assert.equal(plan.budgetRemaining, 20000);
});

test('refunds reduce net spending, and income and transfers are excluded', () => {
  const rows = [
    tx('buy', 'Groceries', 3000, dateAt(1)),
    tx('refund', 'Returned item', 500, dateAt(2), 'Shopping', 'refund'),
    tx('salary', 'Salary credited', 80000, dateAt(2), 'Other', 'income'),
    tx('wallet', 'Wallet top-up', 1000, dateAt(2), 'Other', 'transfer'),
  ];
  const plan = calculateMonthlyPlan(40000, [], rows, dateAt(3));

  assert.equal(plan.monthNetSpend, 2500);
  assert.equal(plan.todayNetSpend, 0);
  assert.equal(plan.budgetRemaining, 37500);
});

test('month boundary, invalid dates, and leap-year February are handled', () => {
  const rows = [
    tx('prev-month', 'Old month', 9000, dateAt(30, 8)),
    tx('current-month', 'This month', 100, dateAt(1, 9)),
    { ...tx('bad-date', 'Invalid date', 400, dateAt(1)), date: 'not-a-date' },
  ];
  const october = calculateMonthlyPlan(31000, [], rows, dateAt(1));
  assert.equal(october.monthNetSpend, 100);
  assert.equal(october.daysRemaining, 31);

  const february = calculateMonthlyPlan(29000, [], [], dateAt(1, 1, 2028));
  assert.equal(february.daysRemaining, 29);
  closeTo(february.dailyGuide, 1000);
});

test('zero income, zero available budget, and invalid inputs never produce NaN', () => {
  const overcommitted = calculateMonthlyPlan(0, [{ id: 'rent', name: 'Rent', amount: 20000, category: 'Bills & utilities' }], [], dateAt(1));
  const overSpent = calculateMonthlyPlan(1000, [], [tx('large', 'Purchase', 5000, dateAt(1))], dateAt(2));
  const malformed = calculateMonthlyPlan(Number.NaN, [], [tx('bad', 'Corrupt expense', Number.NaN, dateAt(1))], dateAt(1));

  assert.equal(overcommitted.dailyGuide, 0);
  assert.equal(overcommitted.budgetRemaining, 0);
  assert.equal(overSpent.budgetRemaining, 0);
  assert.equal(malformed.dailyGuide, 0);
  assert.equal(malformed.budgetRemaining, 0);
  for (const plan of [overcommitted, overSpent, malformed]) {
    for (const value of [plan.monthNetSpend, plan.budgetRemaining, plan.dailyGuide, plan.todayRemaining]) assert.ok(Number.isFinite(value));
  }
});

test('negative or non-finite expense amounts cannot inflate the available budget', () => {
  const plan = calculateMonthlyPlan(10000, [], [
    tx('negative', 'Malformed expense', -2000, dateAt(1)),
    tx('infinite', 'Malformed expense', Number.POSITIVE_INFINITY, dateAt(1)),
  ], dateAt(2));

  assert.equal(plan.monthNetSpend, 0);
  assert.equal(plan.budgetRemaining, 10000);
  closeTo(plan.dailyGuide, 10000 / 30);
});
