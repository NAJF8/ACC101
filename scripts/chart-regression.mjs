import assert from 'node:assert/strict';
import { aggregateFinancialTimeline, buildPeriodComparison } from '../src/services/financial.js';

const rows = aggregateFinancialTimeline({
  fromDate: '2026-09-01', toDate: '2026-09-03',
  sales: [
    { id: 's1', date: '2026-09-01', total_after_discount: 80000, payment_method: 'cash' },
    { id: 's2', date: '2026-09-03', total_after_discount: 40000, payment_method: 'electronic' },
    { id: 'deleted', date: '2026-09-02', total_after_discount: 99999, deleted: true },
  ],
  purchases: [
    { id: 'p1', date: '2026-09-01', total_price: 20000 },
    { id: 'p2', date: '2026-09-03', total_price: 10000 },
  ],
});
assert.deepEqual(rows.map(({ date, revenue, purchases, salesCount, purchaseCount }) => [date, revenue, purchases, salesCount, purchaseCount]), [
  ['2026-09-01', 80000, 20000, 1, 1], ['2026-09-03', 40000, 10000, 1, 1],
]);
assert.equal(rows.some((row) => row.date !== row.date.slice(0, 10)), false);
console.log('CHART_REGRESSION_PASS');
