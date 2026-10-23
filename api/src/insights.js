export function buildInsights(rows) {
  const totals = new Map();
  let total = 0;
  for (const row of rows) {
    const amount = Number(row.total_paise);
    total += amount;
    totals.set(row.category, (totals.get(row.category) ?? 0) + amount);
  }
  if (!total) return [{ title: 'Track a few purchases first', body: 'There is not enough recorded spending to suggest a pattern yet. Add a few purchases and these ideas will use only the entries you tracked.', tone: 'calm' }];

  const money = amountPaise => new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR',
    minimumFractionDigits: amountPaise % 100 === 0 ? 0 : 2, maximumFractionDigits: 2,
  }).format(amountPaise / 100);

  const optional = ['Dining & outings', 'Entertainment', 'Shopping'];
  const discretionary = optional.reduce((sum, category) => sum + (totals.get(category) ?? 0), 0);
  const suggestions = [];
  if (discretionary / total > 0.28) {
    suggestions.push({
      title: 'Review flexible spending',
      body: `${money(discretionary)} (${Math.round(discretionary / total * 100)}%) of your ${money(total)} tracked spend this month is in dining, entertainment, or shopping. If lowering it is a goal, choose one category and try a weekly limit. This is an optional prompt, not a savings forecast.`,
      tone: 'warm',
    });
  }
  const biggest = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
  if (biggest && suggestions.length < 2) {
    suggestions.push({
      title: `Review ${biggest[0].toLowerCase()}`,
      body: `${money(biggest[1])} (${Math.round(biggest[1] / total * 100)}%) of your tracked spend is currently in this category. If useful, review a few entries for accuracy and decide whether any part is flexible. Keep required bills and repayments protected.`,
      tone: 'calm',
    });
  }
  if (!suggestions.length) suggestions.push({ title: 'Your spending is spread across categories', body: `No single pattern stands out in ${money(total)} of tracked spend this month. Keep recording purchases to see how the mix changes; unrecorded spending is not included.`, tone: 'calm' });
  return suggestions;
}
