import assert from 'node:assert/strict';
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInAnonymously, signOut } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase, ref, set } from 'firebase/database';

const host = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
const projectId = 'acc-101';
if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('Refusing non-local emulator host.');
const app = initializeApp({ apiKey: 'local', authDomain: `${projectId}.firebaseapp.com`, projectId, databaseURL: `http://${host}:9000?ns=acc-101-default-rtdb` }, `functions-test-${Date.now()}`);
const auth = getAuth(app); const db = getDatabase(app);
connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true }); connectDatabaseEmulator(db, host, 9000);
const ownerUrl = path => `http://${host}:9000/${path}.json?ns=acc-101-default-rtdb&access_token=owner`;
const ownerSet = async (path, value) => { const response = await fetch(ownerUrl(path), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }); if (!response.ok) throw new Error(`seed ${path}: ${response.status}`); };
const endpoint = name => `http://${host}:5001/${projectId}/europe-west1/${name}`;
const call = async (name, data, token) => {
  const response = await fetch(endpoint(name), { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ data }) });
  const body = await response.json();
  return { response, body };
};
const errorStatus = result => result.body?.error?.status || result.body?.error?.details || result.response.status;
const results = {}; const record = (name, value) => { results[name] = Boolean(value); if (!value) console.error(`FAIL: ${name}`); };
const closeTo = (actual, expected) => Math.abs(Number(actual) - Number(expected)) < 0.000001;
const signIn = async (role, permissions) => { await signOut(auth).catch(() => null); const user = (await signInAnonymously(auth)).user; await ownerSet(`users/${user.uid}`, { id: user.uid, role, active: true, permissions }); return { user, token: await user.getIdToken() }; };
const signInPosCashier = async () => {
  await signOut(auth).catch(() => null);
  const email = `pos-cashier-${Date.now()}@example.test`;
  const user = (await createUserWithEmailAndPassword(auth, email, 'test-password-123')).user;
  const authorizedKey = email.replace(/[.#$\[\]/]/g, '_');
  const permissions = { pos: { sales_create: true } };
  await ownerSet(`users/${user.uid}`, { id: user.uid, role: 'pos_cashier', active: true, permissions });
  await ownerSet(`authorized_users/${authorizedKey}`, { uid: user.uid, email, role: 'pos_cashier', active: true, permissions: { pos_sales_create: true } });
  return { user, token: await user.getIdToken() };
};

await ownerSet('', null);
await ownerSet('monthly_periods/2026-09', { month: '2026-09', status: 'open' });
await ownerSet('monthly_periods/2026-10', { month: '2026-10', status: 'open' });
await ownerSet('suppliers/supplier', { id: 'supplier', name: 'اختبار مورد', active: true });
await ownerSet('inventory_items/item', { id: 'item', name_ar: 'مادة اختبار', active: true, base_unit: 'piece', unit: 'piece', quantity: 10, purchase_price: 5, average_unit_cost: 5, location_quantities: { main_storage: 10 } });
await ownerSet('products/test-product', { id: 'test-product', name_ar: 'منتج اختبار', active: true, selling_price: 10000, stock_type: 'finished_product', ready_stock_quantity: 10, stock_unit: 'piece' });

const unauth = await call('createPosPurchase', { purchaseId: 'unauth', inventoryItemId: 'item', quantity: 1, unit: 'piece', unitPurchasePrice: 5, supplierId: 'supplier' });
record('unauthenticated_purchase_denied', errorStatus(unauth) === 'UNAUTHENTICATED');

const cashier = await signIn('cashier', { purchase_invoices: { create: true, view: true }, expenses: { create: true }, inventory: { view: true }, cash_movements: { view: true } });
const validPayload = { purchaseId: 'fn-valid', inventoryItemId: 'item', quantity: 2, unit: 'piece', unitPurchasePrice: 7, supplierId: 'supplier', paymentMethod: 'cash', date: '2026-09-27', notes: 'اختبار Emulator' };
const valid = await call('createPosPurchase', validPayload, cashier.token);
record('cashier_valid_purchase_pass', valid.body?.result?.ok === true && valid.body.result.already_processed === false);
const afterValid = JSON.parse((await fetch(ownerUrl('inventory_items/item')).then(response => response.text())));
record('server_calculated_quantity_and_average', Number(afterValid.quantity) === 12 && closeTo(afterValid.average_unit_cost, (10 * 5 + 14) / 12) && Number(afterValid.purchase_price) === 7);
const retry = await call('createPosPurchase', validPayload, cashier.token);
record('exact_purchase_retry_idempotent', retry.body?.result?.already_processed === true && Number(JSON.parse(await fetch(ownerUrl('inventory_items/item')).then(response => response.text())).quantity) === 12);
const conflict = await call('createPosPurchase', { ...validPayload, quantity: 3 }, cashier.token);
record('same_purchase_id_different_payload_conflict', errorStatus(conflict) === 'ALREADY_EXISTS');
record('quantity_zero_denied', errorStatus(await call('createPosPurchase', { ...validPayload, purchaseId: 'zero', quantity: 0 }, cashier.token)) === 'INVALID_ARGUMENT');
record('missing_item_denied', errorStatus(await call('createPosPurchase', { ...validPayload, purchaseId: 'missing', inventoryItemId: 'missing' }, cashier.token)) === 'FAILED_PRECONDITION');
const manipulated = await call('createPosPurchase', { ...validPayload, purchaseId: 'manipulated', average_unit_cost: 999999, after_quantity: 999999, cashMovementAmount: 999999 }, cashier.token);
record('client_calculated_values_ignored', manipulated.body?.result?.ok === true && Number(JSON.parse(await fetch(ownerUrl('inventory_items/item')).then(response => response.text())).average_unit_cost) !== 999999);

await ownerSet('inventory_items/concurrent', { id: 'concurrent', name_ar: 'تزامن', active: true, base_unit: 'piece', unit: 'piece', quantity: 100, purchase_price: 10, average_unit_cost: 10, location_quantities: { main_storage: 100 } });
const concurrent = await Promise.all([
  call('createPosPurchase', { purchaseId: 'concurrent-a', inventoryItemId: 'concurrent', quantity: 2, unit: 'piece', unitPurchasePrice: 20, supplierId: 'supplier', paymentMethod: 'credit', date: '2026-09-27' }, cashier.token),
  call('createPosPurchase', { purchaseId: 'concurrent-b', inventoryItemId: 'concurrent', quantity: 3, unit: 'piece', unitPurchasePrice: 30, supplierId: 'supplier', paymentMethod: 'credit', date: '2026-09-27' }, cashier.token),
]);
const concurrentItem = JSON.parse(await fetch(ownerUrl('inventory_items/concurrent')).then(response => response.text()));
record('concurrent_same_item_no_lost_update', concurrent.every(row => row.body?.result?.ok) && Number(concurrentItem.quantity) === 105 && closeTo(concurrentItem.average_unit_cost, (1000 + 40 + 90) / 105));

const expensePayload = { expenseId: 'fn-expense', amount: 1250, category: 'نقل', description: 'اختبار مصروف', paymentMethod: 'cash', businessDate: '2026-09-27' };
const expense = await call('createPosExpense', expensePayload, cashier.token);
const expenseRetry = await call('createPosExpense', expensePayload, cashier.token);
record('expense_valid_and_idempotent', expense.body?.result?.ok === true && expenseRetry.body?.result?.already_processed === true);
record('arbitrary_cash_movement_denied', (await set(ref(db, 'cash_movements/frontend-arbitrary'), { id: 'frontend-arbitrary', source_channel: 'POS101', source_type: 'expense', source_id: 'fake', amount: 999999, month: '2026-09' }).then(() => false).catch(error => /PERMISSION_DENIED|permission-denied/i.test(`${error.code} ${error.message}`))));

const manager = await signIn('manager', {});
const managerPurchase = await call('createPosPurchase', { purchaseId: 'manager-purchase', inventoryItemId: 'item', quantity: 1, unit: 'piece', unitPurchasePrice: 5, supplierId: 'supplier', paymentMethod: 'credit', date: '2026-09-27' }, manager.token);
record('manager_callable_purchase_not_broken', managerPurchase.body?.result?.ok === true);
const viewer = await signIn('viewer', {});
record('viewer_purchase_denied', errorStatus(await call('createPosPurchase', { ...validPayload, purchaseId: 'viewer' }, viewer.token)) === 'PERMISSION_DENIED');

const posCashier = await signInPosCashier();
const salePayload = {
  saleId: 'test-sale-001', operationKey: 'pos101:test-sale-001', orderNumber: '1001',
  businessDate: '2026-10-01', createdAt: '2026-10-03T01:30:00.000Z', updatedAt: '2026-10-03T01:30:00.000Z',
  cashierId: posCashier.user.uid, cashierName: 'كاشير اختبار', shiftId: 'shift-test', deviceId: 'device-test', orderType: 'dine-in',
  status: 'completed', paymentMethod: 'cash', subtotal: 10000, discountAmount: 0, total: 10000,
  items: [{ productId: 'test-product', quantity: 1, unitPrice: 10000 }],
};
const firstSale = await call('createPosSale', salePayload, posCashier.token);
const repeatSales = await Promise.all(Array.from({ length: 4 }, () => call('createPosSale', salePayload, posCashier.token)));
const saleAfterRepeats = JSON.parse(await fetch(ownerUrl('sales/test-sale-001')).then(response => response.text()));
const salesAfterRepeats = JSON.parse(await fetch(ownerUrl('sales')).then(response => response.text()));
record('sale_idempotency_five_sends', firstSale.body?.result?.ok === true && repeatSales.every(result => result.body?.result?.already_processed === true) && Object.keys(salesAfterRepeats || {}).length === 1);
record('sale_business_date_preserved', saleAfterRepeats.businessDate === '2026-10-01' && saleAfterRepeats.date === '2026-10-01' && saleAfterRepeats.createdAt === '2026-10-03T01:30:00.000Z');
record('sale_source_contract', saleAfterRepeats.source === 'POS101' && saleAfterRepeats.sourceType === 'sale' && saleAfterRepeats.sourceId === 'test-sale-001' && saleAfterRepeats.integrationKey === 'POS101:sale:test-sale-001' && saleAfterRepeats.syncVersion === 1);
const changedSale = await call('createPosSale', { ...salePayload, paymentMethod: 'electronic', discountAmount: 1000, discount: 1000, total: 9000, updatedAt: '2026-10-03T02:00:00.000Z' }, posCashier.token);
const saleAfterUpdate = JSON.parse(await fetch(ownerUrl('sales/test-sale-001')).then(response => response.text()));
record('sale_update_same_record', changedSale.body?.result?.updated === true && Object.keys(JSON.parse(await fetch(ownerUrl('sales')).then(response => response.text())) || {}).length === 1 && saleAfterUpdate.integrationKey === 'POS101:sale:test-sale-001' && saleAfterUpdate.payment_method === 'electronic' && Number(saleAfterUpdate.discount_amount) === 1000 && saleAfterUpdate.updatedAt === '2026-10-03T02:00:00.000Z');
const voidSale = await call('createPosSale', { ...salePayload, status: 'voided', updatedAt: '2026-10-03T03:00:00.000Z' }, posCashier.token);
const saleAfterVoid = JSON.parse(await fetch(ownerUrl('sales/test-sale-001')).then(response => response.text()));
record('sale_void_same_record', voidSale.body?.result?.updated === true && Object.keys(JSON.parse(await fetch(ownerUrl('sales')).then(response => response.text())) || {}).length === 1 && saleAfterVoid.status === 'voided' && saleAfterVoid.integrationKey === 'POS101:sale:test-sale-001');

console.log(JSON.stringify({ emulator: true, production_target_used: 'NO', results }, null, 2));
process.exit(Object.values(results).some(value => !value) ? 1 : 0);
