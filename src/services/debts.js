import { getRecordMonth, normalizeDate } from './financial.js';

export const DEBT_TYPES = { payable: 'عليّ', receivable: 'إليّ' };
export const debtAmount = (row = {}) => Number(row.original_amount ?? row.amount ?? 0) || 0;
export const debtPaid = (row = {}) => Number(row.paid_amount ?? row.received_amount ?? row.paid ?? 0) || 0;
export const debtRemaining = (row = {}) => Math.max(0, Number(row.remaining_amount ?? (debtAmount(row) - debtPaid(row))) || 0);
export const debtStatus = (row = {}) => {
  const remaining = debtRemaining(row);
  if (remaining <= 0) return 'paid';
  const due = normalizeDate(row.due_date);
  if (due && due < new Date().toISOString().slice(0, 10)) return 'overdue';
  return debtPaid(row) > 0 ? 'partial' : 'unpaid';
};

export const normalizeDebt = (row = {}, payments = []) => {
  const original = debtAmount(row);
  const linkedPayments = payments.filter((payment) => payment.debt_id === row.id && !payment.deleted);
  const paid = linkedPayments.length
    ? Number(row.initial_paid_amount || 0) + linkedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
    : debtPaid(row);
  return { ...row, id: row.id, type: row.type === 'receivable' ? 'receivable' : 'payable', original_amount: original, paid_amount: paid, remaining_amount: Math.max(0, original - paid), month: getRecordMonth(row), status: debtStatus({ ...row, original_amount: original, paid_amount: paid }) };
};

export const resolveDebts = ({ debts = [], payments = [], month = 'all', asOf = '' } = {}) => debts
  .filter((row) => !row.deleted)
  .map((row) => normalizeDebt(row, payments))
  .filter((row) => !asOf || String(row.debt_date || row.date || row.created_at || '').slice(0, 10) <= asOf)
  .filter((row) => month === 'all' || !month || row.month <= month || row.remaining_amount <= 0)
  .sort((a, b) => String(b.debt_date || b.date || '').localeCompare(String(a.debt_date || a.date || '')));

export const debtTotals = (rows = []) => rows.reduce((out, row) => { out[row.type] = (out[row.type] || 0) + row.remaining_amount; return out; }, { payable: 0, receivable: 0 });
