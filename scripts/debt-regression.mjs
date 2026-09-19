import assert from 'node:assert/strict';
import { debtTotals, normalizeDebt, resolveDebts } from '../src/services/debts.js';

const debts = [
  { id: 'august', type: 'payable', party_name: 'TEST Internet', original_amount: 100000, debt_date: '2026-08-28', month: '2026-08', status: 'unpaid' },
  { id: 'sep-receivable', type: 'receivable', party_name: 'TEST Customer', original_amount: 250000, debt_date: '2026-09-01', month: '2026-09', status: 'unpaid' },
];
const payments = [
  { id: 'p1', debt_id: 'august', type: 'payable', amount: 30000, date: '2026-09-10', month: '2026-09' },
  { id: 'p2', debt_id: 'sep-receivable', type: 'receivable', amount: 50000, date: '2026-09-12', month: '2026-09' },
];
const september = resolveDebts({ debts, payments, month: '2026-09' });
assert.equal(september.length, 2);
assert.equal(september.find((row) => row.id === 'august').remaining_amount, 70000);
assert.equal(september.find((row) => row.id === 'sep-receivable').remaining_amount, 200000);
assert.deepEqual(debtTotals(september), { payable: 70000, receivable: 200000 });
assert.equal(normalizeDebt({ id: 'paid', type: 'payable', original_amount: 10, paid_amount: 10 }).status, 'paid');
console.log('debt-regression: PASS');
