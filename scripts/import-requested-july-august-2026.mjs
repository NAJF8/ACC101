/**
 * Additive import for the user-supplied July/August 2026 expense list.
 * Defaults to Emulator; Production requires the explicit --target production.
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const args = process.argv.slice(2);
const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : 'emulator';
const dryRun = args.includes('--dry-run');
if (!['emulator', 'production'].includes(target)) throw new Error('target must be emulator or production');
const isEmulator = target === 'emulator';
if (isEmulator) process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9000';
if (!isEmulator && process.env.FIREBASE_DATABASE_EMULATOR_HOST) throw new Error('رفض التشغيل: متغير Emulator موجود أثناء استهداف Production');

if (isEmulator) initializeApp({ projectId: 'acc-101', databaseURL: 'https://acc-101-default-rtdb.europe-west1.firebasedatabase.app' });
const db = isEmulator ? getDatabase() : null;
const batch = 'requested-july-august-2026-expenses';
const createdBy = 'import-requested-july-august-2026';

const rows = [
  ['07-01', 'مافن', 8, 'قطعة', 12000],
  ['07-05', 'براونيز', 9, 'قطعة', 18000],
  ['07-08', 'براونيز', 9, 'قطعة', 18000],
  ['07-09', 'مافن', 8, 'قطعة', 12000], ['07-09', 'ساندويش', 5, 'قطعة', 10000], ['07-09', 'براونيز', 9, 'قطعة', 18000],
  ['07-11', 'براونيز', 9, 'قطعة', 18000],
  ['07-12', 'مافن', 8, 'قطعة', 12000], ['07-12', 'ساندويش', 15, 'قطعة', 27500],
  ['07-15', 'براونيز', 9, 'قطعة', 18000], ['07-15', 'مافن', 8, 'قطعة', 12000],
  ['07-17', 'براونيز', 9, 'قطعة', 18000], ['07-17', 'ساندويش', 5, 'قطعة', 10000],
  ['07-18', 'مافن', 8, 'قطعة', 12000],
  ['07-19', 'براونيز', 9, 'قطعة', 18000],
  ['07-21', 'ساندويش', 5, 'قطعة', 10000],
  ['07-25', 'براونيز', 8, 'قطعة', 16000],
  ['07-27', 'مافن', 8, 'قطعة', 12000],
  ['07-29', 'براونيز', 9, 'قطعة', 18000],
  ['08-04', 'براونيز', 9, 'قطعة', 18000], ['08-04', 'مافن', 8, 'قطعة', 12000],
  ['08-05', 'سيروبات موهيتو', null, null, 98000],
  ['08-08', 'ساندويش', 5, 'قطعة', 10000], ['08-08', 'ساندويش', 5, 'قطعة', 10000],
  ['08-09', 'براونيز', 9, 'قطعة', 18000], ['08-09', 'مافن', 8, 'قطعة', 12000],
  ['08-09', 'شراء بن جبران', null, null, 279500],
  ['08-12', 'ساندويش', 5, 'قطعة', 10000], ['08-12', 'براونيز', 9, 'قطعة', 18000],
  ['08-16', 'براونيز', 9, 'قطعة', 18000], ['08-16', 'ساندويش', 5, 'قطعة', 10000], ['08-16', 'مافن', 8, 'قطعة', 12000],
  ['08-21', 'راتب علي تحسين', null, null, 30000, 'تكملة شهر السابع', 'رواتب'],
];

const withdrawal = { date: '2026-08-12', description: 'سحب محمد حسن', amount: 50000 };
const isoDate = (mmdd) => `2026-${mmdd}`;
const categoryFor = (name, override) => override || (name === 'شراء بن جبران' ? 'مشتريات بن / قهوة' : name === 'سيروبات موهيتو' ? 'مشتريات / مشروبات' : 'مشتريات');
const makeId = (kind, index) => `${batch}-${kind}-${String(index + 1).padStart(2, '0')}`;
const now = new Date().toISOString();

const readProduction = () => {
  const output = execFileSync('cmd.exe', ['/d', '/s', '/c', 'npx -y firebase-tools@latest database:get / --project acc-101'], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  const start = output.indexOf('{'); const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Production read did not return JSON');
  return JSON.parse(output.slice(start, end + 1));
};
const readRoot = async () => isEmulator ? ((await db.ref('/').once('value')).val() || {}) : readProduction();
const writeRoot = async (updates) => {
  if (!Object.keys(updates).length) return null;
  if (isEmulator) { await db.ref('/').update(updates); return null; }
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const updatePath = `outputs/requested-july-august-2026-${stamp}.json`;
  fs.writeFileSync(updatePath, JSON.stringify(updates, null, 2), 'utf8');
  execFileSync('cmd.exe', ['/d', '/s', '/c', `npx -y firebase-tools@latest database:update / ${updatePath} --project acc-101 --force`], { stdio: 'inherit', maxBuffer: 32 * 1024 * 1024 });
  return updatePath;
};

const expectedExpenseTotal = rows.reduce((n, row) => n + row[4], 0);
if (rows.length !== 33 || expectedExpenseTotal !== 845000) throw new Error(`بيانات الإدخال غير متوقعة: ${rows.length} / ${expectedExpenseTotal}`);

const existing = await readRoot();
const updates = {};
let inserted = 0;
let skipped = 0;

function addOrCheck(path, value) {
  const old = path.split('/').reduce((node, key) => node?.[key], existing);
  if (old) {
    const comparable = (item) => JSON.stringify(Object.fromEntries(Object.entries(item).filter(([key]) => !['created_at', 'updated_at'].includes(key)).sort(([a], [b]) => a.localeCompare(b))));
    if (comparable(old) !== comparable(value)) {
      throw new Error(`تعارض مع سجل موجود مسبقاً: ${path}`);
    }
    skipped++;
    return;
  }
  updates[path] = value;
  inserted++;
}

rows.forEach((row, index) => {
  const [mmdd, name, quantity, unit, amount, description, overrideCategory] = row;
  const date = isoDate(mmdd);
  const id = makeId('expense', index);
  const category = categoryFor(name, overrideCategory);
  const expense = {
    id, amount: Number(amount), date, month: date.slice(0, 7), category, category_name: category,
    description: description || name, name, payment_method: 'cash', paid_amount: Number(amount), remaining_amount: 0,
    payment_status: 'paid', status: 'active', deleted: false, source_type: 'expense', source_batch: batch,
    source_key: `expense:${id}`, source_fingerprint: `${batch}:${index + 1}:${date}:${name}:${amount}`,
    import_batch_id: batch, created_at: now, updated_at: now, created_by: createdBy, updated_by: createdBy,
    ...(quantity == null ? {} : { quantity: Number(quantity), unit }),
  };
  addOrCheck(`expenses/${id}`, expense);
  const cashId = makeId('cash', index);
  addOrCheck(`cash_movements/${cashId}`, {
    id: cashId, type: 'OUT', amount: Number(amount), date, month: date.slice(0, 7), payment_method: 'cash',
    cash_account_id: 'cashier', reason: `مصروف: ${expense.description}`, source_type: 'expense', source_id: id,
    source_key: `expense:${id}`, auto: true, source_batch: batch, created_at: now, created_by: createdBy,
  });
});

const withdrawalId = `${batch}-withdrawal-01`;
addOrCheck(`employee_advances/${withdrawalId}`, {
  id: withdrawalId, employee_name: 'محمد حسن', description: withdrawal.description, details: withdrawal.description,
  amount: withdrawal.amount, date: withdrawal.date, month: withdrawal.date.slice(0, 7), category_name: 'سحوبات موظفين',
  legacy_type: 'employee_withdrawal', source_type: 'employee_advance', source_key: `employee_advance:${withdrawalId}`,
  import_batch_id: batch, status: 'active', created_at: now, updated_at: now, created_by: createdBy,
});

let backupPath = null;
let updatePath = null;
if (!dryRun && !isEmulator) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  backupPath = `backups/acc-101-production-pre-requested-july-august-2026-${stamp}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(existing, null, 2), 'utf8');
}
if (!dryRun) updatePath = await writeRoot(updates);

const after = dryRun
  ? Object.entries(updates).reduce((root, [path, value]) => {
      const parts = path.split('/'); const leaf = parts.pop(); let node = root;
      for (const part of parts) node = node[part] ||= {};
      node[leaf] = value;
      return root;
    }, JSON.parse(JSON.stringify(existing)))
  : await readRoot();
const insertedExpenses = Object.values(after.expenses || {}).filter((x) => x.import_batch_id === batch && !x.deleted);
const insertedAdvances = Object.values(after.employee_advances || {}).filter((x) => x.import_batch_id === batch && !x.deleted);
const sum = (items) => items.reduce((n, x) => n + Number(x.amount || 0), 0);
const byMonth = (items, month) => items.filter((x) => String(x.date || '').startsWith(month));
const july = byMonth(insertedExpenses, '2026-07');
const august = byMonth(insertedExpenses, '2026-08');

const checks = {
  expense_rows: insertedExpenses.length === 33,
  withdrawal_rows: insertedAdvances.length === 1,
  july_total: sum(july) === 289500,
  august_expense_total: sum(august) === 555500,
  august_all_requested_total: sum(august) + sum(insertedAdvances.filter((x) => x.month === '2026-08')) === 605500,
  july_18_muffin: july.filter((x) => x.date === '2026-07-18' && x.name === 'مافن' && x.quantity === 8 && x.amount === 12000).length === 1,
  august_8_two_sandwiches: august.filter((x) => x.date === '2026-08-08' && x.name === 'ساندويش' && x.amount === 10000).length === 2,
  numeric_amounts: [...july, ...august].every((x) => typeof x.amount === 'number'),
  idempotent_second_run: rows.every((_, index) => after.expenses?.[makeId('expense', index)]) && !!after.employee_advances?.[withdrawalId],
};
if (Object.values(checks).some((ok) => !ok)) throw new Error(`فشل التحقق: ${JSON.stringify(checks)}`);
console.log(JSON.stringify({ target, batch, dry_run: dryRun, requested_records: 34, expense_records: 33, withdrawal_records: 1, inserted, skipped, july_total: sum(july), august_expense_total: sum(august), august_all_requested_total: 605500, backup_path: backupPath, update_path: updatePath, checks }, null, 2));
