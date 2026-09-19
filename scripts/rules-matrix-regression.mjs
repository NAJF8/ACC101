import { connectAuthEmulator, signInAnonymously, signOut } from 'firebase/auth';
import { connectDatabaseEmulator, ref, set, update, remove } from 'firebase/database';

const host = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error(`Refusing non-local emulator host: ${host}`);
const { auth, db } = await import('../src/services/firebase.js');
connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true }); connectDatabaseEmulator(db, host, 9000);
const ownerUrl = (path) => `http://${host}:9000/${path}.json?ns=acc-101-default-rtdb&access_token=owner`;
const ownerSet = async (path, value) => { const r = await fetch(ownerUrl(path), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }); if (!r.ok) throw new Error(`seed ${path}: ${r.status}`); };
const denied = async (fn) => { try { await fn(); return false; } catch (e) { return /PERMISSION_DENIED|permission-denied|permission denied/i.test(`${e.code} ${e.message}`); } };
const allowed = async (fn) => !(await denied(fn));
const results = {}; const record = (name, value) => { results[name] = Boolean(value); if (!value) console.error(`FAIL: ${name}`); };
const users = {};
const signInAs = async (role, permissions = {}) => { await signOut(auth).catch(() => null); const uid = (await signInAnonymously(auth)).user.uid; await auth.authStateReady(); users[role] = uid; await ownerSet(`users/${uid}`, { id: uid, role, active: true, permissions }); await new Promise((r) => setTimeout(r, 150)); return uid; };
const write = (path, value) => set(ref(db, path), value);
const sample = (id, month = '2026-09') => ({ id, month, date: '2026-09-13', amount: 100, total_after_discount: 100, created_at: new Date().toISOString(), created_by: auth.currentUser?.uid });

await ownerSet('', null); await ownerSet('monthly_periods', { '2026-09': { month: '2026-09', status: 'open' }, '2026-06': { month: '2026-06', status: 'closed' }, '2026-10': { month: '2026-10', status: 'open' } });
await ownerSet('inventory_items/item', { id: 'item', name_ar: 'TEST', quantity: 100, purchase_price: 10, min_stock: 2 });

const cashier = await signInAs('cashier', { sales: { create: true }, shifts: { open: true, close: true }, payment_review: { edit: true } });
record('cashier_other_income_category_denied', await denied(() => write('other_income_categories/cashier', { id: 'cashier', name_ar: 'DENIED', active: true, created_at: new Date().toISOString(), created_by: cashier })));
record('cashier_sale_create', await allowed(() => write('sales/matrix-sale', { ...sample('matrix-sale'), payment_method: 'cash' })));
record('cashier_sale_delete_denied', await denied(() => remove(ref(db, 'sales/matrix-sale'))));
record('cashier_arbitrary_inventory_operation_denied', await denied(() => write('inventory_operations/cashier-arbitrary', { id: 'cashier-arbitrary', status: 'completed', source_type: 'stocktake', created_by: cashier })));
record('cashier_inventory_positive_adjustment_denied', await denied(() => write('inventory_items/item/quantity', 101)));
record('cashier_inventory_quantity_decrease_allowed', await allowed(() => write('inventory_items/item/quantity', 99)));
record('cashier_inventory_metadata_denied', await denied(() => update(ref(db, 'inventory_items/item'), { purchase_price: 1, name_ar: 'tampered' })));
record('cashier_inventory_movement_denied', await denied(() => write('inventory_movements/cashier-arbitrary', { id: 'cashier-arbitrary', type: 'ADJUSTMENT', source_type: 'manual', quantity_delta: 1, created_by: cashier })));
record('cashier_owner_deposit_denied', await denied(() => write('owner_deposits/cashier', sample('cashier'))));
record('cashier_owner_withdrawal_denied', await denied(() => write('owner_withdrawals/cashier', sample('cashier'))));
record('cashier_employee_salary_denied', await denied(() => write('employees/e1', { id: 'e1', base_salary: 999999 })));
record('cashier_import_denied', await denied(() => write('imports/cashier', { id: 'cashier' })));
record('cashier_legacy_summary_denied', await denied(() => write('legacy_monthly_summaries/cashier', sample('cashier'))));
record('cashier_audit_rewrite_denied', await denied(() => update(ref(db, 'audit/old'), { action: 'rewrite' })));

const viewer = await signInAs('viewer', { sales: { view: true } });
record('viewer_sale_denied', await denied(() => write('sales/viewer', sample('viewer'))));
record('viewer_purchase_denied', await denied(() => write('purchases/viewer', sample('viewer'))));
record('viewer_expense_denied', await denied(() => write('expenses/viewer', sample('viewer'))));
record('viewer_payroll_denied', await denied(() => write('payroll/viewer', sample('viewer'))));
record('viewer_shift_denied', await denied(() => write('cashier_shifts/viewer', { id: 'viewer', cashier_uid: viewer, month: '2026-09', status: 'open' })));

const manager = await signInAs('manager');
record('manager_other_income_category_allowed', await allowed(() => write('other_income_categories/manager', { id: 'manager', name_ar: 'Manager category', active: true, created_at: new Date().toISOString(), created_by: manager })));
record('manager_sale_create', await allowed(() => write('sales/manager', sample('manager'))));
record('manager_purchase_create', await allowed(() => write('purchases/manager', sample('manager'))));
record('manager_expense_create', await allowed(() => write('expenses/manager', sample('manager'))));
record('manager_employee_child_write', await allowed(() => write('employees/manager', { id: 'manager', name: 'TEST' })));
record('manager_employee_parent_write_denied', await denied(() => write('employees', { bypass: { id: 'bypass' } })));
record('manager_import_parent_write_denied', await denied(() => write('imports', { bypass: { id: 'bypass' } })));
record('manager_legacy_parent_write_denied', await denied(() => write('legacy_monthly_summaries', { bypass: { id: 'bypass' } })));
record('manager_owner_deposit', await allowed(() => write('owner_deposits/manager', sample('manager'))));
record('manager_owner_withdrawal', await allowed(() => write('owner_withdrawals/manager', sample('manager'))));
record('manager_payroll_write', await allowed(() => write('payroll/manager', sample('manager'))));
record('manager_shift_management', await allowed(() => write('cashier_shifts/manager', { id: 'manager', cashier_uid: 'other', month: '2026-09', status: 'open' })));

const importer = await signInAs('employee', { excel: { import: true } });
record('explicit_import_child_write', await allowed(() => write('imports/allowed', { id: 'allowed', created_by: importer })));
record('explicit_legacy_child_write', await allowed(() => write('legacy_monthly_summaries/allowed', { id: 'allowed', month: '2026-09', amount: 1 })));

const admin = await signInAs('super_admin');
record('audit_append_allowed', await allowed(() => write('audit/matrix-new', { id: 'matrix-new', action: 'TEST', entity: 'tests', entity_id: 'matrix', actor_uid: admin, created_at: new Date().toISOString() })));
record('audit_update_denied', await denied(() => update(ref(db, 'audit/matrix-new'), { action: 'ALTERED' })));
record('audit_delete_denied', await denied(() => remove(ref(db, 'audit/matrix-new'))));
record('admin_reopen_open_month', await allowed(() => update(ref(db, 'monthly_periods/2026-06'), { status: 'open' })));

await ownerSet('monthly_periods/2026-06/status', 'closed');
await signInAs('cashier', { sales: { create: true } });
record('closed_month_sale_denied', await denied(() => write('sales/closed', { ...sample('closed', '2026-06'), payment_method: 'cash' })));
record('closed_month_purchase_denied', await denied(() => write('purchases/closed', sample('closed', '2026-06'))));
record('closed_month_expense_denied', await denied(() => write('expenses/closed', sample('closed', '2026-06'))));
record('closed_month_owner_deposit_denied', await denied(() => write('owner_deposits/closed', sample('closed', '2026-06'))));
record('closed_month_owner_withdrawal_denied', await denied(() => write('owner_withdrawals/closed', sample('closed', '2026-06'))));
record('closed_month_payroll_denied', await denied(() => write('payroll/closed', sample('closed', '2026-06'))));
await signOut(auth); await new Promise((r) => setTimeout(r, 200)); const unauthResponse = await fetch(`http://${host}:9000/sales/unauth.json?ns=acc-101-default-rtdb`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sample('unauth')) }); record('unauthenticated_sale_denied', !unauthResponse.ok);

console.log(JSON.stringify({ emulator: true, production_target_used: 'NO', results }, null, 2));
process.exit(Object.values(results).some((value) => !value) ? 1 : 0);
