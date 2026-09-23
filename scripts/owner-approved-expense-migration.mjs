import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const args = process.argv.slice(2);
const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : 'emulator';
const dryRun = args.includes('--dry-run');
const verifyOnly = args.includes('--verify');
const emulator = target === 'emulator';
if (!['emulator', 'production'].includes(target)) throw new Error('target must be emulator or production');
if (emulator) process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9000';
if (emulator && !getApps().length) initializeApp({ projectId: 'acc-101', databaseURL: 'https://acc-101-default-rtdb.europe-west1.firebasedatabase.app' });
const db = emulator ? getDatabase() : null;

const july = JSON.parse(fs.readFileSync(new URL('./july-2026-transactions.json', import.meta.url)));
const august = JSON.parse(fs.readFileSync(new URL('../expenses_classified.json', import.meta.url)));
const expected = { '2026-07': { count: 121, total: 3493750 }, '2026-08': { count: 127, total: 4375250 } };
const normalize = (value) => String(value ?? '').trim().replace(/[ًٌٍَُِّْـ]/g, '').replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ').toLowerCase();
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
const sourceKey = (month, row) => `paper_expense:${month}:${row.date}:${row.seq ?? row.sequence ?? row.source_sequence}:${row.amount}`;
const stableId = (key) => `paper_${hash(key)}`;
const sourceFingerprint = (month, row) => `${month === '2026-07' ? 'july2026' : 'august2026'}:${row.date}:${row.amount}:${normalize(row.original_expense_type ?? row.type ?? '')}:${normalize(row.original_details ?? row.details ?? '')}:${row.source_sequence ?? row.sequence ?? row.seq ?? ''}:${row.source_image || ''}`;
const isElectronic = (row) => ['electronic', 'الكتروني', 'إلكتروني', 'دفع الكتروني', 'دفع إلكتروني'].includes(String(row.payment_method || '').trim()) || /الكتروني|إلكتروني/.test(`${row.type || ''} ${row.original_expense_type || ''}`);
const text = (row) => normalize([row.type, row.details, row.original_expense_type, row.original_details, row.description].filter(Boolean).join(' '));

function classify(month, row) {
  const rawType = String(row.original_expense_type ?? row.type ?? '').trim();
  const rawDetails = String(row.original_details ?? row.details ?? '').trim();
  const t = text(row);
  const code = rawType.match(/^(101|102|103|105|106|107)$/)?.[1];
  const person = { '101': 'ميس', '102': rawDetails || 'علي', '103': 'حسن', '105': rawDetails || 'محمد حسن', '106': rawDetails || 'روان', '107': rawDetails || 'رافد' }[code];
  let subcategory = 'مصاريف عامة';
  let accountingClass = 'operating_expense';
  let category = 'مصاريف';
  let description = rawDetails || rawType || 'مصاريف';
  if (month === '2026-07' && Number(row.amount) === 75000 && Number(row.seq) === 57) {
    category = 'مشتريات مواد تشغيلية'; subcategory = 'مواد مشروبات'; accountingClass = 'purchase'; description = 'ماتشا';
  } else if (code) {
    category = 'مصاريف'; subcategory = person === 'حسن' ? 'رواتب وأجور' : 'مصاريف'; description = person;
  } else if (isElectronic(row)) {
    category = 'مصاريف'; subcategory = 'دفع إلكتروني عام'; description = rawDetails || 'دفع إلكتروني';
  } else if (/بن جبران|بن جبرين|ابن جبران/.test(t)) {
    category = 'مشتريات مواد تشغيلية'; subcategory = 'مواد القهوة'; description = 'بن جبرين'; accountingClass = 'purchase';
  } else if (/شركة شبكات/.test(t)) {
    category = 'مصاريف'; subcategory = 'إنترنت وشبكات'; description = 'إنترنت';
  } else if (/مولدة|كاز/.test(t)) { category = 'مصاريف'; subcategory = 'مولدة ووقود';
  } else if (/اسواق|أسواق|سرق/.test(t)) { category = 'مصاريف'; subcategory = 'أسواق ومواد';
  } else if (/حليب/.test(t)) { category = 'مشتريات مواد تشغيلية'; subcategory = 'حليب'; accountingClass = 'purchase';
  } else if (/سيروبات/.test(t)) { category = 'مشتريات مواد تشغيلية'; subcategory = 'مواد تشغيل'; accountingClass = 'purchase';
  } else if (/ايسكريم|آيسكريم/.test(t)) { category = 'مشتريات مواد تشغيلية'; subcategory = 'مواد تشغيل'; accountingClass = 'purchase';
  } else if (/كيك|حلويات/.test(t)) { category = 'مشتريات مواد تشغيلية'; subcategory = 'حلويات'; accountingClass = 'purchase';
  } else if (/فواكه|ليمون|برتقال/.test(t)) { category = 'مشتريات مواد تشغيلية'; subcategory = 'مواد'; accountingClass = 'purchase';
  } else if (/توصيل|كروة|مندوب|ديلفري/.test(t)) { category = 'مصاريف'; subcategory = 'نقل وتوصيل';
  } else if (/صيانة/.test(t)) { category = 'مصاريف'; subcategory = 'صيانة وتصليح';
  } else if (/راتب/.test(t)) { category = 'مصاريف'; subcategory = 'رواتب وأجور';
  } else if (/عزيمة/.test(t)) { category = 'مصاريف'; subcategory = 'ضيافة';
  } else if (/غداء موظفين/.test(t)) { category = 'مصاريف'; subcategory = 'ضيافة / وجبات موظفين';
  } else if (/غسل|تنظيف/.test(t)) { category = 'مصاريف'; subcategory = 'تنظيف';
  } else if (month === '2026-08' && String(row.date).endsWith('-08-05') && Number(row.amount) === 40000) { category = 'مصاريف'; subcategory = 'مصاريف'; description = 'الكاشير علي';
  } else if (month === '2026-08' && String(row.date).endsWith('-08-05') && Number(row.amount) === 10250) { category = 'مصاريف'; subcategory = 'احتياجات تشغيل';
  }
  const payment = isElectronic(row) ? 'electronic' : 'cash';
  const key = sourceKey(month, row);
  return { ...row, month, operation_id: key, source_id: key, source_key: key, original_expense_type: rawType, original_details: rawDetails, person_name: person || '', accounting_class: accountingClass, category, category_name: category, subcategory, description, payment_method: payment, payment_method_original: row.payment_method || '', show_in_monthly_expenses: true, show_in_purchases: accountingClass === 'purchase', show_in_assets: false, show_in_historical_import: true, fixed_asset: false, needs_review: false, review_required: false, classification_review_status: 'approved', classification_reason: person ? 'Owner-approved employee/code mapping' : 'Owner-approved classification rules', amount: Number(row.amount || 0), id: stableId(key) };
}

const rows = [...july.map((row) => classify('2026-07', row)), ...august.map((row) => classify('2026-08', row))];
for (const [month, rule] of Object.entries(expected)) {
  const monthRows = rows.filter((row) => row.month === month);
  const total = monthRows.reduce((sum, row) => sum + row.amount, 0);
  if (monthRows.length !== rule.count || total !== rule.total) throw new Error(`${month} source check failed: ${monthRows.length}/${total}`);
}

const build = (row) => {
  const now = new Date().toISOString();
  const record = { id: row.id, operation_id: row.operation_id, source_id: row.source_id, source_key: row.source_key, amount: row.amount, paid_amount: row.amount, remaining_amount: 0, payment_status: 'paid', date: row.date, month: row.month, category: row.category, category_name: row.subcategory, subcategory: row.subcategory, accounting_class: row.accounting_class, payment_method: row.payment_method, description: row.description, name: row.description, person_name: row.person_name, original_expense_type: row.original_expense_type, original_details: row.original_details, source_type: 'paper_expense_report', source_month: row.month, source_batch: `${row.month}-paper-expenses`, source_sequence: row.seq ?? row.sequence ?? row.source_sequence ?? '', source_image: row.source_image || '', source_fingerprint: row.source_key, needs_review: false, review_required: false, classification_review_status: 'approved', show_in_monthly_expenses: true, show_in_purchases: row.show_in_purchases, show_in_assets: false, show_in_historical_import: true, fixed_asset: false, status: 'active', deleted: false, notes: row.classification_reason, created_at: now, updated_at: now, created_by: 'owner-approved-expense-migration', updated_by: 'owner-approved-expense-migration' };
  const out = { [`expenses/${row.id}`]: record, [`historical_imports/${row.id}`]: { ...record, id: row.id, accounting_class: row.accounting_class === 'purchase' ? 'purchase' : 'expense', destination_type: row.accounting_class === 'purchase' ? 'purchases' : 'expenses', destination_id: row.id, source_filename: row.source_image || '', source_sheet: 'paper expense report', source_row: Number(row.seq ?? row.sequence ?? row.source_sequence ?? 0), name: row.description, amount: row.amount, total: row.amount } };
  if (row.show_in_purchases) out[`purchases/${row.id}`] = { ...record, id: row.id, total: row.amount, purchase_price: row.amount, item_name: row.description, purchase_type: 'material', inventory_item_name: row.subcategory };
  if (row.payment_method === 'cash') out[`cash_movements/${row.id}`] = { id: row.id, operation_id: row.operation_id, source_id: row.id, source_key: `expense:${row.id}`, source_type: 'expense', type: 'OUT', amount: row.amount, date: row.date, month: row.month, payment_method: 'cash', reason: `مصروف: ${row.description}`, auto: true, source_batch: `${row.month}-paper-expenses`, created_at: now, created_by: 'owner-approved-expense-migration' };
  return out;
};

async function main() {
  const readProduction = () => {
    const output = execFileSync('cmd.exe', ['/d', '/s', '/c', 'npx -y firebase-tools@latest database:get / --project acc-101'], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
    const start = output.indexOf('{'); const end = output.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Production read did not return JSON');
    return JSON.parse(output.slice(start, end + 1));
  };
  const existing = emulator ? ((await db.ref().once('value')).val() || {}) : readProduction();
  const existingExpenses = Object.values(existing.expenses || {});
  const existingByKey = new Map();
  for (const row of existingExpenses.filter((item) => !item.deleted)) {
    if (row.source_key) existingByKey.set(row.source_key, row);
    if (row.source_fingerprint) existingByKey.set(row.source_fingerprint, row);
  }
  for (const row of rows) {
    const prior = existingExpenses.find((item) => !item.deleted && item.source_fingerprint === sourceFingerprint(row.month, row));
    if (prior) existingByKey.set(row.source_key, prior);
  }
  const existingCash = Object.values(existing.cash_movements || {}).filter((item) => !item.deleted);
  const updates = {};
  let createCount = 0, updateCount = 0;
  for (const row of rows) {
    const prior = existingByKey.get(row.source_key);
    const built = build(row);
    if (prior && prior.updated_by === 'owner-approved-expense-migration' && Number(prior.amount) === row.amount && prior.accounting_class === row.accounting_class && prior.classification_review_status === 'approved' && prior.deleted !== true) continue;
    if (prior && prior.id !== row.id) {
      const priorCash = existingCash.find((item) => item.source_id === prior.id || item.source_key === `expense:${prior.id}`);
      for (const [path, value] of Object.entries(built)) if (path.endsWith(`/${row.id}`)) {
        delete updates[path];
        const replacementId = path.startsWith('cash_movements/') ? (priorCash?.id || row.id) : prior.id;
        updates[path.replace(`/${row.id}`, `/${replacementId}`)] = { ...value, id: replacementId, source_id: path.startsWith('cash_movements/') ? prior.id : row.source_id, operation_id: row.operation_id, created_at: prior.created_at || value.created_at, created_by: prior.created_by || value.created_by };
      }
      updateCount++;
    } else { Object.assign(updates, built); prior ? updateCount++ : createCount++; }
  }
  const summary = { target, dryRun, verifyOnly, source: { july: expected['2026-07'], august: expected['2026-08'] }, rows: rows.length, createCount, updateCount, updatePaths: Object.keys(updates).length, needsReview: rows.filter((row) => row.needs_review).length, matcha: rows.find((row) => row.month === '2026-07' && row.amount === 75000 && row.seq === 57) };
  console.log(JSON.stringify(summary, null, 2));
  if (dryRun || verifyOnly) return;
  if (!emulator) {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const backupPath = `backups/acc-101-production-pre-owner-approved-expenses-${stamp}.json`;
    fs.writeFileSync(backupPath, JSON.stringify(existing, null, 2), 'utf8');
    const updatePath = `outputs/owner-approved-expense-migration-${stamp}.json`;
    fs.writeFileSync(updatePath, JSON.stringify(updates, null, 2), 'utf8');
    execFileSync('cmd.exe', ['/d', '/s', '/c', `npx -y firebase-tools@latest database:update / "${updatePath}" --project acc-101 --force`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    console.log(JSON.stringify({ backupPath, updatePath }, null, 2));
  } else {
    await db.ref().update(updates);
  }
  console.log(JSON.stringify({ appliedPaths: Object.keys(updates).length }, null, 2));
}
main().then(() => process.exit(0)).catch((error) => { console.error(error.stack || error); process.exit(1); });
