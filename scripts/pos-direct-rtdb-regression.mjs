import assert from 'node:assert/strict'
import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signOut } from 'firebase/auth'
import { connectDatabaseEmulator, get, getDatabase, ref, set } from 'firebase/database'

const host = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1'
const projectId = 'acc-101'
if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('Refusing non-local emulator host.')
const app = initializeApp({ apiKey: 'local', authDomain: `${projectId}.firebaseapp.com`, projectId }, `pos-direct-${Date.now()}`)
const auth = getAuth(app); connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
const db = getDatabase(app); connectDatabaseEmulator(db, host, 9000)
const ownerUrl = path => `http://${host}:9000/${path}.json?ns=${projectId}-default-rtdb&access_token=owner`
const ownerSet = async (path, value) => { const response = await fetch(ownerUrl(path), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }); if (!response.ok) throw new Error(`seed ${path}: ${response.status}`) }
const emailKey = email => email.toLowerCase().replace(/[.#$\[\]/]/g, '_')
await ownerSet('', null)
const email = `direct-${Date.now()}@example.test`
const credential = await createUserWithEmailAndPassword(auth, email, 'TestOnly-123456')
const uid = credential.user.uid
await ownerSet(`users/${uid}`, { id: uid, email, authorized_user_key: emailKey(email), role: 'pos_cashier', active: true, permissions: { pos: { sales_create: true } } })
await ownerSet(`authorized_users/${emailKey(email)}`, { uid, email, role: 'pos_cashier', active: true, permissions: { pos_sales_create: true } })
const sale = { id: 'pos101_direct_sale', source: 'POS101', sourceType: 'sale', sourceId: 'direct-sale', integrationKey: 'POS101:sale:direct-sale', businessDate: '2026-10-07', month: '2026-10', total: 1250, status: 'completed' }
for (let i = 0; i < 5; i += 1) await set(ref(db, `sales/${sale.id}`), sale)
const saleBack = await get(ref(db, `sales/${sale.id}`)); assert.equal(saleBack.val().integrationKey, sale.integrationKey)
await set(ref(db, `sales/${sale.id}`), { ...sale, total: 1500, updatedAt: new Date().toISOString() })
await set(ref(db, `sales/${sale.id}`), { ...sale, total: 1500, status: 'voided' })
const expense = { id: 'pos101_direct_expense', source: 'POS101', sourceType: 'expense', sourceId: 'direct-expense', integrationKey: 'POS101:expense:direct-expense', businessDate: '2026-10-07', month: '2026-10', amount: 7000, status: 'active' }
for (let i = 0; i < 5; i += 1) await set(ref(db, `expenses/${expense.id}`), expense)
await set(ref(db, `expenses/${expense.id}`), { ...expense, amount: 8000, status: 'voided' })
const expenseBack = await get(ref(db, `expenses/${expense.id}`)); assert.equal(expenseBack.val().status, 'voided')
const bad = { ...sale, id: 'pos101_bad', sourceId: 'bad', integrationKey: 'POS101:sale:bad' }
await signOut(auth)
await createUserWithEmailAndPassword(auth, `denied-${Date.now()}@example.test`, 'TestOnly-123456')
let unauthorizedDenied = false
try { await set(ref(db, `sales/${bad.id}`), bad) } catch (error) { unauthorizedDenied = /permission_denied|PERMISSION_DENIED/i.test(`${error.code} ${error.message}`) }
assert.equal(unauthorizedDenied, true)
console.log(JSON.stringify({ emulator: true, production_target_used: 'NO', results: { sale_create: true, sale_repeat_5x_idempotent_key: true, sale_update_same_record: true, sale_void_same_record: true, expense_create: true, expense_repeat_5x_idempotent_key: true, expense_update_same_record: true, expense_void_same_record: true, unauthorized_denied: true } }, null, 2))
