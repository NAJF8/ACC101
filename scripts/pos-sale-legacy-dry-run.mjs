import fs from 'node:fs';
import path from 'node:path';

const newestBackup = (root, prefix) => {
  const folders = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('pos-acc-integration-'))
    .map(entry => path.join(root, entry.name))
    .sort();
  const folder = folders.at(-1);
  if (!folder) throw new Error(`No integration backup in ${root}`);
  const file = fs.readdirSync(folder).find(name => name.startsWith(prefix) && name.endsWith('.json'));
  if (!file) throw new Error(`No ${prefix} backup in ${folder}`);
  return path.join(folder, file);
};

const asRows = value => Object.entries(value || {}).map(([id, row]) => ({ id, ...(row || {}) }));
const accFile = newestBackup(path.join(process.cwd(), 'backups'), 'acc-101-pre-pos-integration-');
const posRoot = 'C:/Users/MSI/Desktop/101 POS/backups';
const posFile = newestBackup(posRoot, 'pos101-pre-acc-integration-');
const acc = JSON.parse(fs.readFileSync(accFile, 'utf8'));
const pos = JSON.parse(fs.readFileSync(posFile, 'utf8'));
const posSales = asRows(pos.pos101_sales);
const accSales = asRows(acc.sales).filter(row => row.source_channel === 'POS101');
const posById = new Map(posSales.map(row => [String(row.id), row]));
const references = row => [row.source_sale_id, row.source_local_id, row.sourceId, row.id].filter(Boolean).map(String);
const linked = new Map();
const missingInPos = [];
for (const row of accSales) {
  const matches = [...new Set(references(row).filter(id => posById.has(id)))];
  if (matches.length === 1) linked.set(row.id, matches[0]);
  else missingInPos.push(row.id);
}
const matchCounts = new Map();
for (const id of linked.values()) matchCounts.set(id, (matchCounts.get(id) || 0) + 1);
const duplicate = [...matchCounts.values()].filter(count => count > 1).length;
const exactMatch = [...linked.entries()].filter(([accId, posId]) => accId === posId || String(accSales.find(row => row.id === accId)?.source_sale_id || '') === posId || String(accSales.find(row => row.id === accId)?.source_local_id || '') === posId).length;
const conflict = accSales.length - linked.size - missingInPos.length;
const linkedPos = new Set(linked.values());
const missing = posSales.filter(row => !linkedPos.has(String(row.id)));
const validBusinessDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const isVoided = row => ['voided', 'cancelled', 'canceled', 'abandoned'].includes(String(row.status || '').toLowerCase());
const numericSale = row => Number(row.total ?? row.subtotal);
const hasValidItems = row => Array.isArray(row.items) && row.items.length > 0 && row.items.every(item => Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0 && Number.isFinite(Number(item.price ?? item.unitPrice ?? item.unit_price)) && Number(item.price ?? item.unitPrice ?? item.unit_price) >= 0);
const invalidBusinessDate = missing.filter(row => !validBusinessDate(row.businessDate));
const duplicateIntegrationKey = new Set();
const integrationKeys = new Set();
for (const row of missing) {
  const key = `POS101:sale:${String(row.id)}`;
  if (integrationKeys.has(key)) duplicateIntegrationKey.add(key);
  integrationKeys.add(key);
}
const financialConflict = missing.filter(row => !Number.isFinite(numericSale(row)) || numericSale(row) < 0);
const otherConflict = missing.filter(row => isVoided(row) || !hasValidItems(row));
const readyToInsert = missing.filter(row => validBusinessDate(row.businessDate)
  && !duplicateIntegrationKey.has(`POS101:sale:${String(row.id)}`)
  && Number.isFinite(numericSale(row)) && numericSale(row) >= 0
  && !isVoided(row) && hasValidItems(row));
const validPosSales = posSales.filter(row => !isVoided(row));
const validPosTotal = validPosSales.reduce((total, row) => total + numericSale(row), 0);
const report = {
  POS_SALES_COUNT: posSales.length,
  ACC_EXISTING_POS_SALES: accSales.length,
  LEGACY_EXACT_MATCH: exactMatch,
  LEGACY_SAFE_TO_BACKFILL: linked.size - duplicate,
  LEGACY_CONFLICT: conflict,
  LEGACY_MISSING_IN_POS: missingInPos.length,
  LEGACY_MISSING_IN_ACC: posSales.filter(row => !linkedPos.has(String(row.id))).length,
  LEGACY_DUPLICATES: duplicate,
  LEGACY_BACKFILL_READY: linked.size - duplicate,
  LEGACY_BACKFILL_CONFLICT: conflict + duplicate,
  MISSING_READY_TO_INSERT: readyToInsert.length,
  MISSING_INVALID_BUSINESS_DATE: invalidBusinessDate.length,
  MISSING_DUPLICATE_INTEGRATION_KEY: duplicateIntegrationKey.size,
  MISSING_FINANCIAL_CONFLICT: financialConflict.length,
  MISSING_OTHER_CONFLICT: otherConflict.length,
  POS_VALID_SALES_COUNT: validPosSales.length,
  POS_VALID_SALES_TOTAL: validPosTotal,
  EXPECTED_ACC_POS_SALES_COUNT: validPosSales.length,
  EXPECTED_ACC_POS_SALES_TOTAL: validPosTotal,
  EXPECTED_COUNT_DIFFERENCE: 0,
  EXPECTED_AMOUNT_DIFFERENCE: 0,
  mode: 'dry-run',
};
console.log(JSON.stringify(report, null, 2));
