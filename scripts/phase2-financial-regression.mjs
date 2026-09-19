import assert from 'node:assert/strict';
import {
  aggregateFinancialTimeline,
  buildCashCarryForward,
  buildMonthCloseReview,
  cashBalanceFromMovements,
  countCashDenominations,
  getSalesTransactionNet,
} from '../src/services/financial.js';

const carry = buildCashCarryForward({ sourceMonth: '2026-08', targetMonth: '2026-09', closingCash: 130000, actor: 'test' });
assert.equal(carry.opening_cash, 130000);
assert.equal(carry.label_ar, 'رصيد مرحّل من الشهر السابق');
assert.equal(buildCashCarryForward({ sourceMonth: '2026-08', targetMonth: '2026-09', closingCash: 130000 }).opening_cash, carry.opening_cash);

const balance = cashBalanceFromMovements({ opening: 100000, movements: [
  { type: 'IN', amount: 50000 }, { type: 'IN', amount: 30000, payment_method: 'electronic' },
  { type: 'OUT', amount: 20000 }, { type: 'OUT', amount: 10000, payment_method: 'electronic' },
  { type: 'OUT', amount: 5000 }, { type: 'IN', amount: 40000, source_type: 'owner_deposit' }, { type: 'OUT', amount: 15000, source_type: 'owner_withdrawal' },
] });
assert.equal(balance, 150000, 'electronic movements must not affect physical cash');
assert.equal(countCashDenominations({ 50000: 2, 25000: 1, 10000: 1, 5000: 1, 1000: 2, 500: 1, 250: 2 }), 143000);

const review = buildMonthCloseReview({ month: '2026-09', sales: [{ payment_method: '' }], inventory: [{ quantity: -1 }] });
assert.ok(review.some((item) => item.severity === 'BLOCKING'));
const chart = aggregateFinancialTimeline({ fromDate: '2026-09-01', toDate: '2026-09-03', sales: [
  { date: '2026-09-01', total_after_discount: 8000 }, { date: '2026-09-03', total_after_discount: 2000 },
], purchases: [{ date: '2026-09-01', total: 1000 }] });
assert.deepEqual(chart.map((row) => [row.date, row.revenue, row.purchases]), [['2026-09-01', 8000, 1000], ['2026-09-03', 2000, 0]]);
assert.equal(getSalesTransactionNet({ date: '2026-09-01', total_after_discount: 8000 }), 8000);
console.log('PHASE2_FINANCIAL_REGRESSION_PASS');
