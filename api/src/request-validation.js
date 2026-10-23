const TRANSACTION_TYPES = new Set(['expense', 'refund', 'transfer', 'income']);

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validMonthKey(value) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0, 4)) >= 1900;
}

export function validateTransactionInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Provide a transaction object.' };
  const amount = Number(input.amount);
  const amountPaise = Math.round(amount * 100);
  const hasSubPaisePrecision = Number.isFinite(amount) && Math.abs(amount * 100 - amountPaise) > 1e-7;
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const transactionType = input.transactionType ?? 'expense';
  if (!Number.isFinite(amountPaise) || !Number.isSafeInteger(amountPaise) || amountPaise <= 0 || hasSubPaisePrecision
    || !description || description.length > 240 || !TRANSACTION_TYPES.has(transactionType)) {
    return { error: 'Enter a positive amount, description up to 240 characters, and valid transaction type.' };
  }

  const merchantValue = input.merchant ?? null;
  const categoryValue = input.category ?? 'Auto-detect';
  const paymentMethod = input.paymentMethod ?? 'Other';
  if ((merchantValue !== null && typeof merchantValue !== 'string') || (typeof merchantValue === 'string' && merchantValue.length > 100)
    || typeof categoryValue !== 'string' || categoryValue.length > 40
    || typeof paymentMethod !== 'string' || !paymentMethod.trim() || paymentMethod.length > 40) {
    return { error: 'Merchant, category, or payment method is invalid.' };
  }

  let clientRef = null;
  if (input.id != null) {
    if (typeof input.id !== 'string' || !input.id.trim() || input.id.trim().length > 128) return { error: 'Transaction reference is invalid.' };
    clientRef = input.id.trim();
  }

  let date;
  if (input.date != null) {
    if (!validDate(input.date)) return { error: 'Transaction date must be a real calendar date (YYYY-MM-DD).' };
    date = input.date;
  }

  let transactionAt;
  if (input.transactionAt != null) {
    if (typeof input.transactionAt !== 'string' || !Number.isFinite(Date.parse(input.transactionAt))) {
      return { error: 'Transaction time is invalid.' };
    }
    transactionAt = new Date(input.transactionAt).toISOString();
  }

  return {
    value: {
      amountPaise, description, merchant: merchantValue?.trim() || null,
      category: categoryValue, paymentMethod: paymentMethod.trim(), transactionType,
      clientRef, date, transactionAt,
    },
  };
}
