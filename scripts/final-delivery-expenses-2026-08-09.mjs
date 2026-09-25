import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const project = 'acc-101';
const sourceBatch = 'owner-final-expenses-2026-08-09';
const rows = [
  { date: '2026-08-28', person_name: 'روان', raw_description: 'زيارة / زيادة', description: 'زيارة / زيادة', amount: 250, category: 'مصاريف', subcategory: 'مصاريف أشخاص', accounting_class: 'operating_expense' },
  { date: '2026-08-28', person_name: 'ميس', raw_description: 'زيادة', description: 'زيادة', amount: 250, category: 'مصاريف', subcategory: 'مصاريف أشخاص', accounting_class: 'operating_expense' },
  { date: '2026-09-02', person_name: 'دكتور رافد', raw_description: 'أجور تمويل من دكتور رافد', description: 'أجور تمويل من دكتور رافد', amount: 50000, category: 'مصاريف', subcategory: 'أجور / تمويل', accounting_class: 'operating_expense' },
  { date: '2026-09-03', raw_description: 'توصيل بن جبران', description: 'توصيل بن جبران', amount: 360000, category: 'مشتريات ومواد', subcategory: 'مواد القهوة', item_name: 'بن جبران', accounting_class: 'purchase' },
  { date: '2026-09-05', raw_description: 'سحب من الدخل', description: 'سحب من الدخل', amount: 1000, category: 'مصاريف', subcategory: 'سحوبات', accounting_class: 'operating_expense' },
  { date: '2026-09-05', raw_description: 'توصيل كيك', description: 'توصيل كيك', amount: 81000, category: 'كيك وحلويات', subcategory: 'نقل وتوصيل', accounting_class: 'operating_expense', classification_note: 'النص يثبت أجرة توصيل فقط؛ لا دليل يثبت شراء الكيك.' },
  { date: '2026-09-07', person_name: 'ميس', raw_description: 'ميس', description: 'ميس', amount: 10000, category: 'مصاريف', subcategory: 'مصاريف أشخاص', accounting_class: 'operating_expense' },
  { date: '2026-09-07', person_name: 'روان', raw_description: 'راتب شهر 8', description: 'راتب شهر 8', amount: 120000, category: 'رواتب وأجور', subcategory: 'رواتب وأجور', accounting_class: 'payroll', payment_date: '2026-09-07', period_earned: '2026-08' },
  { date: '2026-09-10', person_name: 'علي', raw_description: 'راتب شهر 8', description: 'راتب شهر 8', amount: 70000, category: 'رواتب وأجور', subcategory: 'رواتب وأجور', accounting_class: 'payroll', payment_date: '2026-09-10', period_earned: '2026-08' },
  { date: '2026-09-14', raw_description: 'طلبية كيك', description: 'طلبية كيك', amount: 103000, category: 'مشتريات ومواد', subcategory: 'كيك وحلويات', item_name: 'كيك', accounting_class: 'purchase' },
  { date: '2026-09-15', person_name: 'محمد', raw_description: 'تصميم منيو', description: 'تصميم منيو', amount: 50000, category: 'مصاريف', subcategory: 'تصميم / تسويق', accounting_class: 'operating_expense' },
  { date: '2026-09-15', raw_description: 'بن جبران — قهوة', description: 'بن جبران — قهوة', amount: 150000, category: 'مشتريات ومواد', subcategory: 'مواد القهوة', item_name: 'بن جبران', accounting_class: 'purchase' },
  { date: '2026-09-17', person_name: 'محمد الكاشير', raw_description: 'سحب محمد الكاشير', description: 'سحب محمد الكاشير', amount: 6000, category: 'مصاريف', subcategory: 'مصاريف أشخاص / سحوبات', accounting_class: 'operating_expense' },
].map((row, index) => ({ ...row, operation_id: `${sourceBatch}:${String(index + 1).padStart(3, '0')}`, source_key: `${sourceBatch}:${String(index + 1).padStart(3, '0')}` }));

const normalize = (value) => String(value ?? '').trim().replace(/[ًٌٍَُِّْـ]/g, '').replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ').toLowerCase();
const fingerprint = (row) => crypto.createHash('sha256').update(JSON.stringify({ batch: sourceBatch, date: row.date, payment_date: row.payment_date || row.date, period_earned: row.period_earned || '', person_name: row.person_name || '', description: normalize(row.raw_description), amount: row.amount, category: normalize(row.category), subcategory: normalize(row.subcategory), accounting_class: row.accounting_class })).digest('hex');
const values = (root, name) => Object.entries(root[name] || {}).map(([id, row]) => ({ id, ...(row || {}) }));
const readProduction = () => {
  const output = execFileSync('cmd.exe', ['/d', '/s', '/c', `npx -y firebase-tools@latest database:get / --project ${project}`], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  const marker = /\r?\n\{\r?\n  "status"/.exec(output);
  const jsonText = (marker ? output.slice(0, marker.index) : output).trim();
  return JSON.parse(jsonText);
};
const stamp = () => new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const buildRecord = (row, id, now) => ({
  id, operation_id: row.operation_id, source_id: id, source_key: row.source_key, source_fingerprint: fingerprint(row), source_batch: sourceBatch,
  amount: row.amount, paid_amount: row.amount, remaining_amount: 0, payment_status: 'paid', payment_method: 'cash', date: row.date, month: row.date.slice(0, 7),
  payment_date: row.payment_date || row.date, period_earned: row.period_earned || null, person_name: row.person_name || '', raw_description: row.raw_description,
  description: row.description, name: row.person_name || row.item_name || row.description, item_name: row.item_name || null, category: row.category, category_name: row.subcategory,
  subcategory: row.subcategory, accounting_class: row.accounting_class, accounting_class_requested: row.accounting_class === 'purchase' ? 'purchase/material' : row.accounting_class,
  classification_note: row.classification_note || '', source_type: 'owner_final_expense_batch', status: 'active', deleted: false,
  created_at: now, updated_at: now, created_by: 'owner-final-expenses-2026-08-09', updated_by: 'owner-final-expenses-2026-08-09',
});
const buildMirrors = (row, id, record) => {
  const updates = {
    [`expenses/${id}`]: record,
    [`historical_imports/${id}`]: { ...record, destination_type: row.accounting_class === 'purchase' ? 'purchases' : 'expenses', destination_id: id, source_filename: sourceBatch, source_sheet: 'owner approved final list', source_row: Number(id.slice(-3)), total: row.amount },
  };
  if (row.accounting_class === 'purchase') updates[`purchases/${id}`] = { ...record, total: row.amount, total_after_discount: row.amount, purchase_price: row.amount, purchase_type: 'material', inventory_item_name: row.item_name || row.subcategory };
  updates[`cash_movements/${id}`] = { id, operation_id: row.operation_id, source_id: id, source_key: `expense:${id}`, source_type: 'expense', type: 'OUT', amount: row.amount, date: row.date, month: row.date.slice(0, 7), payment_method: 'cash', reason: row.description, auto: true, source_batch: sourceBatch, created_at: record.created_at, created_by: record.created_by };
  return updates;
};

const main = () => {
  const root = readProduction();
  const backupPath = `backups/acc-101-production-pre-final-delivery-write-${stamp()}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(root, null, 2), 'utf8');
  const existing = [...values(root, 'expenses'), ...values(root, 'purchases'), ...values(root, 'historical_imports')];
  const identities = new Set(existing.flatMap((row) => [row.operation_id, row.operation_key, row.source_key, row.source_fingerprint].filter(Boolean).map(String)));
  const updates = {};
  const report = [];
  const now = new Date().toISOString();
  for (const row of rows) {
    const id = `owner-final-expenses-2026-08-09-${row.operation_id.slice(-3)}`;
    const fp = fingerprint(row);
    const prior = existing.find((item) => [item.operation_id, item.source_key, item.source_fingerprint].filter(Boolean).map(String).includes(row.operation_id) || item.source_fingerprint === fp);
    if (prior || identities.has(row.operation_id) || identities.has(row.source_key) || identities.has(fp)) {
      report.push({ date: row.date, description: row.description, amount: row.amount, classification: row.accounting_class, status: 'skipped', record_id: prior?.id || null, operation_id: row.operation_id });
      continue;
    }
    const record = buildRecord(row, id, now);
    Object.assign(updates, buildMirrors(row, id, record));
    identities.add(row.operation_id); identities.add(row.source_key); identities.add(fp);
    report.push({ date: row.date, description: row.description, amount: row.amount, classification: row.accounting_class, status: 'created', record_id: id, operation_id: row.operation_id });
  }
  const summary = { project, source_batch: sourceBatch, backup_path: backupPath, backup_size: fs.statSync(backupPath).size, created: report.filter((x) => x.status === 'created').length, skipped: report.filter((x) => x.status === 'skipped').length, update_paths: Object.keys(updates).length, rows: report };
  if (process.argv.includes('--dry-run')) { console.log(JSON.stringify({ ...summary, dry_run: true }, null, 2)); return; }
  const updatePath = `outputs/${sourceBatch}-${stamp()}.json`;
  fs.writeFileSync(updatePath, JSON.stringify(updates, null, 2), 'utf8');
  if (Object.keys(updates).length) execFileSync('npx.cmd', ['-y', 'firebase-tools@latest', 'database:update', '/', updatePath, '--project', project, '--force'], { stdio: 'inherit', maxBuffer: 32 * 1024 * 1024 });
  const after = readProduction();
  const secondExisting = [...values(after, 'expenses'), ...values(after, 'purchases'), ...values(after, 'historical_imports')];
  const secondIds = new Set(secondExisting.flatMap((row) => [row.operation_id, row.source_key, row.source_fingerprint].filter(Boolean).map(String)));
  const secondRun = rows.filter((row) => !secondIds.has(row.operation_id) && !secondIds.has(row.source_key) && !secondIds.has(fingerprint(row))).length;
  const readback = report.map((item) => ({ ...item, present: Boolean(after.expenses?.[item.record_id]) || item.status === 'skipped', cash_present: item.status === 'skipped' || Boolean(after.cash_movements?.[item.record_id]) }));
  console.log(JSON.stringify({ ...summary, update_path: updatePath, second_run_created: secondRun, readback }, null, 2));
  if (secondRun !== 0 || readback.some((item) => !item.present || !item.cash_present)) process.exitCode = 1;
};
main();
