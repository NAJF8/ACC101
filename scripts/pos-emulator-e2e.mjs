import assert from 'node:assert/strict';
import { connectAuthEmulator, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { connectDatabaseEmulator } from 'firebase/database';
import { auth, db } from '../src/services/firebase.js';
import { api } from '../src/services/api.js';
import { buildCashierRows, buildPosReconciliation, calculatePosSummary, isPosRow } from '../src/services/pos.js';

const host = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error(`Refusing non-local emulator host: ${host}`);
const projectId = process.env.FIREBASE_PROJECT_ID || 'acc-101';
const date = '2026-09-26';
const month = '2026-09';
const runKey = `pos-e2e-${Date.now()}`;
const email = `${runKey}@example.com`;
const password = 'PosE2e!2026';
const localUrl = (path) => `http://${host}:9000/${path}.json?ns=${projectId}-default-rtdb&access_token=owner`;
const ownerSet = async (path, value) => {
  const response = await fetch(localUrl(path), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  if (!response.ok) throw new Error(`Emulator seed failed for ${path}: ${response.status}`);
};
const ownerRead = async (path) => (await fetch(localUrl(path))).json();
const rowsAt = async (path) => Object.values((await ownerRead(path)) || {});
const countWhere = (rows, predicate) => rows.filter(predicate).length;

connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
connectDatabaseEmulator(db, host, 9000);
const credential = await createUserWithEmailAndPassword(auth, email, password);
const uid = credential.user.uid;
await ownerSet(`users/${uid}`, {
  id: uid, email, name: 'POS E2E Cashier', role: 'employee', active: true,
  permissions: {
    pos: { view: true, sales_view: true, expenses_view: true, reports_view: true, reconciliation_view: true },
    sales: { view: true, create: true }, expenses: { view: true, create: true },
    products: { view: true }, shifts: { view: true }, cash_movements: { view: true }, inventory: { view: true },
  },
});
await ownerSet(`monthly_periods/${month}`, { month, status: 'open' });
await ownerSet(`products/${runKey}-brownie`, { id: `${runKey}-brownie`, name_ar: 'E2E براونيز', stock_type: 'finished_product', ready_stock_quantity: 10, unit: 'piece', active: true });
await ownerSet(`products/${runKey}-sandwich`, { id: `${runKey}-sandwich`, name_ar: 'E2E ساندويتش', stock_type: 'finished_product', ready_stock_quantity: 8, unit: 'piece', active: true });
await ownerSet(`cashier_shifts/${runKey}-shift`, { id: `${runKey}-shift`, cashier_uid: uid, cashier_name: 'POS E2E Cashier', status: 'open', opened_at: `${date}T08:00:00.000Z`, month });

const salePayload = {
  sale_id: `${runKey}-sale`, operation_key: `${runKey}-sale`, source_channel: 'POS101', source_key: `${runKey}-sale-source`,
  date, month, cashier_uid: uid, cashier_name: 'POS E2E Cashier', shift_id: `${runKey}-shift`, payment_method: 'cash',
  items: [
    { product_id: `${runKey}-brownie`, product_name: 'E2E براونيز', quantity: 2, unit_price: 4000 },
    { product_id: `${runKey}-sandwich`, product_name: 'E2E ساندويتش', quantity: 1, unit_price: 7000 },
  ],
  quantity: 3, unit_price: 5000, discount_type: 'fixed', discount_value: 1000,
};
const beforeBrownie = Number((await ownerRead(`products/${runKey}-brownie`)).ready_stock_quantity);
const beforeSandwich = Number((await ownerRead(`products/${runKey}-sandwich`)).ready_stock_quantity);
const sale = await api.create('sales', salePayload);
const saleRetry = await api.create('sales', salePayload);
const afterBrownie = Number((await ownerRead(`products/${runKey}-brownie`)).ready_stock_quantity);
const afterSandwich = Number((await ownerRead(`products/${runKey}-sandwich`)).ready_stock_quantity);
const sales = await rowsAt('sales');
const cashMovementsAfterSale = await rowsAt('cash_movements');
assert.equal(sale.total_after_discount, 14000);
assert.equal(sale.source_channel, 'POS101');
assert.equal(saleRetry.already_processed, true);
assert.equal(countWhere(sales, (row) => row.source_key === salePayload.source_key), 1);
assert.equal(afterBrownie, beforeBrownie - 2);
assert.equal(afterSandwich, beforeSandwich - 1);
assert.equal(countWhere(cashMovementsAfterSale, (row) => row.source_id === sale.id && !row.deleted), 1);

const expensePayload = {
  source_channel: 'POS101', source_key: `${runKey}-expense-source`, operation_key: `${runKey}-expense-source`,
  date, month, amount: 3000, description: 'E2E POS expense', category_name: 'تشغيل POS', payment_method: 'cash',
  paid_amount: 3000, cashier_uid: uid, cashier_name: 'POS E2E Cashier', shift_id: `${runKey}-shift`,
};
const expense = await api.create('expenses', expensePayload);
const expenseRetry = await api.create('expenses', expensePayload);
const expenses = await rowsAt('expenses');
const cashMovements = await rowsAt('cash_movements');
assert.equal(expenseRetry.already_processed, true);
assert.equal(countWhere(expenses, (row) => row.source_key === expensePayload.source_key), 1);
assert.equal(countWhere(cashMovements, (row) => row.source_id === expense.id && !row.deleted), 1);

const negativeSaleKey = `${runKey}-negative`;
const salesBeforeNegative = (await rowsAt('sales')).length;
const movementsBeforeNegative = (await rowsAt('finished_product_movements')).length;
await assert.rejects(() => api.create('sales', {
  sale_id: `${runKey}-negative-sale`, operation_key: negativeSaleKey, source_channel: 'POS101', source_key: negativeSaleKey,
  date, month, cashier_uid: uid, shift_id: `${runKey}-shift`, payment_method: 'cash', product_id: `${runKey}-sandwich`,
  product_name: 'E2E ساندويتش', quantity: 99, unit_price: 1000,
}), /رصيد المنتج الجاهز لا يكفي/);
assert.equal((await rowsAt('sales')).length, salesBeforeNegative);
assert.equal((await rowsAt('finished_product_movements')).length, movementsBeforeNegative);

const posData = await api.listPosData();
const posSales = posData.sales.filter(isPosRow).filter((row) => row.source_key === salePayload.source_key);
const posExpenses = posData.expenses.filter(isPosRow).filter((row) => row.source_key === expensePayload.source_key);
const summary = calculatePosSummary({ sales: posSales, expenses: posExpenses, movements: posData.movements.filter((row) => row.source_id === sale.id || row.source_id === expense.id) });
const cashier = buildCashierRows({ sales: posSales, expenses: posExpenses, shifts: posData.shifts.filter((row) => row.id === `${runKey}-shift`) })[0];
const reconciliation = buildPosReconciliation({ posSales, accSales: posSales, posExpenses, accExpenses: posExpenses });
assert.deepEqual({ salesTotal: summary.salesTotal, expensesTotal: summary.expensesTotal, net: summary.net, cashSales: summary.cashSales }, { salesTotal: 14000, expensesTotal: 3000, net: 11000, cashSales: 14000 });
assert.equal(cashier.net, 11000);
assert.equal(cashier.invoice_count, 1);
assert.equal(reconciliation.sales.status, 'MATCHED');
assert.equal(reconciliation.expenses.status, 'MATCHED');
assert.equal(buildPosReconciliation({ posSales, accSales: [], posExpenses: [], accExpenses: [] }).sales.status, 'UNMATCHED');
assert.equal(buildPosReconciliation({ posSales, accSales: [{ ...posSales[0], total_after_discount: 1 }], posExpenses: [], accExpenses: [] }).sales.status, 'DIFFERENCE');

await signOut(auth);
const limitedCredential = await createUserWithEmailAndPassword(auth, `${runKey}-limited@example.com`, password);
await ownerSet(`users/${limitedCredential.user.uid}`, { id: limitedCredential.user.uid, name: 'POS Limited', role: 'employee', active: true, permissions: { pos: { view: true } } });
const limitedPosData = await api.listPosData();
assert.equal(limitedPosData.sales.some((row) => row.source_key === salePayload.source_key), true);
assert.equal(limitedPosData.expenses.some((row) => row.source_key === expensePayload.source_key), true);
const deniedPaths = {};
for (const entity of ['sales', 'expenses', 'cash_movements', 'cashier_shifts']) {
  try { await api.get(entity); deniedPaths[entity] = false; } catch (error) { deniedPaths[entity] = /PERMISSION_DENIED|permission-denied|permission denied/i.test(`${error.code} ${error.message}`); }
  assert.equal(deniedPaths[entity], true, `${entity} must remain closed to POS-only user`);
}
await signOut(auth);
const adminCredential = await createUserWithEmailAndPassword(auth, `${runKey}-admin@example.com`, password);
await ownerSet(`users/${adminCredential.user.uid}`, { id: adminCredential.user.uid, name: 'POS Super Admin', role: 'super_admin', active: true, permissions: {} });
const adminPosData = await api.listPosData();
assert.equal(adminPosData.sales.some((row) => row.source_key === salePayload.source_key), true);
console.log(JSON.stringify({ emulator: true, production_target_used: 'NO', runKey, uid, sale: { id: sale.id, total: sale.total_after_discount, retryAlreadyProcessed: saleRetry.already_processed, count: posSales.length, readModelUpdated: 'PASS' }, expense: { id: expense.id, amount: expense.amount, retryAlreadyProcessed: expenseRetry.already_processed, count: posExpenses.length, readModelUpdated: 'PASS' }, inventory: { before: { brownie: beforeBrownie, sandwich: beforeSandwich }, after: { brownie: afterBrownie, sandwich: afterSandwich } }, paymentTotals: { cashSales: summary.cashSales, electronicSales: summary.electronicSales, cashIn: summary.cashIn, cashOut: summary.cashOut }, cashierShift: cashier, reconciliation, negativeStockGuard: 'PASS', permissionIsolation: { posViewDashboard: 'PASS', sharedPaths: deniedPaths, superAdmin: 'PASS' } }, null, 2));
await signOut(auth);
process.exit(0);
