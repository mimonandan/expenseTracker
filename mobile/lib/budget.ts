export type Obligation = { id: string; name: string; amount: number; category: string };
export type BudgetTransaction = { id: string; description: string; amount: number; date: string; category: string; transactionType?: 'expense' | 'refund' | 'transfer' | 'income' };

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const inMonth = (value: string, year: number, month: number) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getFullYear() === year && date.getMonth() === month;
};
const closeAmount = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, b * 0.08);

/**
 * Fixed monthly obligations are reserved once. Matching paid bill transactions
 * releases the reserve while counting the payment once, so they cannot reduce
 * the discretionary allowance twice. Carryover is spread across remaining days.
 */
export function calculateMonthlyPlan(income: number, obligations: Obligation[], transactions: BudgetTransaction[], now = new Date()) {
  // Local storage can contain older or partially-written values. Ignore
  // malformed amounts instead of letting NaN/Infinity inflate the budget.
  const monthlyIncome = Number.isFinite(income) && income > 0 ? income : 0;
  const monthRows = (Array.isArray(transactions) ? transactions : []).filter(row =>
    row && Number.isFinite(row.amount) && row.amount > 0 && inMonth(row.date, now.getFullYear(), now.getMonth()));
  const activeObligations = (Array.isArray(obligations) ? obligations : []).filter(item =>
    item && typeof item.id === 'string' && typeof item.name === 'string'
    && Number.isFinite(item.amount) && item.amount > 0);
  const paidById = new Map(activeObligations.map(item => [item.id, 0]));
  const matchedExpenseAmounts = new Map<string, number>();
  const matchedTransferAmounts = new Map<string, number>();

  // Match a clearly named bill to its merchant and amount. Never guess based on amount alone.
  const unmatchedByName = [...monthRows].sort((a, b) => a.date.localeCompare(b.date));
  for (const obligation of activeObligations) {
    const term = normalized(obligation.name);
    if (term.length < 3) continue;
    for (const row of unmatchedByName) {
      if (matchedExpenseAmounts.has(row.id) || matchedTransferAmounts.has(row.id)) continue;
      const type = row.transactionType ?? 'expense';
      if (type !== 'expense' && type !== 'transfer') continue;
      const description = normalized(row.description);
      if (!description.includes(term) || !closeAmount(row.amount, obligation.amount)) continue;
      const matched = Math.min(obligation.amount, row.amount);
      if (type === 'expense') matchedExpenseAmounts.set(row.id, matched);
      else matchedTransferAmounts.set(row.id, matched);
      paidById.set(obligation.id, matched);
      break;
    }
  }

  // For standard bill/loan categories, clearly categorized payments can match
  // the category reserve without merchant text. Amount-only matches remain off.
  for (const category of ['Bills & utilities', 'Loan & EMI']) {
    const categoryObligations = activeObligations.filter(item => item.category === category);
    const reserved = categoryObligations.reduce((sum, item) => sum + item.amount, 0);
    let remainingReserve = Math.max(0, reserved - categoryObligations.reduce((sum, item) => sum + (paidById.get(item.id) ?? 0), 0));
    const candidates = monthRows.filter(row => row.category === category
      && !matchedExpenseAmounts.has(row.id) && !matchedTransferAmounts.has(row.id)
      && ['expense', 'transfer'].includes(row.transactionType ?? 'expense'))
      .sort((a, b) => a.date.localeCompare(b.date));
    for (const row of candidates) {
      const paid = Math.min(remainingReserve, row.amount);
      if (paid <= 0) break;
      if ((row.transactionType ?? 'expense') === 'expense') matchedExpenseAmounts.set(row.id, paid);
      else matchedTransferAmounts.set(row.id, paid);
      let allocation = paid;
      for (const obligation of categoryObligations) {
        const due = obligation.amount - (paidById.get(obligation.id) ?? 0);
        const slice = Math.min(due, allocation);
        if (slice > 0) paidById.set(obligation.id, (paidById.get(obligation.id) ?? 0) + slice);
        allocation -= slice;
        if (allocation <= 0) break;
      }
      remainingReserve -= paid;
    }
  }

  const monthNetSpend = monthRows.reduce((sum, row) => {
    const type = row.transactionType ?? 'expense';
    if (type === 'expense') return sum + row.amount;
    if (type === 'refund') return sum - row.amount;
    return sum;
  }, 0);
  const obligationTotal = activeObligations.reduce((sum, item) => sum + item.amount, 0);
  const matchedExpense = [...matchedExpenseAmounts.values()].reduce((sum, amount) => sum + amount, 0);
  const matchedTransfers = [...matchedTransferAmounts.values()].reduce((sum, amount) => sum + amount, 0);
  const outstandingObligations = activeObligations.reduce((sum, item) => sum + Math.max(0, item.amount - (paidById.get(item.id) ?? 0)), 0);
  const budgetRemaining = Math.max(0, monthlyIncome - monthNetSpend - outstandingObligations - matchedTransfers);
  const discretionaryNet = monthNetSpend - matchedExpense;

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysRemaining = Math.max(1, daysInMonth - now.getDate() + 1);
  const todayRows = monthRows.filter(row => new Date(row.date).toDateString() === now.toDateString());
  const todayNetSpend = todayRows.reduce((sum, row) => {
    const type = row.transactionType ?? 'expense';
    if (type === 'expense') return sum + Math.max(0, row.amount - (matchedExpenseAmounts.get(row.id) ?? 0));
    if (type === 'refund') return sum - row.amount;
    return sum;
  }, 0);
  const priorNetSpend = monthRows.filter(row => new Date(row.date) < new Date(now.getFullYear(), now.getMonth(), now.getDate()))
    .reduce((sum, row) => {
      const type = row.transactionType ?? 'expense';
      if (type === 'expense') return sum + Math.max(0, row.amount - (matchedExpenseAmounts.get(row.id) ?? 0));
      if (type === 'refund') return sum - row.amount;
      return sum;
    }, 0);
  const poolAtStartOfToday = Math.max(0, monthlyIncome - obligationTotal - priorNetSpend);
  const dailyGuide = Math.max(0, poolAtStartOfToday / daysRemaining);
  const todayRemaining = Math.max(0, dailyGuide - todayNetSpend);

  return {
    monthNetSpend: Math.max(0, monthNetSpend), obligationTotal, outstandingObligations,
    matchedExpense, matchedTransfers, discretionaryNet, budgetRemaining, todayNetSpend: Math.max(0, todayNetSpend),
    dailyGuide, todayRemaining, daysRemaining,
    paidById: Object.fromEntries(paidById),
    matchedExpenseAmountsByTransactionId: Object.fromEntries(matchedExpenseAmounts),
    matchedTransferAmountsByTransactionId: Object.fromEntries(matchedTransferAmounts),
  };
}
