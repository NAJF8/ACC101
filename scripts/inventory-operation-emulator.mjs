import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase, get, ref, runTransaction, update } from 'firebase/database';
import fs from 'node:fs';

const projectId = process.env.FIREBASE_PROJECT_ID || 'demo-acc-101';
const serviceSource = fs.readFileSync(new URL('../src/services/api.js', import.meta.url), 'utf8');
const consumeRecipeSource = serviceSource.slice(serviceSource.indexOf('consumeRecipe: async'), serviceSource.indexOf('recordWaste: async'));
if (consumeRecipeSource.indexOf('const [recipe, inventory, batches]') > consumeRecipeSource.indexOf('runTransaction(operationRef') || consumeRecipeSource.includes("status: 'failed'")) {
  throw new Error('consumeRecipe must prepare before claiming and must not reopen a claimed operation after a commit attempt.');
}
const app = initializeApp({ apiKey: 'demo-key', authDomain: `${projectId}.firebaseapp.com`, projectId, databaseURL: `http://127.0.0.1:9000?ns=${projectId}-default-rtdb` }, 'inventory-operation-emulator');
const auth = getAuth(app);
const db = getDatabase(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
connectDatabaseEmulator(db, '127.0.0.1', 9000);

const seed = async (path, value) => {
  const response = await fetch(`http://127.0.0.1:9000/${path}.json?ns=${projectId}-default-rtdb&access_token=owner`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value)
  });
  if (!response.ok) throw new Error(`Emulator seed failed for ${path}: ${response.status}`);
};

const credential = await signInAnonymously(auth);
const uid = credential.user.uid;
await seed('users', { [uid]: { role: 'manager', active: true } });
await seed('inventory_items', { syrup: { id: 'syrup', quantity: 100, base_unit: 'ml' } });
await seed('inventory_operations', null);
await seed('inventory_movements', null);

const operationKey = 'sale_order_101';
const operationRef = ref(db, `inventory_operations/${operationKey}`);
const claim = async () => runTransaction(operationRef, (existing) => {
  if (existing?.status === 'pending' || existing?.status === 'completed') return;
  return {
  id: operationKey, status: 'pending', source_key: 'sale:order/101', created_by: uid
  };
});
const attempts = await Promise.all([claim(), claim()]);
const committedClaims = attempts.filter((attempt) => attempt.committed);
if (committedClaims.length !== 1) throw new Error(`Expected one winning claim, received ${committedClaims.length}.`);

await update(ref(db), {
  'inventory_items/syrup/quantity': 90,
  'inventory_movements/recipe_consumption_101': {
    id: 'recipe_consumption_101', item_id: 'syrup', type: 'recipe_consumption', quantity_delta: -10,
    before_quantity: 100, after_quantity: 90, source_key: 'sale:order/101', created_by: uid
  },
  [`inventory_operations/${operationKey}/status`]: 'completed',
  [`inventory_operations/${operationKey}/movement_ids/recipe_consumption_101`]: true
});

const retry = await claim();
const [operation, item, movements] = await Promise.all([
  get(operationRef), get(ref(db, 'inventory_items/syrup')), get(ref(db, 'inventory_movements'))
]);
if (retry.committed || operation.val()?.status !== 'completed' || item.val()?.quantity !== 90 || Object.keys(movements.val() || {}).length !== 1) {
  throw new Error('Retry mutated an already-completed inventory operation.');
}
console.log('inventory-operation-emulator: PASS');
