import assert from 'node:assert/strict';
import { connectAuthEmulator, signInAnonymously, signOut } from 'firebase/auth';
import { connectDatabaseEmulator, get, ref } from 'firebase/database';

const host = '127.0.0.1';
const projectId = 'acc-101';
const { auth, db } = await import('../src/services/firebase.js');
const { api } = await import('../src/services/api.js');
connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
connectDatabaseEmulator(db, host, 9000);
const url = (path) => `http://${host}:9000/${path}.json?ns=${projectId}-default-rtdb&access_token=owner`;
const ownerPut = async (path, value) => { const r = await fetch(url(path), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }); assert.equal(r.ok, true, `seed failed: ${path}`); };
const read = async (path) => (await get(ref(db, path))).val();
const cashFor = async (sourceId) => Object.values(await read('cash_movements') || {}).filter((x) => x.source_id === sourceId && !x.deleted);
const expectError = async (fn, pattern) => { try { await fn(); return false; } catch (e) { return pattern.test(`${e.code} ${e.message}`); } };

await ownerPut('', null);
const uid = (await signInAnonymously(auth)).user.uid;
await ownerPut(`users/${uid}`, { id: uid, role: 'manager', active: true });
await ownerPut('monthly_periods', { '2026-09': { month: '2026-09', status: 'open' } });
await new Promise((resolve) => setTimeout(resolve, 150));

const full = await api.create('expenses', { date: '2026-09-02', month: '2026-09', amount: 100000, category_name: 'إنترنت', description: 'TEST full', beneficiary: 'TEST ISP', payment_method: 'cash', payment_status: 'paid' });
assert.equal(full.remaining_amount, 0);
assert.equal((await cashFor(full.id)).length, 1);

const partial = await api.create('expenses', { date: '2026-09-03', month: '2026-09', amount: 100000, paid_amount: 30000, category_name: 'إنترنت', description: 'TEST partial', beneficiary: 'TEST ISP', payment_method: 'cash', payment_status: 'partial' });
assert.equal(partial.remaining_amount, 70000);
assert.equal((await cashFor(partial.id))[0].amount, 30000);
assert.equal((await api.listDebts('all')).find((x) => x.id === `expense:${partial.id}`).remaining_amount, 70000);
const settled = await api.settleDebt({ debt_id: `expense:${partial.id}`, amount: 20000, payment_method: 'cash', date: '2026-09-10', month: '2026-09', operation_key: 'test-expense-settle' });
assert.equal(settled.amount, 20000);
assert.equal((await read(`expenses/${partial.id}`)).remaining_amount, 50000);
assert.equal((await cashFor(partial.id)).reduce((n, x) => n + Number(x.amount || 0), 0), 30000);
assert.equal((await cashFor(settled.id)).length, 1);
assert.equal((await cashFor(settled.id))[0].amount, 20000);
const beforeSettlement = await api.reportRange({ mode: 'custom', fromDate: '2026-09-01', toDate: '2026-09-05' });
const afterSettlement = await api.reportRange({ mode: 'custom', fromDate: '2026-09-01', toDate: '2026-09-30' });
assert.equal(beforeSettlement.rows.debts.find((row) => row.source_id === partial.id).remaining_amount, 70000);
assert.equal(afterSettlement.rows.debts.find((row) => row.source_id === partial.id).remaining_amount, 50000);
const retry = await api.settleDebt({ debt_id: `expense:${partial.id}`, amount: 20000, payment_method: 'cash', date: '2026-09-10', month: '2026-09', operation_key: 'test-expense-settle' });
assert.equal(retry.already_processed, true);
assert.equal((await read(`expenses/${partial.id}`)).remaining_amount, 50000);
assert.equal(await expectError(() => api.settleDebt({ debt_id: `expense:${partial.id}`, amount: 50001, payment_method: 'cash', date: '2026-09-11', month: '2026-09', operation_key: 'test-expense-overpay' }), /يتجاوز|أكبر|غير صحيح/), true);

const unpaid = await api.create('expenses', { date: '2026-09-04', month: '2026-09', amount: 80000, category_name: 'ماء', description: 'TEST unpaid', payment_method: 'transfer', payment_status: 'unpaid' });
assert.equal(unpaid.paid_amount, 0);
assert.equal(unpaid.remaining_amount, 80000);
assert.equal((await cashFor(unpaid.id)).length, 0);
assert.equal((await api.listDebts('all')).filter((x) => x.source_key === `expense:${unpaid.id}`).length, 1);
assert.equal(Object.values(await read('expenses') || {}).filter((x) => String(x.description).startsWith('TEST')).length, 3);
console.log('expense-debt-emulator: PASS');
await signOut(auth);
process.exit(0);
