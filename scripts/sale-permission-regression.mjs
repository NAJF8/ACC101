import { connectAuthEmulator, signInAnonymously, signOut } from 'firebase/auth';
import { connectDatabaseEmulator, get, ref, set } from 'firebase/database';

const host = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
const projectId = process.env.FIREBASE_PROJECT_ID || 'acc-101';
if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error(`Refusing non-local emulator host: ${host}`);

const { auth, db } = await import('../src/services/firebase.js');
connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
connectDatabaseEmulator(db, host, 9000);
const ownerUrl = (path) => `http://${host}:9000/${path}.json?ns=${projectId}-default-rtdb&access_token=owner`;
const ownerSet = async (path, value) => {
  const response = await fetch(ownerUrl(path), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  if (!response.ok) throw new Error(`seed failed at ${path}: ${response.status}`);
};
const ownerRead = async (path) => (await fetch(ownerUrl(path))).json();
const denied = async (operation) => { try { await operation(); return false; } catch (error) { return /PERMISSION_DENIED|permission-denied|permission denied/i.test(`${error.code} ${error.message}`); } };
const apiDenied = async (operation) => { try { await operation(); return false; } catch { return true; } };
const results = {};
const record = (name, value) => { results[name] = Boolean(value); if (!value) console.error(`FAIL: ${name}`); };

await ownerSet('', null);
await ownerSet('monthly_periods/2026-09', { month: '2026-09', status: 'open' });
await ownerSet('inventory_items/syrup', { id: 'syrup', name_ar: 'TEST syrup', quantity: 1000, base_unit: 'ml', unit: 'ml' });
await ownerSet('product_recipes/mojito', { id: 'mojito', product_id: 'mojito', items: [{ inventory_item_id: 'syrup', quantity: 20, unit: 'ml' }] });

const signInAs = async (role, permissions = {}) => {
  await signOut(auth).catch(() => null);
  const user = (await signInAnonymously(auth)).user;
  await ownerSet(`users/${user.uid}`, { id: user.uid, role, active: true, permissions });
  await new Promise((resolve) => setTimeout(resolve, 150));
  return user.uid;
};

const { api } = await import('../src/services/api.js');
const superAdminUid = await signInAs('super_admin');
const salePayload = { id: 'pos101-test-sale-001', product_id: 'mojito', product_name: 'TEST Mojito', quantity: 2, unit: 'piece', unit_price: 4000, payment_method: 'cash', date: '2026-09-12', month: '2026-09', operation_key: 'pos101:test-sale-001' };
const sale = await api.create('sales', salePayload);
const sales = await ownerRead('sales');
const cash = Object.values(await ownerRead('cash_movements') || {}).filter((row) => row.source_id === sale.id && !row.deleted);
const movement = Object.values(await ownerRead('inventory_movements') || {}).filter((row) => row.source_id === sale.id);
record('super_admin_sale_create', sale.payment_method === 'cash' && sales[sale.id]?.month === '2026-09');
record('cash_movement_create', cash.length === 1 && cash[0].type === 'IN' && cash[0].amount === 8000 && cash[0].source_key === `sale:${sale.id}`);
record('recipe_consumption', movement.length === 1 && movement[0].type === 'recipe_consumption');
record('inventory_quantity_update', Number((await ownerRead('inventory_items/syrup'))?.quantity) === 960);
record('idempotent_retry', (await api.create('sales', salePayload)).already_processed === true && Object.keys(await ownerRead('sales')).length === 1);
record('operation_key_conflict_denied', await apiDenied(() => api.create('sales', { ...salePayload, id: 'pos101-test-sale-002', quantity: 3 })));
const concurrent = await Promise.all([api.create('sales', { ...salePayload }), api.create('sales', { ...salePayload })]);
record('concurrent_retry_idempotent', concurrent.filter((row) => row.already_processed).length >= 1 && Object.keys(await ownerRead('sales')).length === 1);
record('super_admin_uid_seeded', Boolean(await ownerRead(`users/${superAdminUid}`)));

const cashierUid = await signInAs('cashier', { sales: { create: true }, cash_movements: { create: true }, inventory: { view: true } });
const cashierSale = await api.create('sales', { ...salePayload, id: 'pos101-cashier-sale-001', product_id: 'plain-cashier', product_name: 'TEST cashier', payment_method: 'card', operation_key: 'cashier-sale-permission-regression' });
record('cashier_sale_allowed_with_intended_permissions', cashierSale.payment_method === 'electronic');
const cashierRecipeSale = await api.create('sales', { ...salePayload, id: 'pos101-cashier-sale-002', payment_method: 'cash', operation_key: 'cashier-recipe-sale-permission-regression' });
const cashierRecipeMoves = Object.values(await ownerRead('inventory_movements') || {}).filter((row) => row.source_id === cashierRecipeSale.id && row.type === 'recipe_consumption');
record('cashier_recipe_sale_allowed', cashierRecipeSale.payment_method === 'cash' && cashierRecipeMoves.length === 1);
record('cashier_recipe_sale_retry_idempotent', (await api.create('sales', { ...salePayload, id: 'pos101-cashier-sale-002', payment_method: 'cash', operation_key: 'cashier-recipe-sale-permission-regression' })).already_processed === true);
record('cashier_can_read_own_sale_replay', Boolean(await api.get(`sales/${cashierRecipeSale.id}`)));
record('cashier_arbitrary_inventory_write_denied', await denied(() => set(ref(db, 'inventory_items/syrup'), { id: 'syrup', quantity: 1, name_ar: 'tampered' })));
record('cashier_settings_write_denied', await denied(() => set(ref(db, 'settings/admin'), { role: 'super_admin' })));
record('cashier_uid_seeded', Boolean(await ownerRead(`users/${cashierUid}`)));

const viewerUid = await signInAs('viewer', { sales: { view: true } });
record('viewer_sale_denied', await apiDenied(() => api.create('sales', { ...salePayload, product_id: 'viewer', operation_key: 'viewer-sale-permission-regression' })));
record('viewer_direct_sales_write_denied', await denied(() => set(ref(db, 'sales/viewer-direct'), { id: 'viewer-direct', month: '2026-09', amount: 1 })));
record('viewer_uid_seeded', Boolean(await ownerRead(`users/${viewerUid}`)));

await signOut(auth);
record('unauthenticated_sale_denied', await denied(() => set(ref(db, 'sales/unauthenticated'), { id: 'unauthenticated', month: '2026-09', amount: 1 })));

const rules = (await import('node:fs')).readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8');
record('no_broad_sales_parent_write', rules.includes('"sales":') && rules.includes('".write": "auth != null && false"'));
console.log(JSON.stringify({ emulator: true, production_target_used: 'NO', results }, null, 2));
await signOut(auth).catch(() => null);
process.exit(Object.values(results).some((value) => !value) ? 1 : 0);
