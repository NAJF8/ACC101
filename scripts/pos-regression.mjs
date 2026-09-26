import assert from 'node:assert/strict';
import { buildCashierRows, buildPosReconciliation, calculatePosSummary, filterPosRows } from '../src/services/pos.js';

const sales = [
  { id: 'a', source_channel: 'POS101', date: '2026-09-01', total_after_discount: 10000, payment_method: 'cash', cashier_uid: 'u1', shift_id: 's1' },
  { id: 'b', source_channel: 'POS101', date: '2026-09-01', total_after_discount: 5000, payment_method: 'electronic', cashier_uid: 'u1', shift_id: 's1' },
  { id: 'c', source_channel: 'POS101', date: '2026-09-02', total_after_discount: 9000, payment_method: 'cash', status: 'voided', cashier_uid: 'u2', shift_id: 's2' },
];
const expenses = [{ id: 'e1', source_channel: 'POS101', date: '2026-09-01', amount: 2000, cashier_uid: 'u1', shift_id: 's1' }];
const summary = calculatePosSummary({ sales, expenses });
assert.deepEqual(summary, { salesTotal: 15000, expensesTotal: 2000, net: 13000, orderCount: 2, cashSales: 10000, electronicSales: 5000, cashIn: 0, cashOut: 0, averageTicket: 7500 });
assert.equal(filterPosRows(sales, { fromDate: '2026-09-02' }).length, 1);
assert.equal(buildCashierRows({ sales, expenses, shifts: [{ id: 's1', cashier_uid: 'u1', cashier_name: 'A', status: 'closed' }] })[0].net, 13000);
assert.equal(buildPosReconciliation({ posSales: sales.slice(0, 2), accSales: sales.slice(0, 2), posExpenses: expenses, accExpenses: expenses }).sales.status, 'MATCHED');
assert.equal(buildPosReconciliation({ posSales: sales.slice(0, 1), accSales: [], posExpenses: [], accExpenses: [] }).sales.status, 'UNMATCHED');
assert.equal(buildPosReconciliation({ posSales: sales.slice(0, 1), accSales: [{ ...sales[0], total_after_discount: 9000 }], posExpenses: [], accExpenses: [] }).sales.status, 'DIFFERENCE');
assert.equal(buildPosReconciliation({ posSales: [], accSales: [], posExpenses: expenses, accExpenses: [] }).expenses.status, 'UNMATCHED');
console.log('POS regression passed: totals, filters, voids, cashier rollup, reconciliation');
