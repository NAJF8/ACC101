import fs from 'node:fs';
import path from 'node:path';

const input = process.argv.find((value) => value.startsWith('--input='))?.slice(8);
const output = process.argv.find((value) => value.startsWith('--output='))?.slice(9) || 'outputs/finished-product-migration';
if (!input) throw new Error('Usage: node scripts/finished-product-migration.mjs --input=<snapshot.json> [--output=dir]');
if (process.argv.includes('--apply')) throw new Error('Generate patch only; apply it with the reviewed Firebase CLI multi-location update after the dry-run passes.');

export const FINISHED_PRODUCT_MAPPING = Object.freeze({ brownies: 'excel-prod-42', muffin: 'excel-prod-49', sandwich: 'excel-prod-53' });
const normalize = (value) => String(value || '').normalize('NFKC').replace(/[\u064B-\u065F\u0670]/g, '').replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
export const productKind = (name) => {
  const value = normalize(name);
  if (/(^|\s)(براونيز|براوني|brownies?|brownie)(\s|$)/u.test(value)) return 'brownies';
  if (/(^|\s)(مافن|مفن|muffins?|muffin)(\s|$)/u.test(value)) return 'muffin';
  if (/(^|\s)(ساندويش|ساندويتش|ساندويتشات|ساندوج|sandwich(?:es)?)(\s|$)/u.test(value)) return 'sandwich';
  return null;
};
const rows = (value) => Object.entries(value || {}).map(([id, row]) => ({ id, ...(row || {}) }));
const labelTextOf = (row) => [row.product_name, row.inventory_item_name, row.item_name, row.name, row.description, row.details].filter(Boolean).join(' ');
const money = (row) => Number(row.total_after_discount ?? row.total_price ?? row.total ?? row.amount ?? 0) || 0;
const quantity = (row) => Number(row.quantity ?? row.qty ?? row.units ?? 0) || 0;
const monthOf = (row) => String(row.month || row.date || row.created_at || '').slice(0, 7);
const movementId = (expenseId) => `finished_product_migration_${expenseId}`;
const migrationKey = (expenseId) => `finished-product-${expenseId}`;
const productName = (product) => product?.name_ar || product?.nameAr || product?.name || '';

const root = JSON.parse(fs.readFileSync(input, 'utf8'));
const products = root.products || {};
const expenses = rows(root.expenses);
const movements = root.finished_product_movements || {};
for (const [kind, id] of Object.entries(FINISHED_PRODUCT_MAPPING)) {
  if (!products[id]) throw new Error(`Mapped product missing: ${kind} -> ${id}`);
  if (kind === 'sandwich' && (products[id].name_ar !== 'ساندويش' || products[id].name_en !== 'Sandwich' || products[id].category_id !== 'sandwiches' || products[id].active === false || products[id].selling_price !== 0)) throw new Error('Sandwich product schema/identity is not the approved actual product.');
}

const candidates = expenses.filter((row) => productKind(labelTextOf(row)));
const totalFinancial = expenses.reduce((sum, row) => sum + money(row), 0);
const report = { generated_at: new Date().toISOString(), project: 'acc-101', source_node: 'expenses', candidate_records: candidates.length, migrated: 0, already_correct: 0, unresolved: 0, duplicated: 0, inserted: 0, stock_adjusted: 0, financial_changes: 0, raw_material_consumption: 0, mapping: FINISHED_PRODUCT_MAPPING, by_product: {}, financial_before: { records: expenses.length, total: totalFinancial }, financial_after: { records: expenses.length, total: totalFinancial } };
const updates = {};
const stockAdditions = new Map();

for (const row of candidates) {
  const kind = productKind(labelTextOf(row));
  const productId = FINISHED_PRODUCT_MAPPING[kind];
  const product = products[productId];
  const bucket = report.by_product[kind] ||= { records: 0, quantity: 0, amount: 0, migrated: 0, already_correct: 0, unresolved: 0, stock_adjusted: 0 };
  const qty = quantity(row);
  const amount = money(row);
  bucket.records++; bucket.quantity += qty; bucket.amount += amount;
  const key = migrationKey(row.id);
  const moveId = movementId(row.id);
  const existingMovement = movements[moveId];
  const linked = row.finished_product_id === productId && row.stock_entity_type === 'finished_product' && row.finished_product_migration_key === key;
  if (linked && existingMovement?.source_id === row.id && existingMovement?.product_id === productId && Number(existingMovement.quantity_delta) === qty) { report.already_correct++; bucket.already_correct++; continue; }
  if (linked || existingMovement || qty <= 0) { report.unresolved++; bucket.unresolved++; continue; }
  updates[`expenses/${row.id}/finished_product_id`] = productId;
  updates[`expenses/${row.id}/finished_product_name`] = productName(product);
  updates[`expenses/${row.id}/stock_entity_type`] = 'finished_product';
  updates[`expenses/${row.id}/unit`] = row.unit || product.stock_unit || product.unit || 'piece';
  updates[`expenses/${row.id}/finished_product_migration_key`] = key;
  updates[`expenses/${row.id}/migrated_at`] = report.generated_at;
  updates[`expenses/${row.id}/migrated_from`] = { source_type: row.source_type || 'expense', product_label: labelTextOf(row) };
  updates[`finished_product_movements/${moveId}`] = { id: moveId, type: 'expense_reclassification', stock_entity_type: 'finished_product', product_id: productId, product_name: productName(product), quantity: qty, quantity_delta: qty, unit: row.unit || product.stock_unit || product.unit || 'piece', source_type: 'finished_product_migration', source_id: row.id, source_key: key, date: row.date || report.generated_at.slice(0, 10), month: monthOf(row) || null, amount, created_at: report.generated_at, created_by: 'finished-product-migration' };
  stockAdditions.set(productId, (stockAdditions.get(productId) || 0) + qty);
  report.migrated++; bucket.migrated++; bucket.stock_adjusted++;
}
for (const [productId, added] of stockAdditions) {
  const product = products[productId];
  updates[`products/${productId}/ready_stock_quantity`] = (Number(product.ready_stock_quantity) || 0) + added;
  updates[`products/${productId}/stock_type`] = 'finished_product';
  updates[`products/${productId}/stock_unit`] = product.stock_unit || product.unit || 'piece';
  report.stock_adjusted++;
}
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(output, 'patch.json'), JSON.stringify(updates, null, 2));
fs.copyFileSync(input, path.join(output, 'input-snapshot.json'));
console.log(JSON.stringify({ ...report, update_paths: Object.keys(updates).length, output }, null, 2));
