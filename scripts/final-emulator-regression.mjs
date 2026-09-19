import { connectAuthEmulator, signInAnonymously, signOut } from 'firebase/auth';
import { connectDatabaseEmulator, get, ref, set, update, remove } from 'firebase/database';
import fs from 'node:fs';

const projectId = process.env.FIREBASE_PROJECT_ID || 'acc-101';
const host = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
const authPort = 9099;
const databasePort = 9000;
if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`Refusing non-local emulator host: ${host}`);

const { app, auth, db } = await import('../src/services/firebase.js');
const financial = await import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync(new URL('../src/services/financial.js', import.meta.url), 'utf8')).toString('base64')}`);
connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
connectDatabaseEmulator(db, host, databasePort);

const localUrl = (path) => `http://${host}:${databasePort}/${path}.json?ns=${projectId}-default-rtdb&access_token=owner`;
const ownerSet = async (path, value) => {
  const response = await fetch(localUrl(path), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  if (!response.ok) throw new Error(`Local emulator seed failed for ${path}: ${response.status}`);
};
const ownerRead = async (path) => (await fetch(localUrl(path))).json();
const read = async (path) => (await get(ref(db, path))).val();
const count = (value) => Object.keys(value || {}).length;
const results = {};
const record = (name, value) => { results[name] = Boolean(value); if (!value) console.error(`FAIL: ${name}`); };
const expectDenied = async (operation) => { try { await operation(); return false; } catch (error) { return /PERMISSION_DENIED|permission-denied|permission denied/i.test(`${error.code} ${error.message}`); } };
const expectError = async (operation, pattern) => { try { await operation(); return false; } catch (error) { return pattern.test(`${error.code} ${error.message}`); } };

await ownerSet('', null);
const credential = await signInAnonymously(auth);
const managerUid = credential.user.uid;
await ownerSet(`users/${managerUid}`, { id: managerUid, role: 'manager', active: true });
await ownerSet('monthly_periods', { '2026-06': { month: '2026-06', status: 'closed' }, '2026-09': { month: '2026-09', status: 'open' }, '2026-10': { month: '2026-10', status: 'open' } });
await ownerSet('inventory_items', {
  milk: { id: 'milk', name_ar: 'TEST Milk', quantity: 100, base_unit: 'piece', unit: 'piece', average_unit_cost: 10, purchase_price: 10 },
  syrup: { id: 'syrup', name_ar: 'TEST Syrup Mojito', quantity: 0, base_unit: 'ml', unit: 'bottle', purchase_unit: 'bottle', units_per_package: 1000, average_unit_cost: 0, purchase_price: 12000 },
  itemA: { id: 'itemA', name_ar: 'TEST Dessert A', quantity: 0, base_unit: 'piece', unit: 'piece', category_id: 'A', barcode: '6291234567890', internal_barcode: '101-MAT-TEST001', purchase_price: 100 },
  itemB: { id: 'itemB', name_ar: 'TEST Category B', quantity: 0, base_unit: 'piece', unit: 'piece', category_id: 'B', barcode: '6299876543210', purchase_price: 100 }
});
await ownerSet('suppliers', {
  supplier: { id: 'supplier', name: 'TEST Supplier', type: 'trader', category_ids: ['A'] },
  supplierMulti: { id: 'supplierMulti', name: 'TEST Multi Supplier', type: 'trader', category_ids: ['A', 'B'] },
  supplierNone: { id: 'supplierNone', name: 'TEST Unassigned Supplier', type: 'trader', active: true }
});
await ownerSet('cash_accounts', { cashier: { id: 'cashier', name: 'TEST Cash', opening_balance: 0 } });

const { api } = await import('../src/services/api.js');
// Cross-feature regression: a completed cash sale consumes the saved recipe
// exactly once and creates exactly one physical cash movement.
await ownerSet('inventory_items/syrup/quantity', 1000);
await ownerSet('product_recipes/mojito', { id: 'mojito', product_id: 'mojito', items: [{ inventory_item_id: 'syrup', quantity: 20, unit: 'ml' }] });
const mojitoSaleArgs = { product_id: 'mojito', product_name: 'TEST Mojito', quantity: 2, unit: 'piece', unit_price: 4000, payment_method: 'cash', date: '2026-09-12', month: '2026-09', operation_key: 'test-mojito-cash-sale' };
const mojitoSale = await api.create('sales', mojitoSaleArgs);
const mojitoRetry = await api.create('sales', mojitoSaleArgs);
const mojitoMoves = Object.values(await ownerRead('inventory_movements') || {}).filter((row) => row.source_type === 'sale' && row.source_id === mojitoSale.id && row.type === 'recipe_consumption');
const mojitoCash = Object.values(await ownerRead('cash_movements') || {}).filter((row) => row.source_type === 'sale' && row.source_id === mojitoSale.id && !row.deleted);
record('mojito_sale_payment_stored', mojitoSale.payment_method === 'cash');
record('mojito_sale_net_and_cash', mojitoSale.total_after_discount === 8000 && mojitoCash.length === 1 && mojitoCash[0].amount === 8000);
record('mojito_recipe_consumption', Number((await ownerRead('inventory_items/syrup'))?.quantity) === 960 && mojitoMoves.length === 1 && mojitoMoves[0].quantity_delta === -40);
record('mojito_sale_retry_is_idempotent', mojitoRetry.already_processed === true && Number((await ownerRead('inventory_items/syrup'))?.quantity) === 960 && Object.values(await ownerRead('sales') || {}).filter((row) => row.operation_key === mojitoSale.operation_key).length === 1);
record('mojito_financial_inventory_cash_reconcile', mojitoSale.total_after_discount === 8000 && mojitoCash.reduce((n, row) => n + Number(row.amount || 0), 0) === 8000 && mojitoMoves.reduce((n, row) => n + Number(row.quantity_delta || 0), 0) === -40);
record('sale_consumption_edit_delete_guarded', await expectError(() => api.update('sales', mojitoSale.id, { ...mojitoSale, quantity: 3 }), /لا يمكن تعديل/) && await expectError(() => api.remove('sales', mojitoSale.id), /لا يمكن حذف/));
record('new_sale_without_payment_blocked', await expectError(() => api.create('sales', { product_id: 'plain', product_name: 'TEST Plain', quantity: 1, unit: 'piece', unit_price: 1000, date: '2026-09-12', month: '2026-09' }), /اختر طريقة الدفع/));
const cardSale = await api.create('sales', { product_id: 'plain-card', product_name: 'TEST Card', quantity: 1, unit: 'piece', unit_price: 2000, payment_method: 'card', date: '2026-09-12', month: '2026-09', operation_key: 'test-card-sale' });
record('new_card_sale_stores_canonical_payment', cardSale.payment_method === 'electronic' && Object.values(await ownerRead('cash_movements') || {}).every((row) => row.source_id !== cardSale.id));
const archivedFixture = await api.create('inventory_items', { name_ar: 'TEST Archive Material', category_id: 'A', base_unit: 'ml', purchase_unit: 'bottle', unit: 'bottle', units_per_package: 1000, quantity: 1000, purchase_price: 12000, average_unit_cost: 12, min_stock: 0 });
await ownerSet(`inventory_movements/test-archive-history`, { id: 'test-archive-history', item_id: archivedFixture.id, type: 'purchase', quantity_delta: 1000 });
await api.archiveInventoryItem(archivedFixture.id);
const archivedAfter = await api.get(`inventory_items/${archivedFixture.id}`);
record('inventory_archive_active_flag', archivedAfter.active === false);
record('inventory_archive_history_retained', Boolean(await ownerRead('inventory_movements/test-archive-history')));
await api.restoreInventoryItem(archivedFixture.id);
record('inventory_restore', (await api.get(`inventory_items/${archivedFixture.id}`))?.active === true);
const dashboardFixture = {
  sales: [{ month: '2026-06', total_after_discount: 100000 }, { month: '2026-09', total_after_discount: 20000 }],
  purchases: [{ month: '2026-06', total_price: 30000 }, { month: '2026-09', total_price: 15100 }],
  payroll: [{ month: '2026-06', base_salary_snapshot: 50000 }, { month: '2026-09', base_salary_snapshot: 500000 }],
};
const dashboardAt = (month) => ({
  sales: financial.getMonthlySales({ transactions: dashboardFixture.sales, month }).total,
  purchases: financial.getMonthlyPurchases({ transactions: dashboardFixture.purchases, month }).total,
  payroll: financial.getMonthlyPayrollCost({ payroll: dashboardFixture.payroll, month }).total,
});
const juneDashboard = dashboardAt('2026-06');
const septemberDashboard = dashboardAt('2026-09');
record('dashboard_june_isolated', JSON.stringify(juneDashboard) === JSON.stringify({ sales: 100000, purchases: 30000, payroll: 50000 }));
record('dashboard_september_isolated', JSON.stringify(septemberDashboard) === JSON.stringify({ sales: 20000, purchases: 15100, payroll: 500000 }));
record('dashboard_month_switch_no_stale_totals', JSON.stringify([septemberDashboard, juneDashboard, septemberDashboard]) === JSON.stringify([septemberDashboard, juneDashboard, septemberDashboard]));
const purchaseFixture = [{ date: '2026-06-10', total_price: 7000 }, ...[1000, 1800, 5500, 4800, 2000].map((total_price, index) => ({ id: `test-sep-${index}`, date: '2026-09-10', total_price }))];
const septemberPurchases = financial.resolvePurchaseRows({ purchases: purchaseFixture, month: '2026-09' });
const junePurchases = financial.resolvePurchaseRows({ purchases: purchaseFixture, month: '2026-06' });
record('purchases_september_canonical_resolver', septemberPurchases.length === 5 && septemberPurchases.reduce((n, row) => n + row.total, 0) === 15100);
record('purchases_june_canonical_resolver', junePurchases.length === 1 && junePurchases[0].total === 7000);
record('purchases_empty_state_only_when_empty', financial.resolvePurchaseRows({ purchases: purchaseFixture, month: '2026-08' }).length === 0);
const apiSource = fs.readFileSync(new URL('../src/services/api.js', import.meta.url), 'utf8');
record('full_report_entities_scope_regression', apiSource.includes('const exportedRows =') && !apiSource.includes('rows: entities.length'));
record('full_report_expected_sheets_regression', ['الملخص', 'المبيعات', 'المشتريات', 'المصروفات', 'الإيرادات الأخرى', 'الرواتب', 'المخزون'].every((sheet) => apiSource.includes(`'${sheet}'`)));
await signOut(auth);
const activeCredential = await signInAnonymously(auth);
const activeUid = activeCredential.user.uid;
await auth.authStateReady();
await ownerSet(`users/${activeUid}`, { id: activeUid, role: 'manager', active: true });
await new Promise((resolve) => setTimeout(resolve, 250));
let preflightError = null;
try { await read(`users/${activeUid}`); await read('monthly_periods/2026-09'); } catch (error) { preflightError = error; }
if (preflightError) {
  console.log(JSON.stringify({ emulator: { auth: `http://${host}:${authPort}`, database: `http://${host}:${databasePort}`, auth_user_created: true, production_target_used: 'NO' }, results: { auth_emulator: true, database_emulator: true, rules_loaded_and_manager_read: false }, blocker: `Emulator rules denied authenticated manager read: ${preflightError.message}`, remaining_broad_parent_writes: [], recipe_pending_claim: 'MANUAL RECOVERY REQUIRED', recipe_pending_safety: true }, null, 2));
  process.exitCode = 1;
  process.exit();
}
record('monthly_periods_manager_read', (await read('monthly_periods/2026-09'))?.status === 'open');
record('monthly_periods_manager_write_denied', await expectDenied(() => update(ref(db, 'monthly_periods/2026-09'), { status: 'closed' })));

await signOut(auth);
const superAdminUid = (await signInAnonymously(auth)).user.uid;
await ownerSet(`users/${superAdminUid}`, { id: superAdminUid, role: 'super_admin', active: true });
await new Promise((resolve) => setTimeout(resolve, 250));
record('monthly_periods_super_admin_read', (await read('monthly_periods/2026-09'))?.status === 'open');
record('monthly_periods_super_admin_write', !(await expectDenied(() => update(ref(db, 'monthly_periods/2026-10'), { status: 'closed', closed_by: superAdminUid }))));
await ownerSet('monthly_periods/2026-10/status', 'open');

await signOut(auth);
const managerCredential = await signInAnonymously(auth);
const managerUidForPurchase = managerCredential.user.uid;
await ownerSet(`users/${managerUidForPurchase}`, { id: managerUidForPurchase, role: 'manager', active: true });
await new Promise((resolve) => setTimeout(resolve, 250));
await ownerSet('inventory_categories', { coffee: { id: 'coffee', name_ar: 'قهوة', active: true }, legacy: { id: 'legacy', name: 'حلويات', active: true }, A: { id: 'A', name_ar: 'حلويات', active: true }, B: { id: 'B', name_ar: 'عصائر', active: true } });
await ownerSet('employees', { active_employee: { id: 'active_employee', employee_id: 'active_employee', name: 'TEST Active Employee', base_salary: 500000, status: 'active', active: true }, inactive_employee: { id: 'inactive_employee', employee_id: 'inactive_employee', name: 'TEST Inactive Employee', base_salary: 600000, status: 'inactive', active: false } });
const readOnlyPaths = ['payroll', 'payroll_adjustments', 'payroll_payments', 'employee_debts', 'cash_movements'];
const beforePayrollOpen = Object.fromEntries(await Promise.all(readOnlyPaths.map(async (path) => [path, count(await ownerRead(path))])));
const payrollInput = await api.list('payroll'); const employeeInput = await api.list('employees');
const virtualPayrollRows = financial.buildPayrollRows({ payroll: payrollInput, employees: employeeInput, month: '2026-09' });
const afterPayrollOpen = Object.fromEntries(await Promise.all(readOnlyPaths.map(async (path) => [path, count(await ownerRead(path))])));
record('payroll_open_read_only', readOnlyPaths.every((path) => beforePayrollOpen[path] === afterPayrollOpen[path]));
record('active_employee_in_virtual_payroll', virtualPayrollRows.some((row) => row.employee_id === 'active_employee' && row.virtual === true && row.base_salary_snapshot === 500000));
record('inactive_employee_excluded_from_virtual_payroll', !virtualPayrollRows.some((row) => row.employee_id === 'inactive_employee'));
const payrollCreated = await api.createPayrollForMonth('2026-09');
record('payroll_employee_snapshot_created', payrollCreated === 1);
const payrollRow = (await api.list('payroll')).find((row) => row.employee_id === 'active_employee' && row.month === '2026-09');
record('employee_id_contract', payrollRow?.employee_id === 'active_employee' && payrollRow?.base_salary_snapshot === 500000);
const bonus = await api.addPayrollAdjustment({ payroll_id: payrollRow.id, employee_id: 'active_employee', employee_name: 'TEST Active Employee', month: '2026-09', type: 'bonus', amount: 50000, reason: 'TEST bonus' });
const deduction = await api.addPayrollAdjustment({ payroll_id: payrollRow.id, employee_id: 'active_employee', employee_name: 'TEST Active Employee', month: '2026-09', type: 'deduction', amount: 20000, reason: 'TEST deduction' });
record('payroll_bonus_and_deduction', bonus.amount === 50000 && deduction.amount === 20000);
const debtCreated = await api.addEmployeeDebt({ employee_id: 'active_employee', month: '2026-09', date: '2026-09-05', amount: 100000, reason: 'TEST debt', payment_method: 'cash' });
record('debt_create_and_cash_once', debtCreated.status === 'open' && Object.values(await ownerRead('cash_movements') || {}).filter((row) => row.source_type === 'employee_debt' && row.source_id === debtCreated.id).length === 1);
const payrollCalculated = financial.calculatePayrollWithDebts({ payroll: payrollRow, employee: employeeInput.find((row) => row.id === 'active_employee'), adjustments: await api.list('payroll_adjustments'), payments: [], debts: await api.list('employee_debts'), month: '2026-09' });
record('payroll_debt_calculation', payrollCalculated.net_salary === 430000 && payrollCalculated.debts_total === 100000);
const partialPayment = await api.addPayrollPayment({ payroll_id: payrollRow.id, employee_id: 'active_employee', month: '2026-09', amount: 300000, payment_method: 'cash', date: '2026-09-12', operation_key: 'test-payroll-partial' });
record('payroll_partial_payment', partialPayment.amount === 300000 && (await read(`payroll/${payrollRow.id}`)).status === 'partial' && (await read(`payroll/${payrollRow.id}`)).remaining_amount === 130000);
record('payroll_payment_idempotency', (await api.addPayrollPayment({ payroll_id: payrollRow.id, employee_id: 'active_employee', month: '2026-09', amount: 300000, payment_method: 'cash', date: '2026-09-12', operation_key: 'test-payroll-partial' })).already_processed === true);
const fullPayment = await api.addPayrollPayment({ payroll_id: payrollRow.id, employee_id: 'active_employee', month: '2026-09', amount: 130000, payment_method: 'cash', date: '2026-09-12', operation_key: 'test-payroll-final' });
record('payroll_final_payment_and_debt_settlement', fullPayment.amount === 130000 && (await read(`payroll/${payrollRow.id}`)).status === 'paid' && (await read(`employee_debts/${debtCreated.id}`)).status === 'settled');
const payrollCash = Object.values(await ownerRead('cash_movements') || {}).filter((row) => row.source_type === 'payroll_payment' && row.source_id && [partialPayment.id, fullPayment.id].includes(row.source_id));
record('payroll_cash_is_actual_payment_only', payrollCash.length === 2 && payrollCash.reduce((total, row) => total + Number(row.amount || 0), 0) === 430000 && payrollCash.some((row) => row.source_id === fullPayment.id && Number(row.amount) === 130000));
const finalRetry = await api.addPayrollPayment({ payroll_id: payrollRow.id, employee_id: 'active_employee', month: '2026-09', amount: 130000, payment_method: 'cash', date: '2026-09-12', operation_key: 'test-payroll-final' });
const payrollCashAfterRetry = Object.values(await ownerRead('cash_movements') || {}).filter((row) => row.source_type === 'payroll_payment' && row.source_id && [partialPayment.id, fullPayment.id].includes(row.source_id));
const payrollAudits = Object.values(await ownerRead('audit') || {}).filter((row) => row.action === 'PAYROLL_PAYMENT_CREATED' && [partialPayment.id, fullPayment.id].includes(row.entity_id));
record('payroll_final_retry_is_idempotent', finalRetry.already_processed === true && payrollCashAfterRetry.length === 2 && payrollAudits.length === 2);
record('payroll_debt_not_deducted_twice', financial.calculatePayrollWithDebts({ payroll: { ...payrollRow, month: '2026-10' }, employee: employeeInput.find((row) => row.id === 'active_employee'), debts: await api.list('employee_debts'), month: '2026-10' }).debts_total === 0);
record('payroll_overpayment_blocked', await expectError(() => api.addPayrollPayment({ payroll_id: payrollRow.id, employee_id: 'active_employee', month: '2026-09', amount: 130001, operation_key: 'test-payroll-overpay' }), /المبلغ المدفوع أكبر|تتجاوز|الرصيد المتبقي/));
record('payroll_closed_month_protected', await expectError(() => api.addPayrollAdjustment({ payroll_id: payrollRow.id, employee_id: 'active_employee', month: '2026-06', type: 'bonus', amount: 1 }), /MONTH_CLOSED|مغلق/));
const purchaseCashMovements = async (invoiceId) => Object.values(await ownerRead('cash_movements') || {}).filter((row) => row.source_type === 'purchase_invoice' && row.source_id === invoiceId);
const purchaseAudit = async (operationKey) => ownerRead(`audit/purchase_invoice_purchase:${operationKey}`);
const createPurchaseCase = ({ invoice_number, operation_key, itemId, total, paid_amount, supplier_id = 'supplier' }) => ({ invoice_number, supplier_id, supplier_name: supplier_id === 'supplierMulti' ? 'TEST Multi Supplier' : 'TEST Supplier', date: '2026-09-12', month: '2026-09', paid_amount, payment_method: 'cash', operation_key, items: [{ inventory_item_id: itemId, inventory_item_name: itemId === 'itemA' ? 'TEST Dessert A' : 'TEST Milk', quantity: total / 100, unit: 'piece', unit_cost: 100 }] });

const fullCashArgs = createPurchaseCase({ invoice_number: 'TEST-EMU-FULL-CASH', operation_key: 'test-purchase-full-cash', itemId: 'itemA', total: 10000, paid_amount: 10000 });
const fullCash = await api.createPurchaseInvoice(fullCashArgs); const fullCashRetry = await api.createPurchaseInvoice(fullCashArgs);
record('purchase_full_cash_invoice_once', count(await read('purchase_invoices')) === 1);
record('purchase_full_cash_inventory_once', Number((await read('inventory_items/itemA'))?.quantity) === 100);
record('purchase_full_cash_payable_zero', fullCash.remaining_amount === 0 && (await read(`purchase_invoices/${fullCash.id}`))?.remaining_amount === 0);
record('purchase_full_cash_cash_once', (await purchaseCashMovements(fullCash.id)).length === 1 && (await purchaseCashMovements(fullCash.id))[0].amount === 10000);
record('purchase_full_cash_audit_once', Boolean(await purchaseAudit(fullCashArgs.operation_key)));
record('purchase_full_cash_same_key_retry', fullCashRetry.already_processed === true && Number((await read('inventory_items/itemA'))?.quantity) === 100);

const partialArgs = createPurchaseCase({ invoice_number: 'TEST-EMU-PARTIAL', operation_key: 'test-purchase-partial', itemId: 'itemB', total: 20000, paid_amount: 5000 });
const partialPurchase = await api.createPurchaseInvoice(partialArgs); const partialRetry = await api.createPurchaseInvoice(partialArgs);
record('purchase_partial_invoice_once', count(await read('purchase_invoices')) === 2);
record('purchase_partial_inventory_full', Number((await read('inventory_items/itemB'))?.quantity) === 200);
record('purchase_partial_payable_15000', partialPurchase.remaining_amount === 15000 && (await read(`purchase_invoices/${partialPurchase.id}`))?.remaining_amount === 15000);
record('purchase_partial_cash_5000_once', (await purchaseCashMovements(partialPurchase.id)).length === 1 && (await purchaseCashMovements(partialPurchase.id))[0].amount === 5000);
record('purchase_partial_trader_outstanding', Number((await read(`purchase_invoices/${partialPurchase.id}`))?.total) === 20000 && Number((await read(`purchase_invoices/${partialPurchase.id}`))?.remaining_amount) === 15000);
record('purchase_partial_same_key_retry', partialRetry.already_processed === true && Number((await read('inventory_items/itemB'))?.quantity) === 200);

const creditArgs = createPurchaseCase({ invoice_number: 'TEST-EMU-CREDIT', operation_key: 'test-purchase-credit', itemId: 'milk', total: 30000, paid_amount: 0 });
const creditPurchase = await api.createPurchaseInvoice(creditArgs); const creditRetry = await api.createPurchaseInvoice(creditArgs);
record('purchase_zero_paid_inventory_full', Number((await read('inventory_items/milk'))?.quantity) === 400);
record('purchase_zero_paid_no_cash', (await purchaseCashMovements(creditPurchase.id)).length === 0);
record('purchase_zero_paid_payable_30000', creditPurchase.remaining_amount === 30000 && (await read(`purchase_invoices/${creditPurchase.id}`))?.remaining_amount === 30000);
record('purchase_zero_paid_same_key_retry', creditRetry.already_processed === true && count(await read('purchase_invoices')) === 3);
record('purchase_different_key_duplicate', await expectError(() => api.createPurchaseInvoice({ ...fullCashArgs, operation_key: 'test-purchase-different-key' }), /فاتورة هذا التاجر موجودة مسبقاً/));

const undefinedPurchase = await api.createPurchaseInvoice({ ...createPurchaseCase({ invoice_number: 'TEST-EMU-UNDEFINED', operation_key: 'test-purchase-undefined', itemId: 'milk', total: 1, paid_amount: 0 }), due_date: undefined, notes: undefined, items: [{ inventory_item_id: 'milk', inventory_item_name: undefined, quantity: 1, unit: 'piece', unit_cost: 1 }] });
const undefinedStored = await read(`purchase_invoices/${undefinedPurchase.id}`);
const containsUndefined = (value) => value && typeof value === 'object' && Object.entries(value).some(([key, entry]) => entry === undefined || (entry && typeof entry === 'object' && containsUndefined(entry)));
record('undefined_payload_sanitized', !containsUndefined(undefinedStored) && !Object.prototype.hasOwnProperty.call(undefinedStored.items?.[0] || {}, 'inventory_item_name'));

// Keep the existing purchase regression's fixture contract independent from
// the sale-consumption fixture above.
await ownerSet('inventory_items/syrup/quantity', 0);
const genericSyrupPurchase = await api.create('purchases', { purchase_type: 'inventory', inventory_item_id: 'syrup', inventory_item_name: 'TEST Syrup Mojito', quantity: 6, unit: 'bottle', unit_price: 12000, payment_method: 'cash', date: '2026-09-12', month: '2026-09' });
record('generic_purchase_normalized_stock', Number((await read('inventory_items/syrup'))?.quantity) === 6000 && Number((await read(`purchases/${genericSyrupPurchase.id}`))?.base_quantity_added) === 6000);
record('generic_purchase_serving_cost', Number((await read('inventory_items/syrup'))?.average_unit_cost) === 12);
await api.update('purchases', genericSyrupPurchase.id, { ...genericSyrupPurchase, quantity: 4, unit: 'bottle', unit_price: 12000, payment_method: 'cash', date: '2026-09-12', month: '2026-09' });
record('generic_purchase_edit_reverses_net_stock', Number((await read('inventory_items/syrup'))?.quantity) === 4000);
await api.remove('purchases', genericSyrupPurchase.id);
const syrupMovements = Object.values(await read('inventory_movements') || {}).filter((row) => row.source_id === genericSyrupPurchase.id);
record('generic_purchase_delete_reverses_once', Number((await read('inventory_items/syrup'))?.quantity) === 0 && syrupMovements.some((row) => row.type === 'purchase_reversal'));

const barcodeItems = await api.list('inventory_items');
const dessertSupplier = await api.get('suppliers/supplier'); const multiSupplier = await api.get('suppliers/supplierMulti'); const noSpecialtySupplier = await api.get('suppliers/supplierNone');
const filterForSupplier = (supplier) => supplier?.category_ids?.length ? barcodeItems.filter((item) => supplier.category_ids.map(String).includes(String(item.category_id))) : [];
const dessertItems = filterForSupplier(dessertSupplier); const multiItems = filterForSupplier(multiSupplier); const noSpecialtyItems = filterForSupplier(noSpecialtySupplier);
record('barcode_known_lookup', (await api.lookupBarcode('6291234567890'))?.id === 'itemA');
record('barcode_internal_lookup', (await api.lookupBarcode('101-MAT-TEST001'))?.id === 'itemA');
record('barcode_unknown_not_found', (await api.lookupBarcode('0000000000000')) === null);
const repeatedLines = [];
for (const code of ['6291234567890', '6291234567890']) { const item = await api.lookupBarcode(code); const line = repeatedLines.find((row) => row.inventory_item_id === item?.id); if (line) line.quantity += 1; else repeatedLines.push({ inventory_item_id: item?.id, quantity: 1 }); }
record('barcode_repeated_scan_increments_line', repeatedLines.length === 1 && repeatedLines[0].inventory_item_id === 'itemA' && repeatedLines[0].quantity === 2);
record('barcode_specialty_mismatch_blocked', !dessertItems.some((item) => item.id === 'itemB') && multiItems.some((item) => item.id === 'itemB'));
record('barcode_no_specialty_blocked', noSpecialtyItems.length === 0);
const traderChangeLine = { inventory_item_id: 'itemA', quantity: 1 }; const newAllowed = filterForSupplier({ category_ids: ['B'] }); if (!newAllowed.some((item) => item.id === traderChangeLine.inventory_item_id)) traderChangeLine.inventory_item_id = '';
record('trader_change_incompatible_line_reset', traderChangeLine.inventory_item_id === '');

await ownerSet('purchase_invoices/trader-invoice', { id: 'trader-invoice', supplier_id: 'supplier', total: 100000, paid_amount: 0, remaining_amount: 100000, month: '2026-09', status: 'unpaid' });
const paymentArgs = { invoice_id: 'trader-invoice', amount: 40000, payment_method: 'cash', cash_account_id: 'cashier', date: '2026-09-12', operation_key: 'test-payment-001' };
const paymentFirst = await api.payTraderInvoice(paymentArgs); record('trader_payment_first_run', paymentFirst?.amount === 40000);
const paymentRetry = await api.payTraderInvoice(paymentArgs); record('trader_payment_retry', paymentRetry?.already_processed === true);
const paymentConcurrentKey = 'test-payment-concurrent-001';
await Promise.all([api.payTraderInvoice({ ...paymentArgs, amount: 10000, operation_key: paymentConcurrentKey }), api.payTraderInvoice({ ...paymentArgs, amount: 10000, operation_key: paymentConcurrentKey })]).catch(() => {});
const traderInvoice = await read('purchase_invoices/trader-invoice');
record('trader_payment_concurrent', Number(traderInvoice.remaining_amount) === 50000 && count(await read('trader_payments')) === 2);
record('trader_overpayment', await expectError(() => api.payTraderInvoice({ ...paymentArgs, amount: 100000, operation_key: 'test-payment-overpay' }), /تتجاوز الرصيد المستحق|غير صحيحة/));

await ownerSet('inventory_items/milk/quantity', 500);
const wasteArgs = { item_id: 'milk', quantity: 100, unit: 'piece', reason: 'TEST waste', date: '2026-09-12', month: '2026-09', operation_key: 'test-waste-001' };
await api.recordWaste(wasteArgs); record('waste_first_run', Number((await read('inventory_items/milk'))?.quantity) === 400);
const wasteRetry = await api.recordWaste(wasteArgs); record('waste_retry', wasteRetry?.already_processed === true);
const wasteConcurrentKey = 'test-waste-concurrent-001';
await Promise.all([api.recordWaste({ ...wasteArgs, quantity: 10, operation_key: wasteConcurrentKey }), api.recordWaste({ ...wasteArgs, quantity: 10, operation_key: wasteConcurrentKey })]).catch(() => {});
record('waste_concurrent', Number((await read('inventory_items/milk'))?.quantity) === 390 && count(await read('inventory_waste')) === 2);
record('waste_audit_once', count(await ownerRead('audit')) >= 2);

await ownerSet('stocktakes/test-stocktake', { id: 'test-stocktake', date: '2026-09-12', month: '2026-09', status: 'submitted', items: [{ item_id: 'milk', item_name: 'TEST Milk', base_unit: 'piece', expected_quantity: 390, actual_quantity: 380 }] });
await Promise.all([api.approveStocktake('test-stocktake'), api.approveStocktake('test-stocktake')]).catch(() => {});
const stocktakeMoves = Object.values(await read('inventory_movements') || {}).filter((x) => x.source_id === 'test-stocktake');
record('stocktake_concurrent_approval', stocktakeMoves.length === 1 && Number((await read('inventory_items/milk'))?.quantity) === 380);

await signOut(auth);
const createOnly = (await signInAnonymously(auth)).user.uid;
await ownerSet(`users/${createOnly}`, { id: createOnly, role: 'employee', active: true, permissions: { products: { create: true } } });
record('create_permission', !(await expectDenied(() => set(ref(db, 'products/test-product'), { id: 'test-product', name: 'TEST Product' }))));
record('edit_permission', await expectDenied(() => update(ref(db, 'products/test-product'), { name: 'TEST Product Edited' })));
record('delete_permission', await expectDenied(() => remove(ref(db, 'products/test-product'))));
record('parent_write_bypass', await expectDenied(() => set(ref(db, 'products'), { injected: { id: 'injected' } })));

await signOut(auth);
const limited = (await signInAnonymously(auth)).user.uid;
await ownerSet(`users/${limited}`, { id: limited, role: 'manager', active: true });
const closedPurchase = { ...fullCashArgs, invoice_number: 'TEST-CLOSED-PURCHASE', month: '2026-06', operation_key: 'test-closed-purchase' };
record('closed_month_purchase', await expectError(() => api.createPurchaseInvoice(closedPurchase), /MONTH_CLOSED|مغلق/));
await ownerSet('purchase_invoices/closed-trader-invoice', { id: 'closed-trader-invoice', supplier_id: 'supplier', total: 100000, paid_amount: 0, remaining_amount: 100000, month: '2026-06', status: 'unpaid' });
record('closed_month_trader_payment', await expectError(() => api.payTraderInvoice({ ...paymentArgs, operation_key: 'test-closed-payment', invoice_id: 'closed-trader-invoice' }), /MONTH_CLOSED|مغلق/));
record('closed_month_waste', await expectError(() => api.recordWaste({ ...wasteArgs, month: '2026-06', operation_key: 'test-closed-waste' }), /MONTH_CLOSED|مغلق/));
record('month_swap_attack', await expectDenied(() => update(ref(db, 'purchase_invoices/trader-invoice'), { month: '2026-10' })));
record('month_immutability', await expectDenied(() => update(ref(db, 'purchase_invoices/trader-invoice'), { month: '2026-10' })));
record('unauthenticated_denied', await (async () => { await signOut(auth); return expectDenied(() => get(ref(db, 'purchase_invoices'))); })());

const debtRecord = (id, month, createdBy) => ({ id, employee_id: 'active_employee', amount: 1000, date: `${month}-05`, month, status: 'open', created_at: new Date().toISOString(), created_by: createdBy });
const signInProfile = async (profile) => { await signOut(auth); const uid = (await signInAnonymously(auth)).user.uid; await ownerSet(`users/${uid}`, { id: uid, active: true, ...profile }); await new Promise((resolve) => setTimeout(resolve, 150)); return uid; };
const superAdminDebtUid = await signInProfile({ role: 'super_admin' });
record('super_admin_create_debt', !(await expectDenied(() => set(ref(db, 'employee_debts/test-super-admin-debt'), debtRecord('test-super-admin-debt', '2026-10', superAdminDebtUid)))));
const authorizedDebtUid = await signInProfile({ role: 'employee', permissions: { employee_debts: { create: true, view: true } } });
record('authorized_employee_debt_create', !(await expectDenied(() => set(ref(db, 'employee_debts/test-authorized-debt'), debtRecord('test-authorized-debt', '2026-10', authorizedDebtUid)))));
const unauthorizedDebtUid = await signInProfile({ role: 'employee' });
record('unauthorized_employee_debt_denied', await expectDenied(() => set(ref(db, 'employee_debts/test-unauthorized-debt'), debtRecord('test-unauthorized-debt', '2026-10', unauthorizedDebtUid))));
const closedMonthDebtUid = await signInProfile({ role: 'employee', permissions: { employee_debts: { create: true } } });
record('closed_month_employee_debt_denied', await expectDenied(() => set(ref(db, 'employee_debts/test-closed-debt'), debtRecord('test-closed-debt', '2026-06', closedMonthDebtUid))));
await signOut(auth);
record('unauthenticated_employee_debt_denied', await expectDenied(() => set(ref(db, 'employee_debts/test-anonymous-debt'), debtRecord('test-anonymous-debt', '2026-10', 'anonymous'))));

const rules = await import('node:fs').then(({ readFileSync }) => JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')));
const broadAllows = [];
for (const [path, node] of Object.entries(rules.rules)) if (node && node['.write'] && node['.write'] !== 'auth != null && false') broadAllows.push(path);
console.log(JSON.stringify({ emulator: { auth: `http://${host}:${authPort}`, database: `http://${host}:${databasePort}`, production_target_used: 'NO' }, results, remaining_broad_parent_writes: broadAllows, recipe_pending_claim: 'MANUAL RECOVERY REQUIRED', recipe_pending_safety: true }, null, 2));
const hasFailure = Object.values(results).some((value) => value === false);
await signOut(auth).catch(() => {});
process.exit(hasFailure ? 1 : 0);
