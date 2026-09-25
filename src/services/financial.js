const pad = (value) => String(value).padStart(2, '0');
const isEmployeeOperationallyActive = (employee = {}) => employee.active !== false && employee.archived !== true && employee.enabled !== false;

const BUSINESS_TIME_ZONE = 'Asia/Baghdad';

export const localBusinessDate = (value = new Date(), timeZone = BUSINESS_TIME_ZONE) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const fields = Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}`;
};

export const currentMonth = () => {
  const date = new Date();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
};

export const previousMonth = (month) => {
  const [year, value] = String(month || currentMonth()).split('-').map(Number);
  const date = new Date(year, (value || 1) - 2, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
};

export const nextMonth = (month) => {
  const [year, value] = String(month || currentMonth()).split('-').map(Number);
  const date = new Date(year, value || 0, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
};

export const normalizeDate = (value) => {
  if (!value) return '';
  if (typeof value === 'number') {
    const date = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  const text = String(value).trim();
  const iso = text.match(/(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?/);
  if (iso) return `${iso[1]}-${pad(iso[2])}-${pad(iso[3] || 1)}`;
  const legacy = text.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (legacy) return `${legacy[3]}-${pad(legacy[2])}-${pad(legacy[1])}`;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// Reporting ranges use the stored YYYY-MM-DD value as a local calendar date.
// Comparing the normalized strings avoids UTC shifting the inclusive bounds.
export const normalizeDateRange = ({ mode = 'month', month = currentMonth(), fromDate = '', toDate = '' } = {}) => {
  if (mode !== 'custom') return { mode: 'month', month: month || currentMonth(), fromDate: '', toDate: '' };
  const from = normalizeDate(fromDate);
  const to = normalizeDate(toDate);
  if (!from || !to || from > to) throw new Error('الفترة الزمنية غير صحيحة. اختر تاريخ بداية لا يتجاوز تاريخ النهاية.');
  return { mode: 'custom', month: '', fromDate: from, toDate: to };
};

export const isDateInRange = (value, range = {}) => {
  const date = normalizeDate(value);
  if (!date) return false;
  if (range.mode !== 'custom') return !range.month || range.month === 'all' || date.slice(0, 7) === range.month;
  return date >= range.fromDate && date <= range.toDate;
};

export const filterRecordsByDateRange = (records = [], range = {}) => records.filter((record) => !record.deleted && isDateInRange(record.date || record.payment_date || record.paymentDate, range));

export const getRecordMonth = (record = {}) => {
  if (record.without_month === true) return '';
  const explicit = record.month || record.import_month || record.period || record.financial_month;
  if (explicit && /^\d{4}-\d{1,2}$/.test(String(explicit))) return String(explicit).replace(/-(\d)$/, '-0$1');
  const date = normalizeDate(record.date || record.payment_date || record.paymentDate || record.created_at || record.createdAt);
  return date.slice(0, 7);
};

// Operational records use their explicit calendar date.  Timestamp fallbacks
// are converted to the Baghdad business date instead of being sliced as UTC.
export const getRecordDate = (record = {}) => {
  const explicit = record.date || record.payment_date || record.paymentDate;
  if (explicit) return normalizeDate(explicit);
  return localBusinessDate(record.created_at || record.createdAt);
};

export const recordsForMonth = (records = [], month) => !month || month === 'all'
  ? records.filter((record) => !record.deleted)
  : records.filter((record) => !record.deleted && getRecordMonth(record) === month);

export const amountOf = (record = {}, fallback = 'amount') => {
  // `revenue` and `electronic` are semantic fields, never aliases for a
  // legacy balance in `total`.  Transaction-specific sales resolution lives
  // in getSalesTransactionNet below.
  if (['revenue', 'electronic', 'other_income', 'otherIncome'].includes(fallback)) return Number(record[fallback] ?? 0) || 0;
  return Number(record.total_after_discount ?? record.total_price ?? record[fallback] ?? record.total ?? record.amount ?? 0) || 0;
};

export const sum = (records, fallback) => records.reduce((total, record) => total + amountOf(record, fallback), 0);

// Legacy summaries contain both semantic daily fields and a historical `total`
// balance.  The latter is not an alias for sales, electronic payments, or
// other income, so keep those reads deliberately field-specific.
const legacySemanticFields = {
  grossSales: ['amount', 'gross_sales', 'grossSales'],
  discount: ['discount', 'discount_amount'],
  electronic: ['electronic', 'electronic_sales', 'electronicSales'],
  otherIncome: ['revenue', 'other_income', 'otherIncome'],
  purchases: ['purchases'],
};

const explicitNumber = (record = {}, fields = []) => {
  for (const field of fields) {
    const value = record[field];
    if (value !== undefined && value !== null && value !== '') {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : 0;
    }
  }
  return 0;
};

export const getLegacyNumeric = (record = {}, field) => explicitNumber(record, legacySemanticFields[field] || []);
export const getLegacyGrossSales = (record = {}) => getLegacyNumeric(record, 'grossSales');
export const getLegacyDiscount = (record = {}) => getLegacyNumeric(record, 'discount');
export const getLegacyElectronic = (record = {}) => getLegacyNumeric(record, 'electronic');
export const getLegacyOtherIncome = (record = {}) => getLegacyNumeric(record, 'otherIncome');
export const getLegacyPurchases = (record = {}) => getLegacyNumeric(record, 'purchases');
const sumLegacy = (records, resolver) => records.reduce((total, record) => total + resolver(record), 0);

// Modern sale rows have their own compatible transaction amount fields.  This
// resolver intentionally does not fall through to a generic `total` field.
export const getSalesTransactionNet = (record = {}) => explicitNumber(record, ['total_after_discount', 'revenue', 'net_amount', 'net']);

// Keep every payment classification in one place.  These are the persisted
// values used by the Finance forms and the historic Arabic spelling variants
// already supported by the product; callers must not infer cash by subtraction.
const CASH_ALIASES = new Set(['cash', 'نقدي', 'نقد', 'cash_payment', 'cash-payment', 'cashpayment']);
const ELECTRONIC_ALIASES = new Set(['electronic', 'card', 'visa', 'mastercard', 'الكتروني', 'إلكتروني', 'بطاقة']);
const TRANSFER_ALIASES = new Set(['transfer', 'تحويل', 'bank_transfer', 'wire']);
const CREDIT_ALIASES = new Set(['credit', 'آجل', 'اجل', 'on_credit']);
// Persist one canonical value while retaining the historical resolver below.
// Unknown/blank is deliberately returned as an empty string so callers can
// block a new financial record instead of silently writing a missing field.
export const normalizePaymentMethod = (method) => {
  const normalized = String(method ?? '').trim().toLowerCase();
  if (CASH_ALIASES.has(normalized)) return 'cash';
  if (ELECTRONIC_ALIASES.has(normalized)) return 'electronic';
  if (TRANSFER_ALIASES.has(normalized)) return 'transfer';
  if (CREDIT_ALIASES.has(normalized)) return 'credit';
  return '';
};
export const resolvePaymentMethod = (method) => {
  const normalized = normalizePaymentMethod(method);
  if (CASH_ALIASES.has(normalized)) return 'cash';
  if (normalized === 'electronic' || normalized === 'transfer') return 'electronic';
  if (normalized === 'credit') return 'other';
  return normalized ? 'other' : 'unknown';
};
export const isCashPayment = (method) => resolvePaymentMethod(method) === 'cash';
export const isElectronicPayment = (method) => resolvePaymentMethod(method) === 'electronic';
export const cashSourceKey = (sourceType, sourceId) => sourceType && sourceId ? `${sourceType}:${sourceId}` : '';

const CASH_COMPONENT_FIELDS = ['cash_amount', 'cashAmount', 'paid_cash', 'paidCash'];
const ELECTRONIC_COMPONENT_FIELDS = ['electronic_amount', 'electronicAmount', 'paid_electronic', 'paidElectronic', 'card_amount', 'cardAmount', 'transfer_amount', 'transferAmount'];
const hasExplicitNumber = (record = {}, fields = []) => fields.some((field) => {
  const value = record[field];
  return value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value));
});
const explicitSum = (record = {}, fields = []) => fields.reduce((total, field) => {
  const value = record[field];
  return value === undefined || value === null || value === '' || !Number.isFinite(Number(value))
    ? total
    : total + Math.max(0, Number(value));
}, 0);

export const payrollPaymentState = ({ due = 0, payments = [] } = {}) => {
  const totalDue = Math.max(0, Number(due) || 0);
  const paidAmount = payments.reduce((total, payment) => total + Math.max(0, Number(payment?.amount) || 0), 0);
  return {
    due: totalDue,
    paidAmount,
    remainingAmount: Math.max(0, totalDue - paidAmount),
    status: paidAmount <= 0 ? 'unpaid' : paidAmount < totalDue ? 'partial' : 'paid',
  };
};

// Cash is deliberately resolved independently from profit.  All amounts are
// integer IQD; quantities elsewhere may remain decimal.
export const money = (value, label = 'المبلغ') => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`${label} يجب أن يكون مبلغ IQD صحيحاً.`);
  return result;
};

export const cashMovementDirection = (movement = {}) => {
  const type = String(movement.type || '').toUpperCase();
  return type === 'IN' ? 1 : type === 'OUT' ? -1 : 0;
};

export const DEFAULT_IQD_DENOMINATIONS = [50000, 25000, 10000, 5000, 1000, 500, 250];

export const countCashDenominations = (counts = {}, denominations = DEFAULT_IQD_DENOMINATIONS) =>
  denominations.reduce((total, denomination) => total + denomination * Math.max(0, Math.trunc(Number(counts[denomination] || 0))), 0);

export const cashBalanceFromMovements = ({ opening = 0, movements = [] } = {}) => {
  const openingAmount = money(opening);
  return movements.filter((row) => !row.deleted && !row.internal_transfer && (!row.payment_method || isCashPayment(row.payment_method))).reduce(
    (balance, row) => balance + cashMovementDirection(row) * money(row.amount || 0), openingAmount,
  );
};

export const buildCashCarryForward = ({ sourceMonth, targetMonth, closingCash, actor, now = new Date().toISOString() } = {}) => ({
  id: targetMonth,
  month: targetMonth,
  opening_cash: money(closingCash),
  source_month: sourceMonth,
  target_month: targetMonth,
  source_closing_cash: money(closingCash),
  carried_amount: money(closingCash),
  source: 'monthly_cash_closing',
  label_ar: 'رصيد مرحّل من الشهر السابق',
  created_at: now,
  created_by: actor || 'system',
  idempotency_key: `carry-forward:${targetMonth}`,
  status: 'applied',
});

export const buildPeriodComparison = ({ current = {}, previous = {} } = {}) => {
  const compareMetric = (key) => {
    const currentValue = Number(current[key]);
    const previousValue = Number(previous[key]);
    if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue) || previousValue === 0) return { current: Number.isFinite(currentValue) ? currentValue : null, previous: Number.isFinite(previousValue) ? previousValue : null, direction: 'insufficient', percent: null };
    const delta = currentValue - previousValue;
    return { current: currentValue, previous: previousValue, delta, percent: Number(((delta / previousValue) * 100).toFixed(1)), direction: delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'same' };
  };
  return Object.fromEntries(['revenue', 'purchases', 'expenses', 'profitBeforePayroll', 'profitAfterPayroll', 'salesCount', 'averageSale'].map((key) => [key, compareMetric(key)]));
};

export const buildAccountReview = ({ sales = [], inventory = [], cashMovements = [], debts = [], payroll = [], shifts = [], stockOperations = [], month } = {}) => {
  const items = [];
  sales.filter((row) => resolvePaymentMethod(row.payment_method) === 'unknown').forEach((row) => items.push({ type: 'missing_payment', severity: 'urgent', date: row.date, source: `sales/${row.id || ''}`, amount: getSalesTransactionNet(row), status: 'تحتاج مراجعة', action: 'تحديد طريقة الدفع' }));
  inventory.filter((row) => Number(row.quantity ?? row.current_stock ?? row.stock ?? 0) < 0).forEach((row) => items.push({ type: 'negative_inventory', severity: 'urgent', date: row.updated_at || row.date, source: `inventory_items/${row.id || ''}`, amount: Number(row.quantity || 0), status: 'مخزون سالب', action: 'مراجعة حركة المخزون' }));
  cashMovements.filter((row) => !row.deleted && !row.source_type && row.auto).forEach((row) => items.push({ type: 'orphan_cash', severity: 'urgent', date: row.date, source: `cash_movements/${row.id || ''}`, amount: Number(row.amount || 0), status: 'بلا مصدر', action: 'ربط الحركة أو تصحيحها' }));
  debts.filter((row) => Number(row.paid_amount || 0) > Number(row.original_amount || row.amount || 0)).forEach((row) => items.push({ type: 'payment_over_debt', severity: 'urgent', date: row.date || row.debt_date, source: `debts/${row.id || ''}`, amount: Number(row.paid_amount || 0), status: 'دفع أكبر من الدين', action: 'مراجعة التسديد' }));
  payroll.filter((row) => (!row.status || row.status === 'pending') && (!month || getRecordMonth(row) === month)).forEach((row) => items.push({ type: 'incomplete_payroll', severity: 'followup', date: row.month, source: `payroll/${row.id || ''}`, amount: Number(row.amount || row.base_salary_snapshot || 0), status: 'غير مكتمل', action: 'إكمال حالة الراتب' }));
  shifts.filter((row) => row.status === 'closed' && Number(row.difference || 0) !== 0).forEach((row) => items.push({ type: 'shift_discrepancy', severity: 'followup', date: row.closed_at || row.opened_at, source: `cashier_shifts/${row.id || ''}`, amount: Number(row.difference || 0), status: 'فرق صندوق', action: 'مراجعة وتسوية منفصلة' }));
  stockOperations.filter((row) => ['pending', 'recovery_required', 'manual_recovery'].includes(row.status)).forEach((row) => items.push({ type: 'pending_inventory', severity: 'followup', date: row.created_at || row.date, source: `inventory_operations/${row.id || ''}`, amount: null, status: row.status, action: 'إتمام الاسترداد يدويًا' }));
  return items;
};

export const buildMonthCloseReview = ({ sales = [], movements = [], inventory = [], payroll = [], debts = [], invoices = [], stockOperations = [], month } = {}) => {
  const items = [];
  const missingPayment = sales.filter((row) => resolvePaymentMethod(row.payment_method) === 'unknown');
  if (missingPayment.length) items.push({ code: 'missing_payment_method', severity: 'BLOCKING', label: 'يمنع إغلاق الشهر', detail: `${missingPayment.length} مبيعات بلا طريقة دفع` });
  if (inventory.some((row) => Number(row.quantity ?? row.current_stock ?? 0) < 0)) items.push({ code: 'negative_inventory', severity: 'BLOCKING', label: 'يمنع إغلاق الشهر', detail: 'يوجد مخزون سالب' });
  if (stockOperations.some((row) => ['pending', 'recovery_required', 'manual_recovery'].includes(row.status))) items.push({ code: 'pending_inventory', severity: 'BLOCKING', label: 'يمنع إغلاق الشهر', detail: 'عملية مخزون تحتاج استرداداً' });
  if (payroll.some((row) => getRecordMonth(row) === month && row.status !== 'paid')) items.push({ code: 'payroll_due', severity: 'WARNING', label: 'يحتاج مراجعة', detail: 'توجد رواتب غير مكتملة' });
  if (debts.some((row) => row.due_date && row.due_date < `${month}-31` && Number(row.remaining_amount || 0) > 0)) items.push({ code: 'overdue_debt', severity: 'WARNING', label: 'يحتاج مراجعة', detail: 'توجد ديون أو مستحقات متأخرة' });
  const discrepancy = movements.some((row) => row.reconciliation && Number(row.difference || 0) !== 0);
  if (discrepancy) items.push({ code: 'cash_difference', severity: 'WARNING', label: 'يحتاج مراجعة', detail: 'يوجد فرق في الصندوق' });
  if (!items.length) items.push({ code: 'valid', severity: 'INFO', label: 'معلومة', detail: 'لا توجد ملاحظات تمنع الإغلاق' });
  return items;
};

export const aggregateFinancialTimeline = ({ sales = [], purchases = [], fromDate, toDate } = {}) => {
  const map = new Map();
  const add = (date, key, amount, count = 1) => { if (!date || date < fromDate || date > toDate) return; const row = map.get(date) || { date, revenue: 0, purchases: 0, salesCount: 0, purchaseCount: 0 }; row[key] += amount; if (key === 'revenue') row.salesCount += count; if (key === 'purchases') row.purchaseCount += count; map.set(date, row); };
  sales.filter((row) => !row.deleted).forEach((row) => add(normalizeDate(row.date), 'revenue', getSalesTransactionNet(row)));
  purchases.filter((row) => !row.deleted).forEach((row) => add(normalizeDate(row.date), 'purchases', purchaseRecordTotal(row)));
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
};

export const cashAccountBalances = ({ accounts = [], movements = [] } = {}) => {
  const balances = new Map(accounts.filter((account) => account.active !== false).map((account) => [account.id, money(account.opening_balance || 0)]));
  movements.filter((movement) => !movement.deleted).forEach((movement) => {
    const accountId = movement.cash_account_id || 'cashier';
    balances.set(accountId, (balances.get(accountId) || 0) + cashMovementDirection(movement) * money(movement.amount || 0));
  });
  return Object.fromEntries(balances);
};

export const getCashMonthSummary = ({ month, accounts = [], movements = [], reconciliation, closing } = {}) => {
  const rows = recordsForMonth(movements, month).filter((row) => !row.deleted && !row.internal_transfer);
  const opening = money(closing?.opening_cash || 0);
  const cashIn = rows.filter((row) => cashMovementDirection(row) > 0).reduce((total, row) => total + money(row.amount || 0), 0);
  const cashOut = rows.filter((row) => cashMovementDirection(row) < 0).reduce((total, row) => total + money(row.amount || 0), 0);
  const expected = opening + cashIn - cashOut;
  const actual = reconciliation?.actual_counted_cash == null ? null : money(reconciliation.actual_counted_cash);
  return {
    month, openingCash: opening, cashIn, cashOut, expectedClosingCash: expected,
    actualCountedCash: actual, difference: actual == null ? null : actual - expected,
    ownerWithdrawal: rows.filter((row) => row.source_type === 'owner_withdrawal').reduce((total, row) => total + money(row.amount || 0), 0),
    carriedForward: money(closing?.carried_forward_cash || 0),
    accountBalances: cashAccountBalances({ accounts, movements }),
  };
};

export const calculatePayable = ({ invoice = {}, payments = [] } = {}) => {
  const total = money(invoice.total ?? invoice.total_after_discount ?? 0);
  const paid = payments.filter((payment) => !payment.deleted && payment.invoice_id === invoice.id).reduce((sum, payment) => sum + money(payment.amount || 0), money(invoice.paid_amount || 0));
  return { total, paid: Math.min(total, paid), remaining: Math.max(0, total - paid), status: paid <= 0 ? 'unpaid' : paid < total ? 'partial' : 'paid' };
};

export const convertQuantity = ({ quantity, fromUnit, toUnit, conversion = 1 } = {}) => {
  const value = Number(quantity);
  const factor = Number(conversion);
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(factor) || factor <= 0) throw new Error('تحويل الوحدة غير صحيح.');
  if (fromUnit === toUnit) return value;
  return value * factor;
};

export const deriveDailyTasks = ({ inventory = [], invoices = [], payroll = [], reconciliations = [], stocktakes = [], materialRequests = [], month } = {}) => [
  ...inventory.filter((item) => Number(item.quantity || 0) <= Number(item.min_stock || -1)).map((item) => ({ type: 'low_stock', priority: 'high', title: `مخزون منخفض: ${item.name_ar || item.name || item.id}`, related_record: item.id })),
  ...invoices.filter((item) => calculatePayable({ invoice: item, payments: item.payments || [] }).remaining > 0 && item.due_date && item.due_date <= new Date().toISOString().slice(0, 10)).map((item) => ({ type: 'payable_due', priority: 'high', title: `فاتورة مستحقة: ${item.invoice_number || item.id}`, related_record: item.id })),
  ...payroll.filter((item) => getRecordMonth(item) === month && item.status !== 'paid').map((item) => ({ type: 'payroll_due', priority: 'medium', title: `راتب مستحق: ${item.employee_name || item.employee_id}`, related_record: item.id })),
  ...reconciliations.filter((item) => getRecordMonth(item) === month && Number(item.difference || 0) !== 0).map((item) => ({ type: 'cash_difference', priority: 'high', title: 'فرق صندوق يحتاج مراجعة', related_record: item.id })),
  ...stocktakes.filter((item) => item.status === 'pending').map((item) => ({ type: 'stocktake_pending', priority: 'medium', title: 'جرد ينتظر الاعتماد', related_record: item.id })),
  ...materialRequests.filter((item) => item.status === 'pending').map((item) => ({ type: 'material_request_pending', priority: 'medium', title: 'طلب مادة ينتظر الموافقة', related_record: item.id })),
];

export const shouldSettleDebt = ({ debtAmount = 0, payrollDue = 0, payments = [] } = {}) => {
  const debt = Math.max(0, Number(debtAmount) || 0);
  const dueAfterDebt = Math.max(0, (Number(payrollDue) || 0) - debt);
  return debt > 0 && payrollPaymentState({ due: dueAfterDebt, payments }).remainingAmount === 0;
};

const isLegacyPayroll = (record = {}) => Boolean(
  record.source_sheet === 'ورقة3' || record.import_type === 'legacy_monthly_finance',
);

export const resolvePayrollBaseSalary = ({ employee, payroll = {}, legacy = payroll } = {}) => {
  const employeeAmount = Number(employee?.base_salary);
  const snapshotAmount = Number(payroll?.base_salary_snapshot);
  const legacyAmount = Number(legacy?.base_salary);
  const hasEmployeeSalary = Number.isFinite(employeeAmount) && employeeAmount > 0;
  const hasSnapshot = Number.isFinite(snapshotAmount) && snapshotAmount > 0;
  const hasLegacySalary = Number.isFinite(legacyAmount) && legacyAmount > 0;
  if (hasSnapshot) return { amount: snapshotAmount, source: 'snapshot' };
  if (!isLegacyPayroll(payroll) && hasEmployeeSalary) return { amount: employeeAmount, source: 'employee' };
  if (hasLegacySalary) return { amount: legacyAmount, source: 'legacy' };
  if (hasEmployeeSalary) return { amount: employeeAmount, source: 'employee' };
  return { amount: 0, source: 'unavailable' };
};

export const normalizeLegacyPayroll = (record = {}) => {
  const rawNet = Number(record.net ?? 0);
  const advance = Number(record.advance ?? 0) || 0;
  const signedCashValue = isLegacyPayroll(record) && rawNet < 0 && (advance > 0 || Number(record.base_salary ?? 0) === 0);
  return {
    ...record,
    legacy_signed_cash: signedCashValue,
    legacy_net_due: signedCashValue ? Math.abs(rawNet) : null,
  };
};

export const monthLabel = (month) => month === 'all' ? 'جميع الأشهر' : new Intl.DateTimeFormat('ar-IQ', { month: 'long', year: 'numeric' }).format(new Date(`${month}-01T12:00:00`));

export const compare = (current, prior) => prior > 0 ? Math.round(((current - prior) / prior) * 100) : null;

export const getAvailableMonths = (collections = []) => {
  const months = new Set();
  collections.flat().forEach((record) => { const month = getRecordMonth(record); if (month) months.add(month); });
  return [...months].sort().reverse();
};

// A financial operation can be mirrored into several read models (for example
// a purchase, its cash movement, and an historical source row). Keep identity
// resolution here so every report uses the same accounting count.
export const financialOperationIdentity = (row = {}, source = '') => {
  const stable = row.operation_id || row.operation_key || row.source_key || row.source_id || row.historical_import_id;
  return stable ? String(stable) : `${source}:${row.id || row.key || ''}`;
};

export const financialPaidAmount = (row = {}, source = '') => {
  if (source === 'cash_movements') return Math.max(0, Number(row.amount || 0));
  if (source === 'payroll_payments') return Math.max(0, Number(row.amount || 0));
  if (source === 'payroll') return Math.max(0, Number(row.paid_amount ?? row.paid ?? 0));
  if (source === 'establishment_costs') return Math.max(0, Number(row.paid_amount ?? (row.payment_status === 'unpaid' ? 0 : row.amount) ?? 0));
  if (source === 'purchases') return Math.max(0, Number(row.paid_amount ?? row.paid ?? (row.payment_status === 'unpaid' ? 0 : purchaseRecordTotal(row))));
  if (source === 'expenses') return Math.max(0, Number(row.paid_amount ?? (row.payment_status === 'unpaid' ? 0 : amountOf(row))));
  return Math.max(0, Number(row.paid_amount ?? row.amount ?? row.total ?? 0));
};

const FINISHED_PRODUCT_NAMES = Object.freeze({
  'excel-prod-42': 'براونيز',
  'excel-prod-49': 'مافن',
  'excel-prod-53': 'ساندويش',
});

const catalogName = (catalog = {}, collection, id) => {
  if (!id) return '';
  const row = (catalog[collection] || []).find((item) => String(item.id || item.key) === String(id));
  return row?.name_ar || row?.name || row?.nameAr || row?.name_en || row?.nameEn || '';
};

export const resolveExpenseItemName = (row = {}, catalog = {}) => {
  const productId = row.product_id || row.productId || row.finished_product_id;
  const inventoryId = row.inventory_item_id || row.inventoryItemId || row.material_id;
  return FINISHED_PRODUCT_NAMES[String(productId)]
    || catalogName(catalog, 'products', productId)
    || row.product_name || row.productName || row.inventory_item_name || row.material_name
    || catalogName(catalog, 'inventory_items', inventoryId)
    || row.item_name || row.expense_item || row.item || row.name || row.description || row.details
    || row.reason || 'عنصر غير محدد';
};

const expenseQuantity = (row = {}) => {
  const value = row.quantity ?? row.qty ?? row.quantity_purchased ?? row.purchased_quantity;
  if (value === undefined || value === null || value === '' || !Number.isFinite(Number(value))) return null;
  return Number(value);
};

const expenseUnit = (row = {}) => row.unit || row.unit_name || row.purchase_unit || row.base_unit || '';

// Reporting-only second-level aggregation. It deliberately consumes the rows
// already selected by buildMonthlyFinancialAggregation and never writes stock.
export const buildMonthlyExpenseDetails = ({ rows = [], catalog = {}, categoryOf = (row) => row.category_name || row.category || 'أخرى' } = {}) => {
  const groups = new Map();
  rows.forEach((row) => {
    const category = categoryOf(row) || 'أخرى';
    const lines = Array.isArray(row.items) && row.items.length ? row.items : [row];
    const parentAmount = Number(row.amount_display ?? row.amount ?? row.total_after_discount ?? row.total_price ?? row.total ?? 0) || 0;
    const lineQuantities = lines.map(expenseQuantity);
    const totalLineQuantity = lineQuantities.reduce((sum, value) => sum + (value === null ? 0 : Math.max(0, value)), 0);
    lines.forEach((line, index) => {
      const detail = line === row ? row : { ...row, ...line, date: line.date || row.date, id: `${row.id || row.key || 'row'}:${index}` };
      const name = resolveExpenseItemName(detail, catalog);
      const unit = expenseUnit(detail);
      const key = `${category}\u0000${name}\u0000${unit}`;
      const explicitLineAmount = line.line_total ?? line.amount ?? line.total_after_discount ?? line.total_price ?? line.total;
      const amount = explicitLineAmount !== undefined && explicitLineAmount !== null && explicitLineAmount !== ''
        ? Number(explicitLineAmount) || 0
        : lines.length === 1
          ? parentAmount
          : totalLineQuantity > 0 && lineQuantities[index] !== null
            ? parentAmount * Math.max(0, lineQuantities[index]) / totalLineQuantity
            : parentAmount / lines.length;
      const bucket = groups.get(key) || { name, category, unit, amount: 0, quantity: 0, hasQuantity: false, movementCount: 0, rows: [] };
      bucket.amount += amount;
      const quantity = expenseQuantity(detail);
      if (quantity !== null) { bucket.quantity += quantity; bucket.hasQuantity = true; }
      bucket.movementCount += 1;
      bucket.rows.push(detail);
      groups.set(key, bucket);
    });
  });
  const items = [...groups.values()].map((item) => ({ ...item, rows: item.rows.sort((a, b) => String(getRecordDate(b) || '').localeCompare(String(getRecordDate(a) || ''))) }));
  const categories = [...items.reduce((map, item) => {
    const bucket = map.get(item.category) || { name: item.category, total: 0, movementCount: 0, items: [] };
    bucket.total += item.amount;
    bucket.movementCount += item.movementCount;
    bucket.items.push(item);
    map.set(item.category, bucket);
    return map;
  }, new Map()).values()];
  categories.forEach((category) => category.items.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'ar')));
  return { items, categories };
};

export const buildMonthlyFinancialAggregation = ({ sources = {}, month = 'all' } = {}) => {
  const priority = ['expenses', 'purchases', 'assets', 'establishment_costs', 'payroll_payments', 'payroll', 'cash_movements', 'historical_imports'];
  const candidates = priority.flatMap((source) => (sources[source] || []).map((row) => ({ ...row, __source: source })));
  const representedReferences = new Set(candidates.filter((row) => row.__source !== 'cash_movements').flatMap((row) => [row.id, row.key, row.operation_id, row.operation_key, row.source_key, row.source_id, row.historical_import_id].filter(Boolean).map(String)));
  const seen = new Map();
  const rows = [];
  const duplicateKeys = new Set();
  candidates.filter((row) => !row.deleted && (row.__source !== 'cash_movements' || cashMovementDirection(row) < 0) && (!month || month === 'all' || getRecordMonth(row) === month)).forEach((row) => {
    const identity = row.__source === 'payroll_payments'
      ? `payroll:${row.payroll_id || row.id || row.key || ''}`
      : row.__source === 'payroll'
        ? `payroll:${row.id || row.key || ''}`
        : financialOperationIdentity(row, row.__source);
    const existing = seen.get(identity);
    if (row.__source === 'cash_movements' && [row.source_id, row.source_key, row.operation_id, row.operation_key].filter(Boolean).some((value) => representedReferences.has(String(value)))) {
      duplicateKeys.add(identity);
      return;
    }
    if (existing) {
      duplicateKeys.add(identity);
      // Cash movement/payroll payment rows are mirrors when their source is
      // already represented. Do not add their amount twice.
      return;
    }
    seen.set(identity, row);
    const accountingClass = row.accounting_class || (row.__source === 'assets' ? 'fixed_asset' : row.__source === 'purchases' ? 'supplies' : row.__source === 'payroll' || row.__source === 'payroll_payments' ? 'payroll' : row.__source === 'establishment_costs' ? 'setup_cost' : 'operating_expense');
    rows.push({ ...row, accounting_class: accountingClass, amount_display: financialPaidAmount(row, row.__source), source_display: row.__source, operation_identity: identity });
  });
  const active = rows.filter((row) => row.amount_display > 0 || row.__source === 'payroll');
  const total = (predicate = () => true) => active.filter(predicate).reduce((n, row) => n + row.amount_display, 0);
  const categories = active.reduce((out, row) => { const key = row.accounting_class === 'fixed_asset' ? 'أصول وتجهيزات' : row.accounting_class === 'payroll' ? 'رواتب وأجور' : row.__category || row.category_name || row.category || (row.__source === 'purchases' ? 'مواد غذائية وحلويات' : 'أخرى'); const bucket = out[key] || { name: key, count: 0, total: 0 }; bucket.count += 1; bucket.total += row.amount_display; out[key] = bucket; return out; }, {});
  const hasStableIdentity = (row) => row.operation_id || row.operation_key || row.source_key || row.source_id || row.historical_import_id || row.__source === 'payroll_payments' && row.payroll_id;
  return { rows: active, record_count: active.length, cash_outflow: total(), operating_expenses: total((row) => row.accounting_class === 'operating_expense' || row.accounting_class === 'expense'), purchases: total((row) => ['purchase', 'supplies'].includes(row.accounting_class) || row.__source === 'purchases'), payroll: total((row) => row.accounting_class === 'payroll'), assets: total((row) => row.accounting_class === 'fixed_asset'), other: total((row) => !['operating_expense', 'expense', 'purchase', 'supplies', 'payroll', 'fixed_asset'].includes(row.accounting_class)), categories: Object.values(categories).filter((item) => item.total > 0), duplicates: duplicateKeys.size, unresolved: active.filter((row) => !getRecordMonth(row) || !hasStableIdentity(row)).length };
};

export const buildDateRangeFinancialAggregation = ({ sources = {}, fromDate = '', toDate = '' } = {}) => {
  const filteredSources = Object.fromEntries(Object.entries(sources).map(([source, rows]) => [source, (rows || []).filter((row) => {
    if (row.deleted) return false;
    const date = getRecordDate(row);
    return date && (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
  })]));
  return buildMonthlyFinancialAggregation({ sources: filteredSources, month: 'all' });
};

export const calculatePayroll = (payroll = {}, adjustments = [], payments = [], employee) => {
  const relevant = adjustments.filter((item) => item.payroll_id === payroll.id || (item.employee_id === payroll.employee_id && item.month === payroll.month));
  const total = (type) => relevant.filter((item) => item.type === type).reduce((n, item) => n + Number(item.amount || 0), 0);
  const additions_total = total('addition') + total('manual_adjustment');
  const bonuses_total = total('bonus');
  const deductions_total = total('deduction');
  const legacy = normalizeLegacyPayroll(payroll);
  const linkedLegacyAdvance = relevant.some((item) => item.type === 'advance' && item.source === 'employee_advance');
  const rawLegacyAdvance = Number(legacy.advance ?? 0) || 0;
  const advances_total = legacy.legacy_signed_cash
    ? (linkedLegacyAdvance ? total('advance') : rawLegacyAdvance)
    : total('advance');
  const resolvedBase = resolvePayrollBaseSalary({ employee, payroll, legacy: payroll });
  const base_salary_snapshot = resolvedBase.amount;
  const gross_salary = base_salary_snapshot + additions_total + bonuses_total;
  const net_salary = legacy.legacy_signed_cash
    ? Math.max(0, Number(legacy.legacy_net_due) + additions_total + bonuses_total - deductions_total)
    : Math.max(0, gross_salary - deductions_total - advances_total);
  const paymentTotal = payments.filter((item) => item.payroll_id === payroll.id).reduce((n, item) => n + Number(item.amount || 0), 0);
  const paid_amount = paymentTotal || Number(payroll.paid_amount ?? payroll.paid ?? 0);
  return { ...payroll, ...legacy, base_salary_snapshot, resolved_base_salary: resolvedBase.amount, base_salary_source: resolvedBase.source, additions_total, bonuses_total, deductions_total, advances_total, gross_salary, net_salary, paid_amount, remaining_amount: Math.max(net_salary - paid_amount, 0), status: paid_amount <= 0 ? 'unpaid' : paid_amount < net_salary ? 'partial' : 'paid' };
};

export const eligibleEmployeeDebts = ({ debts = [], employeeId, month }) => debts.filter((debt) => (
  !debt.deleted && String(debt.employee_id) === String(employeeId)
  && (debt.status === 'open' || (debt.status === 'settled' && String(debt.settled_month) === String(month)))
  && String(getRecordMonth(debt) || '').slice(0, 7) <= String(month || '9999-99')
));

export const buildPayrollRows = ({ payroll = [], employees = [], month }) => {
  const employeeById = new Map(employees.flatMap((employee) => {
    const id = employee.id || employee.employee_id;
    return id ? [[String(id), employee]] : [];
  }));
  const employeeByName = new Map(employees.map((employee) => [String(employee.name || employee.name_ar || '').trim().toLocaleLowerCase(), employee]));
  const existing = recordsForMonth(payroll, month).filter((row) => {
    const employee = employeeById.get(String(row.employee_id || row.employee || ''))
      || employeeByName.get(String(row.employee_name || '').trim().toLocaleLowerCase());
    return !employee || isEmployeeOperationallyActive(employee);
  });
  if (month === 'all') return existing;
  const existingEmployees = new Set(existing.map((row) => row.employee_id || row.employee));
  const virtual = employees.filter((employee) => isEmployeeOperationallyActive(employee) && (employee.id || employee.employee_id) && !existingEmployees.has(employee.id || employee.employee_id)).map((employee) => ({
    id: `virtual-${employee.id || employee.employee_id}-${month}`,
    employee_id: employee.id || employee.employee_id,
    employee_name: employee.name || employee.name_ar || '',
    month,
    base_salary_snapshot: Number(employee.base_salary || 0),
    paid_amount: 0,
    status: 'unpaid',
    virtual: true,
  }));
  return [...existing, ...virtual];
};

export const calculatePayrollWithDebts = ({ payroll = {}, adjustments = [], payments = [], debts = [], employee, month = payroll.month } = {}) => {
  const calculated = calculatePayroll(payroll, adjustments, payments, employee);
  const eligible = eligibleEmployeeDebts({ debts, employeeId: payroll.employee_id, month });
  const debtTotal = eligible.reduce((total, debt) => total + Number(debt.amount || 0), 0);
  const due = Math.max(0, calculated.net_salary - debtTotal);
  return { ...calculated, eligible_debts: eligible, debts_total: debtTotal, net_salary: due, remaining_amount: Math.max(0, due - calculated.paid_amount), status: calculated.paid_amount <= 0 ? 'unpaid' : calculated.paid_amount < due ? 'partial' : 'paid' };
};

const typedLegacyDetails = (records = [], month) => recordsForMonth(records, month).filter((record) => record.source_sheet === 'ورقة2' || record.legacy_type);
const nonDeleted = (records = []) => records.filter((record) => !record.deleted);
const isLegacyFinancialRecord = (record = {}) => Boolean(
  record.source_sheet || record.legacy_type || record.import_type === 'legacy_monthly_finance',
);

export const getMonthlySales = ({ transactions = [], legacySummaries = [], month }) => {
  const legacy = recordsForMonth(nonDeleted(legacySummaries), month).filter((row) => row.amount != null);
  // Imported legacy rows are represented by the monthly summary.  Exclude any
  // duplicate import artifacts here, but keep separately-created modern sales.
  const details = recordsForMonth(nonDeleted(transactions), month).filter((record) => !record.establishment_reclassified && !isLegacyFinancialRecord(record));
  if (details.length) {
    const modernTotal = details.reduce((value, record) => value + getSalesTransactionNet(record), 0);
    const modernDiscount = details.reduce((value, record) => value + explicitNumber(record, ['discount_amount', 'discount']), 0);
    const electronic = details.filter((record) => isElectronicPayment(record.payment_method)).reduce((value, record) => value + getSalesTransactionNet(record), 0);
    if (legacy.length) {
      const legacyGross = sumLegacy(legacy, getLegacyGrossSales);
      const legacyDiscount = sumLegacy(legacy, getLegacyDiscount);
      return { total: legacyGross - legacyDiscount + modernTotal, gross: legacyGross + modernTotal + modernDiscount, discount: legacyDiscount + modernDiscount, electronic: sumLegacy(legacy, getLegacyElectronic) + electronic, otherIncome: sumLegacy(legacy, getLegacyOtherIncome), count: legacy.length + details.length, source: 'legacy_plus_sales', resolution: 'separate_legacy_and_modern_sources' };
    }
    return { total: modernTotal, gross: modernTotal + modernDiscount, discount: modernDiscount, electronic, otherIncome: null, count: details.length, source: 'sales', resolution: 'modern_transactions' };
  }
  if (legacy.length) {
    const gross = sumLegacy(legacy, getLegacyGrossSales);
    const discount = sumLegacy(legacy, getLegacyDiscount);
    return { total: gross - discount, gross, discount, electronic: sumLegacy(legacy, getLegacyElectronic), otherIncome: sumLegacy(legacy, getLegacyOtherIncome), count: legacy.length, source: 'legacy_monthly_summaries', resolution: 'verified_legacy_summary' };
  }
  if (!legacy.length) return { total: 0, gross: 0, discount: 0, electronic: 0, otherIncome: 0, count: 0, source: 'EMPTY_PERIOD' };
};

export const getMonthlyOtherIncome = ({ records = [], legacySummaries = [], month }) => {
  const legacy = recordsForMonth(nonDeleted(legacySummaries), month);
  const modern = recordsForMonth(nonDeleted(records), month);
  const legacyTotal = sumLegacy(legacy, getLegacyOtherIncome);
  const modernTotal = modern.reduce((total, record) => total + explicitNumber(record, ['amount']), 0);
  if (!legacy.length && !modern.length) return { total: 0, legacy: 0, modern: 0, count: 0, source: 'EMPTY_PERIOD' };
  return { total: legacyTotal + modernTotal, legacy: legacy.length ? legacyTotal : 0, modern: modern.length ? modernTotal : 0, count: legacy.length + modern.length, source: legacy.length ? (modern.length ? 'legacy_plus_other_income' : 'legacy_monthly_summaries') : 'other_income' };
};

export const getMonthlyPurchases = ({ transactions = [], legacyDetails = [], legacySummaries = [], month }) => {
  const legacyMonth = recordsForMonth(nonDeleted(legacySummaries), month).length > 0;
  const typed = typedLegacyDetails(legacyDetails, month).filter((row) => row.legacy_type === 'purchase');
  const details = recordsForMonth(nonDeleted(transactions), month).filter((record) => !isLegacyFinancialRecord(record));
  if (legacyMonth && typed.length) {
    const modernTotal = sum(details, 'total_price');
    return { total: sum(typed, 'amount') + modernTotal, count: typed.length + details.length, source: details.length ? 'legacy_details_plus_purchases' : 'legacy_details', resolution: details.length ? 'separate_legacy_and_modern_sources' : 'verified_legacy_details' };
  }
  if (details.length) return { total: sum(details, 'total_price'), count: details.length, source: 'purchases', resolution: 'modern_transactions' };
  if (legacyMonth) return { total: null, count: 0, source: 'NOT AVAILABLE', resolution: 'legacy_details_missing' };
  if (typed.length) return { total: sum(typed, 'amount'), count: typed.length, source: 'legacy_details' };
  const legacy = recordsForMonth(nonDeleted(legacySummaries), month).filter((row) => row.purchases != null);
  return { total: legacy.length ? sumLegacy(legacy, getLegacyPurchases) : 0, count: legacy.length, source: legacy.length ? 'legacy_monthly_summaries' : 'EMPTY_PERIOD' };
};

export const purchaseRecordTotal = (record = {}) => Number(record.total_after_discount ?? record.total_price ?? record.total ?? record.amount ?? 0) || 0;

// The operational purchases screen has two compatible historical sources:
// `/purchases` is the canonical transaction source used by reports, while
// `/purchase_invoices` contains the multi-line invoice workflow. Keep both
// visible without making either source silently replace the other.
const purchaseDate = (row = {}) => normalizeDate(row.date || row.purchase_date || row.created_at);
const purchaseOperationKey = (row = {}) => row.operation_key || row.operation_id || row.source_key || row.invoice_number || '';
const normalizePurchaseRow = (row = {}, source) => ({
  ...row,
  id: row.id || row.key,
  date: purchaseDate(row),
  month: getRecordMonth(row),
  total: purchaseRecordTotal(row),
  paid_amount: Number(row.paid_amount ?? row.paid ?? 0) || 0,
  remaining_amount: Number(row.remaining_amount ?? row.remaining ?? Math.max(0, purchaseRecordTotal(row) - Number(row.paid_amount ?? row.paid ?? 0))) || 0,
  supplier_name: row.supplier_name || row.trader_name || row.company_name || row.supplier || '',
  payment_method: row.payment_method || '',
  purchase_source: source,
});

// One operational view for the page, reports, and Excel. Older records may not
// contain operation keys, so only deduplicate when a stable identity exists.
export const resolvePurchaseRows = ({ purchases = [], invoices = [], month = 'all' } = {}) => {
  const seen = new Set();
  return [...purchases.map((row) => normalizePurchaseRow(row, 'purchases')), ...invoices.map((row) => normalizePurchaseRow(row, 'purchase_invoices'))]
    .filter((row) => !row.deleted && !row.establishment_reclassified && recordsForMonth([row], month).length > 0)
    .filter((row) => {
      const key = purchaseOperationKey(row);
      if (!key) return true;
      const identity = `${key}|${row.total}|${row.date}|${row.supplier_id || row.supplier_name}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
};

export const getMonthlyExpenses = ({ transactions = [], legacyDetails = [], legacySummaries = [], month }) => {
  const legacyMonth = recordsForMonth(nonDeleted(legacySummaries), month).length > 0;
  const typed = typedLegacyDetails(legacyDetails, month).filter((row) => row.legacy_type === 'expense');
  const details = recordsForMonth(nonDeleted(transactions), month).filter((row) => !row.establishment_reclassified && !isLegacyFinancialRecord(row));
  if (legacyMonth && typed.length) {
    return { total: sum(typed, 'amount') + sum(details, 'amount'), count: typed.length + details.length, source: details.length ? 'legacy_details_plus_expenses' : 'legacy_details', resolution: details.length ? 'separate_legacy_and_modern_sources' : 'verified_legacy_details', breakdown: [...typed, ...details] };
  }
  if (details.length) return { total: sum(details, 'amount'), count: details.length, source: 'expenses', breakdown: details };
  if (legacyMonth) return { total: null, count: 0, source: 'NOT AVAILABLE', resolution: 'legacy_details_missing', breakdown: [] };
  return { total: typed.length ? sum(typed, 'amount') : 0, count: typed.length, source: typed.length ? 'legacy_details' : 'EMPTY_PERIOD', breakdown: typed };
};

export const getMonthlyPayrollCost = ({ payroll = [], adjustments = [], payments = [], legacyCosts = [], month }) => {
  const rows = recordsForMonth(nonDeleted(payroll), month);
  const modernRows = rows.filter((row) => !isLegacyPayroll(row));
  // Complete modern payroll always wins.  Historical manual totals are a
  // month-level fallback and are never combined with employee payroll rows.
  if (modernRows.length && modernRows.length === rows.length) {
    const calculated = modernRows.map((row) => calculatePayroll(row, adjustments, payments));
    return { total: calculated.reduce((n, row) => n + row.net_salary, 0), count: calculated.length, source: 'payroll', rows: calculated };
  }
  const manual = recordsForMonth(nonDeleted(legacyCosts), month).find((row) => Number(row.amount) > 0);
  if (manual) return { total: Number(manual.amount), count: 1, source: 'manual_legacy', rows: [], record: manual };
  if (!rows.length) return { total: 0, count: 0, source: 'EMPTY_PERIOD', rows: [] };
  if (rows.some(isLegacyPayroll)) return { total: null, count: rows.length, source: 'legacy_payroll_incomplete', rows: [] };
  return { total: null, count: 0, source: 'NOT AVAILABLE', rows: [] };
};

export const getMonthlyPayrollPaid = ({ payroll = [], adjustments = [], payments = [], month }) => {
  const result = getMonthlyPayrollCost({ payroll, adjustments, payments, month });
  return { total: result.total == null ? null : result.rows.reduce((n, row) => n + row.paid_amount, 0), count: result.count, source: result.source };
};

export const getMonthlyCashMovement = ({ movements = [], month }) => {
  const rows = recordsForMonth(nonDeleted(movements), month);
  if (!rows.length) return { total: null, inflow: null, outflow: null, count: 0, source: 'NOT AVAILABLE' };
  const inflow = rows.filter((row) => !String(row.type || '').toLowerCase().includes('out')).reduce((n, row) => n + amountOf(row), 0);
  const outflow = rows.filter((row) => String(row.type || '').toLowerCase().includes('out')).reduce((n, row) => n + amountOf(row), 0);
  return { total: inflow - outflow, inflow, outflow, count: rows.length, source: 'cash_movements' };
};

export const getMonthlyProfit = ({ sales, otherIncome = { total: 0 }, purchases, expenses, payroll }) => {
  if ([sales, otherIncome, purchases, expenses, payroll].some((item) => item?.total == null)) return null;
  return sales.total + otherIncome.total - purchases.total - expenses.total - payroll.total;
};

export const buildPartnerCapitalSummary = ({ partners = [], payments = [] } = {}) => {
  const rows = partners.filter((row) => !row.deleted).map((partner) => {
    const paid = payments.filter((payment) => !payment.deleted && payment.partner_id === partner.id)
      .reduce((total, payment) => total + Number(payment.amount || 0), 0);
    const agreed = Number(partner.agreed_capital || 0);
    return { ...partner, agreed_capital: agreed, paid_capital: paid, remaining_capital: Math.max(0, agreed - paid) };
  });
  return {
    partners: rows,
    agreed: rows.reduce((total, row) => total + row.agreed_capital, 0),
    paid: rows.reduce((total, row) => total + row.paid_capital, 0),
    remaining: rows.reduce((total, row) => total + row.remaining_capital, 0),
  };
};

export const buildEstablishmentReport = ({ costs = [], partners = [], partnerPayments = [] } = {}) => {
  const rows = costs.filter((row) => !row.deleted);
  const byCategory = rows.reduce((out, row) => {
    const key = row.category_name || row.category || 'تكاليف تأسيس أخرى';
    const bucket = out[key] || { category: key, total: 0, paid: 0, remaining: 0 };
    bucket.total += Number(row.amount || 0);
    bucket.paid += Number(row.paid_amount ?? (row.payment_status === 'unpaid' ? 0 : row.amount) ?? 0);
    bucket.remaining += Number(row.remaining_amount ?? Math.max(0, Number(row.amount || 0) - Number(row.paid_amount || 0)));
    out[key] = bucket;
    return out;
  }, {});
  const capital = buildPartnerCapitalSummary({ partners, payments: partnerPayments });
  return {
    rows,
    byCategory: Object.values(byCategory).sort((a, b) => b.total - a.total),
    total: rows.reduce((total, row) => total + Number(row.amount || 0), 0),
    paid: rows.reduce((total, row) => total + Number(row.paid_amount ?? (row.payment_status === 'unpaid' ? 0 : row.amount) ?? 0), 0),
    remaining: rows.reduce((total, row) => total + Number(row.remaining_amount ?? Math.max(0, Number(row.amount || 0) - Number(row.paid_amount || 0))), 0),
    capital,
  };
};

// Dashboard-only cash breakdown.  Cash sales are resolved from payment
// methods, never inferred from net sales when a row has another non-cash
// method.  Legacy summaries may only expose electronic totals, so their
// residual is usable only when the summary explicitly has no other method
// bucket.
export const getMonthlySalesBreakdown = ({ transactions = [], legacySummaries = [], month }) => {
  const legacy = recordsForMonth(nonDeleted(legacySummaries), month).filter((row) => row.amount != null);
  const details = recordsForMonth(nonDeleted(transactions), month).filter((record) => !isLegacyFinancialRecord(record));
  const detailBreakdown = details.reduce((total, row) => {
    const hasCashComponent = hasExplicitNumber(row, CASH_COMPONENT_FIELDS);
    const hasElectronicComponent = hasExplicitNumber(row, ELECTRONIC_COMPONENT_FIELDS);
    // A genuine split payment has explicit component amounts.  Preserve both
    // components rather than classifying the entire sale by a single method.
    if (hasCashComponent || hasElectronicComponent) {
      const cash = hasCashComponent ? explicitSum(row, CASH_COMPONENT_FIELDS) : 0;
      const electronic = hasElectronicComponent ? explicitSum(row, ELECTRONIC_COMPONENT_FIELDS) : 0;
      const remainder = Math.max(0, getSalesTransactionNet(row) - cash - electronic);
      total.cash += cash;
      total.electronic += electronic;
      total.unclassified += remainder;
      return total;
    }
    const net = getSalesTransactionNet(row);
    const method = resolvePaymentMethod(row.payment_method);
    if (method === 'cash') total.cash += net;
    else if (method === 'electronic') total.electronic += net;
    else if (method === 'other') total.otherNonCash += net;
    else total.unclassified += net;
    return total;
  }, { cash: 0, electronic: 0, otherNonCash: 0, unclassified: 0 });
  const legacyElectronic = sumLegacy(legacy, getLegacyElectronic);
  // A legacy row that only stores the electronic aggregate is not proof that
  // its remaining net sales are physical cash.  Count cash only when its own
  // payment data says so, preserving any unknown historical bucket separately.
  const legacyCash = sumLegacy(legacy, (row) => {
    const explicitCash = explicitNumber(row, ['cash_sales', 'cashSales']);
    return explicitCash || (isCashPayment(row.payment_method) ? Math.max(0, getLegacyGrossSales(row) - getLegacyDiscount(row)) : 0);
  });
  const legacyNet = sumLegacy(legacy, (row) => Math.max(0, getLegacyGrossSales(row) - getLegacyDiscount(row)));
  const legacyUnclassified = Math.max(0, legacyNet - legacyCash - legacyElectronic);
  return { cash: legacyCash + detailBreakdown.cash, electronic: legacyElectronic + detailBreakdown.electronic, otherNonCash: detailBreakdown.otherNonCash, unclassified: legacyUnclassified + detailBreakdown.unclassified, count: details.length + legacy.length };
};

export const getImmediateCashPurchasePaid = (rows = []) => rows.reduce((total, row) => {
  const explicitPaid = row.paid_amount != null || row.paid != null;
  const paid = explicitPaid ? Number(row.paid_amount ?? row.paid ?? 0) : (isCashPayment(row.payment_method) ? Number(row.total || 0) : 0);
  return total + (isCashPayment(row.payment_method) ? Math.max(0, paid) : 0);
}, 0);

export const getMonthlyEmployeeAdvances = ({ advances = [], month }) => {
  const rows = recordsForMonth(nonDeleted(advances), month);
  if (!rows.length) return { total: null, count: 0, source: 'NOT AVAILABLE' };
  return { total: rows.reduce((n, row) => n + Number(row.amount ?? row.advance ?? 0), 0), count: rows.length, source: 'employee_advances' };
};

export const getMonthlyLegacyWithdrawals = ({ payroll = [], advances = [], month }) => {
  const legacyPayroll = recordsForMonth(nonDeleted(payroll), month)
    .filter(isLegacyPayroll)
    .filter((row) => row.advance !== undefined && row.advance !== null && row.advance !== '');
  if (legacyPayroll.length) {
    return {
      total: legacyPayroll.reduce((value, row) => value + explicitNumber(row, ['advance']), 0),
      count: legacyPayroll.length,
      source: 'legacy_payroll_advance',
    };
  }
  return getMonthlyEmployeeAdvances({ advances, month });
};

export const calculateSalaryDue = ({ baseSalarySnapshot = 0, bonuses = 0, deductions = 0, openDebts = 0 }) =>
  Math.max(0, Number(baseSalarySnapshot || 0) + Number(bonuses || 0) - Number(deductions || 0) - Number(openDebts || 0));
