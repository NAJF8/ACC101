import assert from 'node:assert/strict';
import { buildPeriodComparison } from '../src/services/financial.js';

const result = buildPeriodComparison({
  current: { revenue: 120000, purchases: 30000, expenses: 5000, salesCount: 12 },
  previous: { revenue: 100000, purchases: 20000, expenses: 10000, salesCount: 10 },
});
assert.equal(result.revenue.percent, 20);
assert.equal(result.purchases.percent, 50);
assert.equal(result.expenses.percent, -50);
assert.equal(result.salesCount.percent, 20);
assert.equal(result.revenue.direction, 'increase');
assert.equal(buildPeriodComparison({ current: { revenue: 10 }, previous: { revenue: 0 } }).revenue.direction, 'insufficient');
assert.equal(buildPeriodComparison({ current: { revenue: 10 }, previous: { revenue: 0 } }).revenue.percent, null);
assert.equal(JSON.stringify(result).includes('Infinity'), false);
assert.equal(JSON.stringify(result).includes('NaN'), false);
console.log('COMPARISON_REGRESSION_PASS');
