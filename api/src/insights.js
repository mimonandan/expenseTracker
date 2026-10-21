export function buildInsights(rows) {
  const totals = new Map();
  let total = 0;
  for (const row of rows) {
    const amount = Number(row.total_paise);
    total += amount;
    totals.set(row.category, (totals.get(row.category) ?? 0) + amount);
  }
  if (!total) return [{ title: 'Start with one small step', body: 'Add a few expenses to see where your money goes and get tailored ideas.', tone: 'calm' }];

  const optional = ['Dining & outings', 'Entertainment', 'Shopping'];
  const discretionary = optional.reduce((sum, category) => sum + (totals.get(category) ?? 0), 0);
  const suggestions = [];
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
