import fs from 'node:fs';
import path from 'node:path';

const posPath = process.env.POS_SALES_SNAPSHOT || 'C:/Users/MSI/Desktop/101 POS/outputs-live-pos-sales.json';
const accPath = process.env.ACC_SALES_SNAPSHOT || 'outputs/live-acc-sales.json';
const outputDir = process.env.POS_ACC_OUTPUT_DIR || 'outputs';
const rows = value => Object.entries(value || {}).map(([id, row]) => ({ id, ...(row || {}) }));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const dateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
const statusOf = row => String(row.status || '').trim().toLowerCase();
const isVoided = row => ['voided', 'cancelled', 'canceled', 'abandoned', 'deleted'].includes(statusOf(row)) || row.voided === true || (Array.isArray(row.audit) && row.audit.some(item => item?.type === 'void'));
const money = row => Number(row.total ?? row.total_after_discount ?? row.subtotal ?? 0);
const validItems = row => Array.isArray(row.items) && row.items.length > 0 && row.items.every(item => Number(item?.quantity) > 0 && Number.isFinite(Number(item?.price ?? item?.unitPrice ?? item?.unit_price)) && Number(item?.price ?? item?.unitPrice ?? item?.unit_price) >= 0);
const valid = row => Number.isFinite(money(row)) && money(row) >= 0 && validItems(row);
const sourceIdOfAcc = row => [row.sourceId, row.source_id, row.source_sale_id, row.source_local_id].filter(Boolean).map(String);
const toIso = value => { const n = Number(value); return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : new Date().toISOString(); };
const safeKey = value => String(value).replace(/[.#$\[\]/]/g, '_');

const pos = rows(read(posPath));
const acc = rows(read(accPath));
const accByPosId = new Map();
for (const row of acc) for (const sourceId of sourceIdOfAcc(row)) if (sourceId) accByPosId.set(sourceId, row);

const updates = {};
const classifications = [];
for (const row of pos) {
  const saleId = String(row.saleId || row.id || '').trim();
  const businessDate = dateOnly(row.businessDate);
  const voided = isVoided(row);
  const existing = accByPosId.get(saleId);
  const complete = valid(row);
  const integrationKey = `POS101:sale:${saleId}`;
  const common = {
    source: 'POS101', sourceType: 'sale', sourceId: saleId, integrationKey,
    source_channel: 'POS101', source_type: 'sale', source_sale_id: saleId,
    businessDate, businessDateStatus: businessDate ? 'resolved' : 'manual_required',
    migrationStatus: businessDate ? 'migrated' : 'pending_business_date',
    status: voided ? 'voided' : (statusOf(row) === 'synced' || !row.status ? 'completed' : statusOf(row)),
    syncVersion: Number(existing?.syncVersion || 0) + 1,
  };
  if (existing) {
    for (const [field, value] of Object.entries(common)) updates[`sales/${existing.id}/${field}`] = value;
    classifications.push({ saleId, action: 'metadata_backfill', businessDate, voided, existingAccId: existing.id, amount: money(row) });
    continue;
  }
  const record = {
    id: saleId, ...common, order_number: row.orderNumber ?? null,
    cashier_id: row.cashierId || '', cashier_name: row.cashierNameSnapshot || row.seller || '',
    shift_id: row.operationalDayId || row.shiftId || '', device_id: row.deviceId || '',
    date: businessDate, month: businessDate ? businessDate.slice(0, 7) : null,
    created_at: toIso(row.createdAt), created_at_ms: Number(row.createdAt || 0),
    updated_at: toIso(row.updatedAt || row.createdAt), updatedAt: row.updatedAt || row.createdAt || null,
    payment_method: row.paymentMethod || row.payment?.method || 'unknown',
    subtotal: Number(row.subtotal ?? money(row)), discount_amount: Number(row.discount || 0), total_after_discount: money(row),
    items: (row.items || []).map(item => ({ ...item, product_id: String(item.product_id || item.id || ''), product_name: item.product_name || item.name || '', item_name: item.item_name || item.name || '', quantity: Number(item.quantity || 0), unit_price: Number(item.unit_price ?? item.unitPrice ?? item.price ?? 0) })),
    created_by: row.createdBy || row.created_by || 'pos101-historical-migration',
  };
  updates[`sales/${safeKey(saleId)}`] = record;
  classifications.push({ saleId, action: 'insert', businessDate, voided, existingAccId: null, amount: money(row) });
}

const eligible = pos.filter(row => !isVoided(row) && valid(row));
const unresolvedCompleted = pos.filter(row => !isVoided(row) && !dateOnly(row.businessDate));
const unresolvedVoided = pos.filter(row => isVoided(row) && !dateOnly(row.businessDate));
const report = {
  generatedAt: new Date().toISOString(), sourceSnapshots: { posPath, accPath },
  POS_TOTAL_AUDIT: pos.length,
  ACC_EXISTING_POS_SALES: acc.length,
  ACC_AUDIT_COVERAGE_AFTER_APPLY: pos.length,
  POS_REVENUE_ELIGIBLE_COUNT: eligible.length,
  POS_REVENUE_TOTAL: eligible.reduce((sum, row) => sum + money(row), 0),
  PENDING_BUSINESS_DATE_COUNT: unresolvedCompleted.length + unresolvedVoided.length,
  PENDING_BUSINESS_DATE_COMPLETED: unresolvedCompleted.length,
  PENDING_BUSINESS_DATE_VOIDED: unresolvedVoided.length,
  PENDING_BUSINESS_DATE_AMOUNT: unresolvedCompleted.reduce((sum, row) => sum + money(row), 0),
  SALE_DUPLICATES: pos.length - new Set(pos.map(row => String(row.saleId || row.id))).size,
  invalidRows: pos.filter(row => !valid(row)).map(row => row.id),
  updatesCount: Object.keys(updates).length,
  productionWrite: 'NO',
  note: '25 historical rows from the prior audit remain manual_required only if they are still unresolved in the current snapshot; no businessDate is inferred from createdAt.',
};
if (report.SALE_DUPLICATES || report.invalidRows.length) throw new Error(`Refusing migration preparation: duplicates=${report.SALE_DUPLICATES}, invalid=${report.invalidRows.length}`);
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'pos-acc-sales-migration-updates.json'), JSON.stringify(updates, null, 2));
fs.writeFileSync(path.join(outputDir, 'pos-acc-sales-migration-report.json'), JSON.stringify({ ...report, classifications }, null, 2));
console.log(JSON.stringify(report, null, 2));
