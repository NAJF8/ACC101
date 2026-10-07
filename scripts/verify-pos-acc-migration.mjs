import fs from 'node:fs';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = value => Object.entries(value || {}).map(([id, row]) => ({ id, ...(row || {}) }));
const posSales = rows(read('C:/Users/MSI/Desktop/101 POS/outputs-live-pos-sales.json'));
const accSales = rows(read('outputs/live-acc-sales-postmigration.json'));
const posExpenses = rows(read('C:/Users/MSI/Desktop/101 POS/outputs-live-pos-expenses.json'));
const accExpenses = rows(read('outputs/live-acc-expenses-postmigration.json'));
const isVoided = row => ['voided', 'cancelled', 'canceled', 'abandoned', 'deleted'].includes(String(row.status || '').toLowerCase()) || row.voided === true || (Array.isArray(row.audit) && row.audit.some(item => item?.type === 'void'));
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const saleById = new Map(accSales.map(row => [String(row.sourceId || row.source_id || row.source_sale_id), row]));
const expenseById = new Map(accExpenses.map(row => [String(row.sourceId || row.source_id), row]));
const missingSales = posSales.filter(row => !saleById.has(String(row.id)));
const badSales = posSales.filter(row => { const acc = saleById.get(String(row.id)); return !acc || acc.integrationKey !== `POS101:sale:${row.id}` || acc.source !== 'POS101' || acc.sourceType !== 'sale' || (date(row.businessDate) && acc.businessDate !== row.businessDate); });
const missingExpenses = posExpenses.filter(row => !expenseById.has(String(row.id)));
const badExpenses = posExpenses.filter(row => { const acc = expenseById.get(String(row.id)); return !acc || acc.integrationKey !== `POS101:expense:${row.id}` || acc.source !== 'POS101' || acc.sourceType !== 'expense' || acc.businessDate !== row.businessDate; });
const revenueEligible = posSales.filter(row => !isVoided(row));
const resolvedRevenue = accSales.filter(row => row.source === 'POS101' && date(row.businessDate) && !isVoided(row));
const result = {
  sales: { POS_TOTAL_AUDIT: posSales.length, ACC_POS_AUDIT_COVERAGE: posSales.length - missingSales.length, missing: missingSales.length, badContract: badSales.length, POS_REVENUE_ELIGIBLE_COUNT: revenueEligible.length, POS_REVENUE_TOTAL: revenueEligible.reduce((sum, row) => sum + Number(row.total ?? row.subtotal ?? 0), 0), ACC_REVENUE_RESOLVED_COUNT: resolvedRevenue.length, ACC_RESOLVED_REVENUE_TOTAL: resolvedRevenue.reduce((sum, row) => sum + Number(row.total_after_discount ?? row.total ?? row.subtotal ?? 0), 0) },
  expenses: { POS_EXPENSE_COUNT: posExpenses.length, ACC_POS_EXPENSE_COVERAGE: posExpenses.length - missingExpenses.length, missing: missingExpenses.length, badContract: badExpenses.length, POS_TOTAL: posExpenses.reduce((sum, row) => sum + Number(row.amount || 0), 0), ACC_TOTAL: accExpenses.filter(row => row.source === 'POS101').reduce((sum, row) => sum + Number(row.amount || 0), 0) },
  SALE_DUPLICATES: posSales.length - new Set(posSales.map(row => row.id)).size,
  EXPENSE_DUPLICATES: posExpenses.length - new Set(posExpenses.map(row => row.id)).size,
};
console.log(JSON.stringify(result, null, 2));
if (missingSales.length || badSales.length || missingExpenses.length || badExpenses.length || result.SALE_DUPLICATES || result.EXPENSE_DUPLICATES) process.exit(1);
