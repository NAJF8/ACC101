import assert from 'node:assert/strict';
import { connectAuthEmulator, signInAnonymously, signOut } from 'firebase/auth';
import { connectDatabaseEmulator, get, ref } from 'firebase/database';
import { allPermissionKeys, hasPermission, permissionsFromFirebase, permissionsToFirebase } from '../src/services/permissions.js';

const host = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error(`Refusing non-local host: ${host}`);
const { auth, db } = await import('../src/services/firebase.js');
connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
connectDatabaseEmulator(db, host, 9000);
const rest = (path) => `http://${host}:9000/${path}.json?ns=acc-101-default-rtdb&access_token=owner`;
const ownerPatch = async (path, value) => {
  const response = await fetch(rest(path), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  assert.equal(response.ok, true, `owner PATCH ${path}`);
};
await fetch(rest(''), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: 'null' });
const signed = await signInAnonymously(auth);
await ownerPatch(`users/${signed.user.uid}`, { id: signed.user.uid, role: 'super_admin', active: true, permissions: {} });
const { api } = await import('../src/services/api.js');
const all = Object.fromEntries(allPermissionKeys.map((id) => [id, true]));
const safe = permissionsToFirebase(all);
assert.equal(safe['financial_view_revenue'], true);
assert.equal(Object.keys(safe).some((key) => /[.#$\[\]/]/.test(key)), false);
await api.authorizeUser({ name: 'Permission Test', email: 'permission.test@example.com', role: 'employee', permissions: all });
const stored = (await get(ref(db, 'authorized_users/permission_test@example_com'))).val();
assert.equal(stored.permissions.financial_view_revenue, true);
assert.equal(stored.permissions.employees_edit, true);
assert.equal(Object.keys(stored.permissions).some((key) => key.includes('.')), false);
const rows = await api.listAuthorizedUsers();
assert.equal(rows.find((row) => row.email === 'permission.test@example.com').permissions['financial.view_revenue'], true);
await api.authorizeUser({ name: 'Permission Test Edited', email: 'permission.test@example.com', role: 'employee', permissions: { 'financial.view_expenses': true } });
const edited = (await get(ref(db, 'authorized_users/permission_test@example_com'))).val();
assert.equal(edited.permissions.financial_view_expenses, true);
assert.equal(permissionsFromFirebase({ financial: { view_revenue: true } })['financial.view_revenue'], true);
assert.equal(permissionsFromFirebase({ financial_view_revenue: true })['financial.view_revenue'], true);
assert.equal(hasPermission({ user: { role: 'employee' }, permissions: ['financial.view_revenue'] }, 'financial.view_revenue'), true);
assert.equal(hasPermission({ user: { role: 'super_admin' }, permissions: [] }, 'financial.view_revenue'), true);
await signOut(auth);
console.log(JSON.stringify({
  authorized_user_create: 'PASS', authorized_user_edit: 'PASS', safe_flat_keys: 'PASS',
  legacy_nested_read: 'PASS', permission_check: 'PASS', super_admin_bypass: 'PASS',
  rules_new_shape: 'PASS', production_target_used: 'NO'
}, null, 2));
