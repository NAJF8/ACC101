import assert from 'node:assert/strict';
import { connectAuthEmulator, signInAnonymously, signOut } from 'firebase/auth';
import { connectDatabaseEmulator } from 'firebase/database';

const host = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('Refusing non-local emulator host.');
const { api } = await import('../src/services/api.js');
const { auth, db } = await import('../src/services/firebase.js');
connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
connectDatabaseEmulator(db, host, 9000);
const ownerSet = async (path, value) => {
  const response = await fetch(`http://${host}:9000/${path}.json?ns=acc-101-default-rtdb&access_token=owner`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  if (!response.ok) throw new Error(`seed ${path}: ${response.status}`);
};
await ownerSet('', null);
const uid = (await signInAnonymously(auth)).user.uid;
await auth.authStateReady();
await ownerSet(`users/${uid}`, { id: uid, role: 'super_admin', active: true, name: 'Emulator Super Admin' });
await ownerSet('monthly_periods', { '2026-08': { id: '2026-08', month: '2026-08', status: 'closed', revenue: 123 }, '2026-09': { id: '2026-09', month: '2026-09', status: 'open', expenses: 456 } });
await ownerSet('sales/old-sale', { id: 'old-sale', month: '2026-09', date: '2026-09-10', amount: 100 });
await ownerSet('purchases/old-purchase', { id: 'old-purchase', month: '2026-09', date: '2026-09-04', total_price: 800000, paid_amount: 500000, payment_method: 'cash' });
await ownerSet('inventory_items/coffee', { id: 'coffee', name_ar: 'قهوة اختبار', quantity: 7, location_quantities: { main: 7 } });

const partnerA = await api.savePartner({ name: 'الشريك أ', agreed_capital: 1000000 });
const partnerB = await api.savePartner({ name: 'الشريك ب', agreed_capital: 2000000 });
const partnerC = await api.savePartner({ name: 'الشريك ج', agreed_capital: 500000 });
await api.addPartnerPayment({ partner_id: partnerA.id, amount: 300000, date: '2026-09-01', payment_method: 'cash' });
await api.addPartnerPayment({ partner_id: partnerA.id, amount: 200000, date: '2026-09-02', payment_method: 'transfer' });
await api.addPartnerPayment({ partner_id: partnerB.id, amount: 1000000, date: '2026-09-03', payment_method: 'electronic' });
const capital = await api.listPartnerCapital();
assert.equal(capital.agreed, 3500000); assert.equal(capital.paid, 1500000); assert.equal(capital.remaining, 2000000); assert.equal(capital.payments.length, 3);
assert.equal((await api.list('other_income')).length, 0);

await api.saveEstablishmentCategory({ name: 'أجهزة ومعدات' });
const category = (await api.list('establishment_categories'))[0];
await api.addEstablishmentCost({ amount: 800000, paid_amount: 500000, date: '2026-09-04', category_id: category.id, description: 'معدات اختبار مرتبطة بشراء سابق', payment_method: 'cash', linked_source_type: 'purchases', linked_source_id: 'old-purchase' });
await api.addEstablishmentCost({ amount: 300000, paid_amount: 100000, date: '2026-09-05', category_id: category.id, description: 'تكلفة افتتاح جديدة', payment_method: 'cash' });
const report = await api.establishmentReport();
assert.equal(report.total, 1100000); assert.equal(report.paid, 600000); assert.equal(report.remaining, 500000); assert.equal(report.capital.paid, 1500000);
const operatingReport = await api.reportRange({ mode: 'month', month: '2026-09' }); assert.equal(operatingReport.summary.purchases, 0);
const cash = await api.list('cash_movements');
assert.equal(cash.filter((row) => row.source_type === 'partner_capital').length, 3);
assert.equal(cash.filter((row) => row.source_type === 'establishment_cost').reduce((n, row) => n + Number(row.amount), 0), 100000);

const plan = await api.prepareSystemReset();
assert.equal(plan.counts.sales, 1); assert.equal(plan.counts.purchases, 1); assert.equal(plan.counts.partners, 3); assert.equal(plan.counts.partner_payments, 3);
const backupHash = 'emulator-verified-backup';
const reset = await api.executeSystemReset({ confirmation: 'أوافق على تصفير النظام وبدء حسابات جديدة', backupHash, backupCounts: plan.counts, includeInventory: true });
assert.equal(reset.include_inventory, true);
const verify = await api.verifySystemReset({ includeInventory: true });
assert.equal(verify.passed, true);
const inventory = await api.get('inventory_items/coffee'); assert.equal(Number(inventory.quantity), 0);
await ownerSet('sales/new-sale', { id: 'new-sale', month: '2026-09', date: '2026-09-19', amount: 250 });
assert.equal((await api.list('sales')).length, 1);
console.log(JSON.stringify({ emulator: true, production_target_used: 'NO', partner_summary: { agreed: capital.agreed, paid: capital.paid, remaining: capital.remaining }, establishment: { total: report.total, paid: report.paid, remaining: report.remaining }, reset_verified: verify.passed }, null, 2));
await signOut(auth);
process.exit(0);
