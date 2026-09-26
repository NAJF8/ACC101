import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const argValue = (name) => {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const target = argValue('--target') || 'emulator';
const mode = args.includes('--dry-run') ? 'dry-run' : args.includes('--apply') ? 'apply' : target === 'emulator' ? 'apply' : null;
const projectId = argValue('--project') || process.env.FIREBASE_PROJECT_ID || 'acc-101';
const instance = argValue('--instance') || 'acc-101-default-rtdb';
const backupDir = argValue('--backup-dir');

if (!['emulator', 'production'].includes(target)) throw new Error('target must be emulator or production');
if (!mode) throw new Error('Production requires --dry-run or --apply');
if (target === 'production' && mode === 'apply' && !backupDir) throw new Error('Production apply requires --backup-dir');

const safeKey = (value) => String(value || '').replaceAll('.', '_').replaceAll('#', '_').replaceAll('$', '_').replaceAll('[', '_').replaceAll(']', '_').replaceAll('/', '_');
const rows = (value) => Object.entries(value || {}).map(([id, row]) => ({ id, ...(row || {}) }));
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const isPos = (row) => String(row?.source_channel || '').toUpperCase() === 'POS101';
const explicitSourceKey = (row) => row?.source_key || row?.operation_key || row?.id || null;
const modelKey = (row, fallback) => safeKey(explicitSourceKey(row) || fallback);
const sale = (row) => ({ id: row.id, source_channel: 'POS101', source_key: row.source_key || row.operation_key || row.id, source_id: row.id, operation_key: row.operation_key || row.source_key || row.id, date: row.date || null, month: row.month || null, created_at: row.created_at || null, updated_at: row.updated_at || null, cashier_uid: row.cashier_uid || row.created_by || null, cashier_name: row.cashier_name || row.created_by_name || null, shift_id: row.shift_id || null, payment_method: row.payment_method || null, order_type: row.order_type || null, quantity: Number(row.quantity || 0), subtotal: Number(row.subtotal || 0), discount_amount: Number(row.discount_amount || 0), total_after_discount: Number(row.total_after_discount || 0), status: row.status || 'completed', inventory_consumption_status: row.inventory_consumption_status || null, ...(Array.isArray(row.items) ? { items: row.items.map((item) => ({ product_id: item.product_id || null, product_name: item.product_name || item.name || null, quantity: Number(item.quantity || 0), unit_price: Number(item.unit_price || item.price || 0), total: Number(item.total || Number(item.quantity || 0) * Number(item.unit_price || item.price || 0)) })) } : {}) });
const expense = (row) => ({ id: row.id, source_channel: 'POS101', source_key: row.source_key || row.id, source_id: row.id, date: row.date || null, month: row.month || null, created_at: row.created_at || null, updated_at: row.updated_at || null, cashier_uid: row.cashier_uid || row.created_by || null, cashier_name: row.cashier_name || row.created_by_name || null, shift_id: row.shift_id || null, payment_method: row.payment_method || null, amount: Number(row.amount || 0), description: row.description || row.details || null, category: row.category || null, category_name: row.category_name || null, paid_amount: Number(row.paid_amount || 0), remaining_amount: Number(row.remaining_amount || 0), payment_status: row.payment_status || null, notes: row.notes || null, deleted: row.deleted === true });
const cash = (row) => ({ id: row.id, source_channel: 'POS101', source_key: row.source_key || `pos101:cash:${row.source_id || row.id}`, source_id: row.source_id || null, date: row.date || null, month: row.month || null, created_at: row.created_at || null, cashier_uid: row.cashier_uid || row.created_by || null, cashier_name: row.cashier_name || null, shift_id: row.shift_id || null, type: row.type || null, amount: Number(row.amount || 0), payment_method: row.payment_method || null, source_type: row.source_type || null, source_key_ref: row.source_key || null, deleted: row.deleted === true });
const shift = (row) => ({ id: row.id, source_channel: 'POS101', source_key: row.source_key || `pos101:shift:${row.id}`, source_id: row.id, month: row.month || null, opened_at: row.opened_at || null, closed_at: row.closed_at || null, cashier_uid: row.cashier_uid || null, cashier_name: row.cashier_name || null, status: row.status || null, opening_cash: Number(row.opening_cash || 0), expected_cash: row.expected_cash == null ? null : Number(row.expected_cash), actual_cash: row.actual_cash == null ? null : Number(row.actual_cash), difference: row.difference == null ? null : Number(row.difference), denomination_counts: row.denomination_counts || undefined, explanation: row.explanation || null });

const mappings = [['sales', 'sales', sale], ['expenses', 'expenses', expense], ['cash_movements', 'cash_movements', cash], ['cashier_shifts', 'shifts', shift]];
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-read-model-'));
process.on('exit', () => fs.rmSync(tempDir, { recursive: true, force: true }));

const host = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
if (target === 'emulator' && !['127.0.0.1', 'localhost'].includes(host)) throw new Error(`Refusing non-local host: ${host}`);
const emulatorUrl = (pathName = '') => `http://${host}:9000/${pathName}.json?ns=${projectId}-default-rtdb&access_token=owner`;
const readEmulator = async (pathName) => {
  const response = await fetch(emulatorUrl(pathName));
  if (!response.ok) throw new Error(`Emulator read failed for ${pathName}: ${response.status}`);
  return response.json();
};
const patchEmulator = async (value) => {
  const response = await fetch(emulatorUrl(''), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  if (!response.ok) throw new Error(`Emulator write failed: ${response.status}`);
};
const firebaseCli = (command, cliArgs) => execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['-y', 'firebase-tools@latest', `database:${command}`, ...cliArgs], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
const readProduction = (pathName) => {
  const file = path.join(tempDir, `${pathName.replaceAll('/', '_')}.json`);
  firebaseCli('get', [`/${pathName}`, '--project', projectId, '--instance', instance, '--output', file]);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const updateProduction = (updates) => {
  const file = path.join(tempDir, 'updates.json');
  fs.writeFileSync(file, JSON.stringify(updates));
  firebaseCli('update', ['/', file, '--project', projectId, '--instance', instance, '--force']);
};

let source;
if (target === 'emulator') source = await readEmulator('');
else {
  source = {};
  for (const [sourceName] of mappings) source[sourceName] = readProduction(sourceName);
}
const existing = target === 'emulator' ? await readEmulator('pos_read_models') : readProduction('pos_read_models');
const updates = {};
const sourceCounts = {};
const coverage = {};
const candidateRecords = [];
const unresolved = [];

for (const [sourceName, targetName, mapper] of mappings) {
  const allRows = rows(source?.[sourceName]);
  const selected = allRows.filter(isPos);
  sourceCounts[sourceName] = selected.length;
  coverage[sourceName] = {
    total_source_rows: allRows.length,
    source_channel_values: Object.fromEntries([...new Set(allRows.map((row) => String(row.source_channel ?? '<missing>')))].map((channel) => [channel, allRows.filter((row) => String(row.source_channel ?? '<missing>') === channel).length])),
    source_key_present_total: allRows.filter((row) => Boolean(row.source_key)).length,
    source_channel_present: selected.length,
    source_key_present: selected.filter((row) => Boolean(row.source_key)).length,
    source_key_fallback_operation_or_id: selected.filter((row) => !row.source_key && Boolean(row.operation_key || row.id)).length,
    source_key_missing: selected.filter((row) => !explicitSourceKey(row)).length,
  };
  for (const row of selected) {
    const rawKey = explicitSourceKey(row);
    if (!rawKey) {
      unresolved.push({ source: sourceName, id: row.id || null, reason: 'missing source_key, operation_key, and id' });
      continue;
    }
    candidateRecords.push({ sourceName, targetName, key: modelKey(row, `${sourceName}:${row.id}`), model: mapper(row) });
  }
}

const byTargetKey = new Map();
const duplicateConflicts = [];
for (const record of candidateRecords) {
  const compound = `${record.targetName}/${record.key}`;
  const prior = byTargetKey.get(compound);
  if (prior && stable(prior.model) !== stable(record.model)) duplicateConflicts.push({ target: compound, reason: 'source rows map to same key with different content' });
  else if (!prior) byTargetKey.set(compound, record);
}
unresolved.push(...duplicateConflicts);

let alreadyPresent = 0;
for (const [compound, record] of byTargetKey) {
  const [targetName, key] = compound.split('/');
  const prior = existing?.[targetName]?.[key];
  if (!prior) updates[`pos_read_models/${targetName}/${key}`] = record.model;
  else if (stable(prior) === stable(record.model)) alreadyPresent += 1;
  else unresolved.push({ target: compound, reason: 'existing read-model row conflicts with source projection' });
}

const counts = { sales: sourceCounts.sales, expenses: sourceCounts.expenses, cash_movements: sourceCounts.cash_movements, shifts: sourceCounts.cashier_shifts, duplicates_expected: 0, duplicates_conflicting: duplicateConflicts.length, unresolved: unresolved.length, inserted: Object.keys(updates).length, already_present: alreadyPresent, changes: Object.keys(updates).length };

if (mode === 'apply') {
  if (target === 'production') {
    if (!fs.existsSync(path.join(backupDir, 'manifest.json'))) throw new Error('Backup manifest missing; refusing Production write');
    for (const required of ['sales', 'expenses', 'cash_movements', 'cashier_shifts', 'pos_read_models', 'authorized_users', 'users']) if (!fs.existsSync(path.join(backupDir, `${required}.json`))) throw new Error(`Backup file missing: ${required}.json`);
  }
  if (unresolved.length > 0) throw new Error(`Refusing write: unresolved=${unresolved.length}`);
  if (target === 'emulator') await patchEmulator(updates);
  else if (Object.keys(updates).length > 0) updateProduction(updates);
}

const after = target === 'emulator' ? await readEmulator('pos_read_models') : readProduction('pos_read_models');
const readModelCounts = Object.fromEntries(mappings.map(([, targetName]) => [targetName, Object.keys(after?.[targetName] || {}).length]));
for (const [compound] of byTargetKey) {
  const [targetName, key] = compound.split('/');
  assert.equal(Boolean(after?.[targetName]?.[key]), true, `${targetName}/${key} backfill row`);
}

let secondRun = null;
if (target === 'emulator' || mode === 'apply') {
  const secondExisting = target === 'emulator' ? after : readProduction('pos_read_models');
  const secondUpdates = {};
  let secondConflicts = 0;
  for (const [compound, record] of byTargetKey) {
    const [targetName, key] = compound.split('/');
    const prior = secondExisting?.[targetName]?.[key];
    if (!prior) secondUpdates[`pos_read_models/${targetName}/${key}`] = record.model;
    else if (stable(prior) !== stable(record.model)) secondConflicts += 1;
  }
  secondRun = { inserted: Object.keys(secondUpdates).length, duplicated: secondConflicts, changes: Object.keys(secondUpdates).length, idempotency: secondConflicts === 0 && Object.keys(secondUpdates).length === 0 ? 'PASS' : 'FAIL' };
}

console.log(JSON.stringify({ target, project: projectId, database: instance, mode, production_target_used: target === 'production' ? 'YES' : 'NO', source_counts: sourceCounts, counts, coverage, read_model_counts: readModelCounts, second_run: secondRun, unresolved: unresolved.slice(0, 20), idempotency: secondRun?.idempotency || 'NOT_RUN' }, null, 2));
