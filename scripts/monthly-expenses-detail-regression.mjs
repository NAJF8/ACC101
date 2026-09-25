import assert from 'node:assert/strict';
import { buildMonthlyExpenseDetails, buildMonthlyFinancialAggregation } from '../src/services/financial.js';

const catalog = {
  products: [
    { id: 'excel-prod-42', name_ar: 'براونيز' },
    { id: 'excel-prod-49', name_ar: 'مافن' },
    { id: 'excel-prod-53', name_ar: 'ساندويش' },
  ],
  inventory_items: [{ id: 'milk-1', name_ar: 'حليب' }],
};

const rows = [
  { id: 'july-brownie-1', month: '2026-07', date: '2026-07-05', category_name: 'كيك وحلويات', product_id: 'excel-prod-42', quantity: 9, unit: 'قطعة', amount: 18000 },
  { id: 'july-brownie-2', month: '2026-07', date: '2026-07-08', category_name: 'كيك وحلويات', product_id: 'excel-prod-42', quantity: 9, unit: 'قطعة', amount: 18000 },
  { id: 'july-milk', month: '2026-07', date: '2026-07-09', category_name: 'مواد القهوة', inventory_item_id: 'milk-1', quantity: 2, unit: 'كيلو', amount: 5000 },
  { id: 'july-missing-quantity', month: '2026-07', date: '2026-07-10', category_name: 'مواد القهوة', name: 'سيروب موهيتو', amount: 98000 },
  { id: 'august-brownie', month: '2026-08', date: '2026-08-09', category_name: 'كيك وحلويات', product_id: 'excel-prod-42', quantity: 9, unit: 'قطعة', amount: 18000 },
  { id: 'august-milk-kg', month: '2026-08', date: '2026-08-10', category_name: 'مواد القهوة', inventory_item_id: 'milk-1', quantity: 2, unit: 'كيلو', amount: 5000 },
  { id: 'august-milk-piece', month: '2026-08', date: '2026-08-11', category_name: 'مواد القهوة', inventory_item_id: 'milk-1', quantity: 3, unit: 'قطعة', amount: 6000 },
];

const categoryOf = (row) => row.category_name;
const july = rows.filter((row) => row.month === '2026-07');
const august = rows.filter((row) => row.month === '2026-08');
const julyDetails = buildMonthlyExpenseDetails({ rows: july, catalog, categoryOf });
const augustDetails = buildMonthlyExpenseDetails({ rows: august, catalog, categoryOf });
const invoiceDetails = buildMonthlyExpenseDetails({
  rows: [{ id: 'invoice-1', category_name: 'مواد القهوة', amount_display: 30000, items: [
    { inventory_item_id: 'milk-1', quantity: 2, unit: 'كيلو' },
    { product_id: 'excel-prod-49', quantity: 1, unit: 'قطعة' },
  ] }],
  catalog,
  categoryOf,
});
const sourceResolution = buildMonthlyExpenseDetails({
  rows: [{ id: 'resolution-1', category_name: 'مواد القهوة', product_id: 'unknown-product', product_name: 'اسم المنتج من المصدر', inventory_item_id: 'milk-1', description: 'توصيل كيك', amount: 1000 }],
  catalog,
  categoryOf,
});

const brownies = julyDetails.categories.find((row) => row.name === 'كيك وحلويات').items.find((row) => row.name === 'براونيز');
assert.equal(brownies.quantity, 18);
assert.equal(brownies.amount, 36000);
assert.equal(brownies.movementCount, 2);
assert.equal(julyDetails.categories.find((row) => row.name === 'كيك وحلويات').total, 36000);
assert.equal(julyDetails.categories.find((row) => row.name === 'مواد القهوة').items.find((row) => row.name === 'سيروب موهيتو').hasQuantity, false);
assert.equal(augustDetails.categories.find((row) => row.name === 'كيك وحلويات').items.find((row) => row.name === 'براونيز').quantity, 9);
assert.equal(augustDetails.categories.find((row) => row.name === 'مواد القهوة').items.length, 2, 'different units remain separate');
assert.equal(invoiceDetails.categories.reduce((sum, row) => sum + row.total, 0), 30000, 'multi-line parent amount is preserved');
assert.equal(sourceResolution.items[0].name, 'اسم المنتج من المصدر', 'product_name precedes inventory lookup and description fallback');
assert.equal(julyDetails.categories.reduce((sum, row) => sum + row.total, 0), july.reduce((sum, row) => sum + row.amount, 0));
assert.equal(augustDetails.categories.reduce((sum, row) => sum + row.total, 0), august.reduce((sum, row) => sum + row.amount, 0));

const monthly = buildMonthlyFinancialAggregation({ sources: { expenses: july }, month: '2026-07' });
assert.equal(monthly.cash_outflow, 139000);
assert.equal(monthly.rows.length, july.length);
console.log(JSON.stringify({ passed: true, july_items: julyDetails.items.length, august_items: augustDetails.items.length }));
