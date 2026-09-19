import assert from 'node:assert/strict';
import { connectAuthEmulator, signInAnonymously, signOut } from 'firebase/auth';
import { connectDatabaseEmulator, get, ref } from 'firebase/database';

const host = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error(`Refusing non-local emulator host: ${host}`);
const projectId = process.env.FIREBASE_PROJECT_ID || 'acc-101';
const { auth, db } = await import('../src/services/firebase.js');
connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
connectDatabaseEmulator(db, host, 9000);
const ownerUrl = (path) => `http://${host}:9000/${path}.json?ns=${projectId}-default-rtdb&access_token=owner`;
const ownerSet = async (path, value) => { const response = await fetch(ownerUrl(path), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }); if (!response.ok) throw new Error(`seed failed: ${response.status}`); };
const read = async (path) => (await get(ref(db, path))).val();

await ownerSet('', null);
const user = (await signInAnonymously(auth)).user;
await ownerSet(`users/${user.uid}`, { id: user.uid, role: 'super_admin', active: true });
await ownerSet('monthly_periods', { '2026-08': { month: '2026-08', status: 'open' } });
await ownerSet('cash_accounts/cashier', { id: 'cashier', active: true, opening_balance: 0 });
const { api } = await import('../src/services/api.js');

const employeeEvents = [];
const stopEmployees = api.subscribeEmployees((rows) => employeeEvents.push(rows));
const employee = await api.create('employees', { name: 'Realtime Employee', status: 'active' });
await new Promise((resolve) => setTimeout(resolve, 120));
await api.update('employees', employee.id, { name: 'Realtime Employee Edited' });
await new Promise((resolve) => setTimeout(resolve, 120));
stopEmployees();
assert(employeeEvents.some((rows) => rows.some((row) => row.id === employee.id)));
assert(employeeEvents.some((rows) => rows.some((row) => row.id === employee.id && row.name === 'Realtime Employee Edited')));

const machine = await api.saveOtherIncomeCategory({ name_ar: 'بيع ماكينة قهوة' });
const capsule = await api.saveOtherIncomeCategory({ name_ar: 'بيع كبسولة' });
const custom = await api.saveOtherIncomeCategory({ name_ar: 'Test Custom Income' });
const income = await api.create('other_income', { date: '2026-08-10', month: '2026-08', amount: 5000, category: custom.id, description: 'اختبار فئة ديناميكية', payment_method: 'cash' });
assert.equal(income.category_id, custom.id);
assert.equal(income.category_name, 'Test Custom Income');
assert.equal((await read(`other_income/${income.id}`)).category_id, custom.id);
assert.equal((await read('sales')), null);
assert.equal(Object.values((await read('cash_movements')) || {}).filter((row) => row.source_id === income.id && row.type === 'IN').length, 1);
await api.archiveOtherIncomeCategory(capsule.id);
assert.equal((await read(`other_income_categories/${capsule.id}`)).active, false);
assert(machine.active);

const closed = await api.closeMonth('2026-08', { actual_counted_cash: 5000, notes: 'اختبار الإقفال والترحيل' });
assert.equal(closed.status, 'closed');
assert.equal(closed.next_month, '2026-09');
assert.equal((await read('monthly_periods/2026-08')).status, 'closed');
assert.equal((await read('monthly_periods/2026-09')).status, 'open');
assert.equal((await read('cash_carry_forwards/2026-09')).opening_cash, 5000);
const second = await api.closeMonth('2026-08', { actual_counted_cash: 5000 });
assert.equal(second.already_closed, true);
assert.equal(Object.keys((await read('cash_carry_forwards')) || {}).length, 1);
const nextSale = await api.create('sales', { date: '2026-09-01', month: '2026-09', product_name: 'Next month sale', quantity: 1, unit_price: 1000, payment_method: 'cash', operation_key: 'next-month-sale' });
assert.equal(nextSale.month, '2026-09');

console.log(JSON.stringify({ EMPLOYEE_REALTIME: 'PASS', OTHER_INCOME_DYNAMIC_CATEGORIES: 'PASS', OTHER_INCOME_CASH: 'PASS', MONTH_CLOSE_TRANSITION: 'PASS', MONTH_CARRY_FORWARD: 'PASS', production_target_used: 'NO' }, null, 2));
await signOut(auth);
process.exit(0);
