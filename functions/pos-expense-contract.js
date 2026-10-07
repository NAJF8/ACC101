const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const requiredBusinessDate = value => {
  const date = String(value ?? '').trim();
  if (!DATE_RE.test(date)) {
    const error = new Error('businessDate is required and must be YYYY-MM-DD.');
    error.code = 'INVALID_BUSINESS_DATE';
    throw error;
  }
  return date;
};

const integrationKeyForExpense = expenseId => `POS101:expense:${expenseId}`;

const normalizeExpenseStatus = value => {
  const status = String(value || 'active').trim().toLowerCase();
  return ['active', 'completed', 'voided', 'cancelled', 'canceled', 'deleted'].includes(status) ? status : 'active';
};

module.exports = { requiredBusinessDate, integrationKeyForExpense, normalizeExpenseStatus };
