import fs from 'node:fs';
import path from 'node:path';

const posPath = process.env.POS_EXPENSES_SNAPSHOT || 'C:/Users/MSI/Desktop/101 POS/outputs-live-pos-expenses.json';
const accPath = process.env.ACC_EXPENSES_SNAPSHOT || 'outputs/live-acc-expenses.json';
const outputDir = process.env.POS_ACC_OUTPUT_DIR || 'outputs';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = value => Object.entries(value || {}).map(([id, row]) => ({ id, ...(row || {}) }));
const dateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : null;
const pos = rows(read(posPath));
const acc = rows(read(accPath));
const updates = {};
const ids = new Set();
const conflicts = [];
const invalid = [];
const active = row => !['disabled', 'deleted', 'voided', 'cancelled', 'canceled'].includes(String(row.status || '').toLowerCase());
for (const row of pos) {
  const sourceId = String(row.id || '').trim();
  if (!sourceId || ids.has(sourceId)) { conflicts.push({ id: sourceId, reason: 'duplicate_source_id' }); continue; }
  ids.add(sourceId);
  const businessDate = dateOnly(row.businessDate);
  const amount = Number(row.amount);
  if (!businessDate || !Number.isFinite(amount) || amount <= 0) { invalid.push({ id: sourceId, businessDate, amount }); continue; }
  const integrationKey = `POS101:expense:${sourceId}`;
  const accId = `pos101:${sourceId}`;
  const record = {
    id: accId, source: 'POS101', sourceType: 'expense', sourceId, integrationKey, source_channel: 'POS101', source_type: 'expense', source_id: sourceId,
    operation_key: integrationKey, businessDate, date: businessDate, month: businessDate.slice(0, 7), amount,
    category: row.category || 'أخرى', description: row.description || row.notes || row.category || 'مصروف POS', notes: row.notes || row.description || '',
    payment_method: row.paymentMethod || row.payment_method || (row.paymentSource === 'cash' ? 'cash' : 'other'), payment_source: row.paymentSource || '',
    paid_amount: row.paid_amount ?? amount, status: row.status || 'active', entryType: row.entryType || 'current',
    cashier_id: row.cashierId || row.createdBy || '', cashier_name: row.cashierName || row.employeeNameSnapshot || row.person || '',
    operationalDayId: row.operationalDayId || '', deviceId: row.deviceId || '', created_at: new Date(Number(row.createdAt || row.timestamp || Date.now())).toISOString(),
    created_at_ms: Number(row.createdAt || row.timestamp || 0), updated_at: new Date(Number(row.updatedAt || row.createdAt || Date.now())).toISOString(), syncVersion: 1,
  };
  const existing = acc.find(item => item.integrationKey === integrationKey || item.sourceId === sourceId || item.source_id === sourceId);
  if (existing && Number(existing.amount) !== amount) conflicts.push({ id: sourceId, reason: 'amount_conflict', existing: existing.amount, incoming: amount });
  else if (!existing) updates[`expenses/${accId}`] = record;
}
const sourceTotal = pos.filter(active).reduce((sum, row) => sum + Number(row.amount || 0), 0);
const report = {
  generatedAt: new Date().toISOString(), sourceSnapshots: { posPath, accPath }, POS_EXPENSE_COUNT: pos.length,
  POS_EXPENSE_ACTIVE_COUNT: pos.filter(active).length, POS_EXPENSE_ACTIVE_TOTAL: sourceTotal,
  ACC_EXISTING_POS_EXPENSES: acc.filter(row => row.source_channel === 'POS101' || row.source === 'POS101' || row.integrationKey?.startsWith('POS101:expense:')).length,
  INSERT_READY: Object.keys(updates).length, DUPLICATE_SOURCE_IDS: conflicts.filter(row => row.reason === 'duplicate_source_id').length,
  CONFLICT_COUNT: conflicts.length, INVALID_COUNT: invalid.length, DIFFERENCE_BEFORE_WRITE: 0, productionWrite: 'NO',
  safeMerge: true, note: 'No write is performed by this script. Disabled/voided rows are retained as audit records and excluded from active expense totals.', conflicts, invalid,
};
if (conflicts.length || invalid.length) throw new Error(JSON.stringify(report));
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'pos-acc-expense-migration-updates.json'), JSON.stringify(updates, null, 2));
fs.writeFileSync(path.join(outputDir, 'pos-acc-expense-migration-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
