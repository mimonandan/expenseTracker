const RULES = [
  ['Groceries', /grocery|supermarket|vegetable|veggie|fruit|milk|dairy|kirana|bigbasket|blinkit|zepto|instamart/i],
  ['Daily essentials', /pharmacy|chemist|household|cleaning|personal care|toiletries|medicine/i],
  ['Dining & outings', /restaurant|cafe|food|dining|swiggy|zomato|district|outing|bar|pizza/i],
  ['Transport', /uber|ola|metro|fuel|petrol|cab|bus|train|parking/i],
  ['Entertainment', /movie|cinema|book\s?my\s?show|netflix|hotstar|spotify|prime video|youtube|game|concert/i],
  ['Shopping', /myntra|fashion|clothing|shopping/i],
  ['Bills & utilities', /electricity|water bill|internet|broadband|mobile recharge|gas bill/i],
  ['Loan & EMI', /loan|emi|installment|mortgage/i],
];

export function inferCategory(description, requestedCategory) {
  if (requestedCategory && requestedCategory !== 'Auto-detect') return requestedCategory;
  return RULES.find(([, pattern]) => pattern.test(description))?.[0] ?? 'Other';
}
