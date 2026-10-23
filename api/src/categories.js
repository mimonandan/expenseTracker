// Categories are a shared reporting taxonomy. Matching is dynamic: the merchant,
// description and (when available) AI classification determine the category.
const RULES = [
  ['Health & fitness', /cult\s*\.\s?fit|cultfit|gym|fitness|workout|wellness|yoga|health club/i],
  ['Groceries', /grocery|supermarket|vegetable|veggie|fruit|milk|dairy|kirana|bigbasket|blinkit|zepto|instamart|grofers/i],
  ['Daily essentials', /pharmacy|chemist|household|cleaning|personal care|toiletries|medicine|apollo pharmacy|1mg|pharmeasy/i],
  ['Dining & outings', /restaurant|cafe|food|dining|swiggy|zomato|outing|bar|pizza|dine.?out/i],
  ['Transport', /rapido|uber|ola|in.?drive|nammayatri|metro|fuel|petrol|cab|bus|train|parking|ride fare/i],
  ['Entertainment', /movie|cinema|book\s?my\s?show|district|netflix|hotstar|jiohotstar|spotify|prime video|youtube premium|game|concert|event ticket/i],
  ['Shopping', /myntra|fashion|clothing|shopping|flipkart|online order/i],
  ['Bills & utilities', /electricity|water bill|internet|broadband|mobile recharge|gas bill|utility bill/i],
  ['Loan & EMI', /loan|emi|installment|mortgage|repayment/i],
];

export function inferCategory(description, requestedCategory, merchant) {
  if (requestedCategory && requestedCategory !== 'Auto-detect') return cleanCategory(requestedCategory) || 'Other';
  const evidence = `${merchant ?? ''} ${description ?? ''}`;
  return RULES.find(([, pattern]) => pattern.test(evidence))?.[0] ?? 'Other';
}

export function cleanCategory(value) {
  if (typeof value !== 'string') return null;
  const category = value.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!category || category.length > 40 || !/[\p{L}\p{N}]/u.test(category)) return null;
  return category;
}
