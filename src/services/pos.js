const asRows = (value) => Array.isArray(value) ? value : [];
const amountOf = (row) => Number(row?.total_after_discount ?? row?.net_amount ?? row?.total ?? row?.amount ?? 0) || 0;
const dateOf = (row) => String(row?.date || row?.created_at || row?.opened_at || '').slice(0, 10);
const isActiveSale = (row) => !row?.deleted && row?.status !== 'voided' && row?.status !== 'cancelled';
const isPosRow = (row) => String(row?.source_channel || '').toUpperCase() === 'POS101';

export const filterPosRows = (rows, filters = {}) => asRows(rows).filter((row) => {
  const date = dateOf(row);
  if (filters.fromDate && date < filters.fromDate) return false;
  if (filters.toDate && date > filters.toDate) return false;
  if (filters.cashier && String(row.cashier_uid || row.cashier_name || '') !== String(filters.cashier)) return false;
  if (filters.shift && String(row.shift_id || '') !== String(filters.shift)) return false;
  if (filters.payment && String(row.payment_method || '') !== String(filters.payment)) return false;
  if (filters.orderType && String(row.order_type || row.orderType || '') !== String(filters.orderType)) return false;
  return true;
});

export const calculatePosSummary = ({ sales = [], expenses = [], movements = [] } = {}) => {
  const validSales = asRows(sales).filter(isActiveSale);
  const salesTotal = validSales.reduce((sum, row) => sum + amountOf(row), 0);
  const expensesTotal = asRows(expenses).filter((row) => !row.deleted).reduce((sum, row) => sum + amountOf(row), 0);
  const cashSales = validSales.filter((row) => row.payment_method === 'cash').reduce((sum, row) => sum + amountOf(row), 0);
  const electronicSales = validSales.filter((row) => row.payment_method === 'electronic').reduce((sum, row) => sum + amountOf(row), 0);
  const cashIn = asRows(movements).filter((row) => row.type === 'IN' && !row.deleted).reduce((sum, row) => sum + amountOf(row), 0);
  const cashOut = asRows(movements).filter((row) => row.type === 'OUT' && !row.deleted).reduce((sum, row) => sum + amountOf(row), 0);
  return { salesTotal, expensesTotal, net: salesTotal - expensesTotal, orderCount: validSales.length, cashSales, electronicSales, cashIn, cashOut, averageTicket: validSales.length ? salesTotal / validSales.length : 0 };
};

export const buildCashierRows = ({ sales = [], expenses = [], shifts = [] } = {}) => {
  const keys = new Set([...asRows(shifts).map((row) => row.cashier_uid || row.cashier_name), ...asRows(sales).map((row) => row.cashier_uid || row.cashier_name)].filter(Boolean));
  return [...keys].map((key) => {
    const own = (row) => String(row.cashier_uid || row.cashier_name || '') === String(key);
    const ownSales = asRows(sales).filter((row) => own(row) && isActiveSale(row));
    const ownExpenses = asRows(expenses).filter((row) => own(row) && !row.deleted);
    const shift = asRows(shifts).find(own);
    const cash = ownSales.filter((row) => row.payment_method === 'cash').reduce((n, row) => n + amountOf(row), 0);
    const electronic = ownSales.filter((row) => row.payment_method === 'electronic').reduce((n, row) => n + amountOf(row), 0);
    const expenseTotal = ownExpenses.reduce((n, row) => n + amountOf(row), 0);
    return { id: shift?.id || String(key), cashier_name: shift?.cashier_name || ownSales[0]?.cashier_name || String(key), shift_id: shift?.id || '', opened_at: shift?.opened_at || '', closed_at: shift?.closed_at || '', invoice_count: ownSales.length, cash_sales: cash, electronic_sales: electronic, expenses: expenseTotal, net: cash + electronic - expenseTotal, status: shift?.status || 'غير مرتبط' };
  });
};

export const buildPosReconciliation = ({ posSales = [], accSales = [], posExpenses = [], accExpenses = [] } = {}) => {
  const sum = (rows) => rows.reduce((n, row) => n + amountOf(row), 0);
  const salesPos = sum(posSales), salesAcc = sum(accSales), expensesPos = sum(posExpenses), expensesAcc = sum(accExpenses);
  const status = (left, right, leftRows, rightRows) => {
    if ((leftRows.length === 0) !== (rightRows.length === 0)) return 'UNMATCHED';
    return left === right ? 'MATCHED' : 'DIFFERENCE';
  };
  return { sales: { pos: salesPos, acc: salesAcc, difference: salesPos - salesAcc, status: status(salesPos, salesAcc, posSales, accSales) }, expenses: { pos: expensesPos, acc: expensesAcc, difference: expensesPos - expensesAcc, status: status(expensesPos, expensesAcc, posExpenses, accExpenses) } };
};

export { amountOf, dateOf, isActiveSale, isPosRow };
