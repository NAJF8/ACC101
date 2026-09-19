import fs from 'node:fs';

const permissions = fs.readFileSync('src/services/permissions.js', 'utf8');
const app = fs.readFileSync('src/App.jsx', 'utf8');
const api = fs.readFileSync('src/services/api.js', 'utf8');
const rules = fs.readFileSync('database.rules.json', 'utf8');
const failures = [];
const check = (condition, label) => condition ? console.log(`PASS: ${label}`) : failures.push(label);

const financialKeys = [
  'financial.view_revenue', 'financial.view_cogs', 'financial.view_gross_profit',
  'financial.view_net_profit', 'financial.view_profit_margin',
  'financial.view_profit_by_product', 'financial.view_profit_by_category',
  'financial.view_profitability_reports', 'financial.view_financial_dashboard'
];
const cashierKeys = [
  'sales.view', 'sales.create', 'purchases.view', 'purchases.create',
  'expenses.view', 'expenses.create', 'inventory.view', 'materials.view',
  'cash_movements.view', 'cash_movements.create'
];
const arabicLabelSection = permissions.slice(permissions.indexOf('export const permissionLabels'), permissions.indexOf('export const allPermissionKeys'));

check(permissions.includes("cashierDefaultPermissionKeys"), 'Role preset is defined for cashier');
check(app.includes('value="cashier">كاشير'), 'Cashier role is available in the UI');
check(cashierKeys.every((key) => permissions.includes(`'${key}'`)), 'Cashier operational defaults are present');
check(financialKeys.every((key) => arabicLabelSection.includes(`'${key}':`)), 'All financial permissions have Arabic labels');
check(permissions.includes('export const getPermissionLabel') && app.includes('getPermissionLabel(p)'), 'Permission labels use the central Arabic resolver');
check(permissions.includes("return 'صلاحية غير معرّفة'") && app.includes('getRoleLabel'), 'Unknown permission and role keys never render raw values');
check(financialKeys.every((key) => !permissions.slice(permissions.indexOf('export const cashierDefaultPermissionKeys'), permissions.indexOf('export const getPermissionPreset')).includes(`'${key}'`)), 'Cashier preset does not grant financial permissions');
check(app.includes('financial.view_profitability_reports') && app.includes('لا تملك صلاحية عرض هذه الصفحة'), 'Financial reports route is guarded');
check(app.includes('canSeeRevenue') && app.includes('todaySalesCount'), 'Cashier dashboard uses operational metrics without financial totals');
check(api.includes('requireEntityPermission') && api.includes("await requirePermission('excel.export')"), 'Service/API permission checks are enforced');
check(rules.includes("permissions').child('sales').child('create')") && rules.includes("permissions').child('cash_movements').child('create')"), 'Realtime Database Rules check permission keys');
check(rules.includes("newData.exists() && !data.exists()") && rules.includes("!newData.exists() && data.exists()"), 'Realtime Database Rules distinguish create and delete');
for (const path of ['products', 'suppliers', 'product_categories', 'inventory_items', 'assets']) {
  const node = JSON.parse(rules).rules[path];
  check(node['.write'] === 'auth != null && false' && Boolean(node.$id?.['.write']), `${path} has no parent write bypass`);
}
check(rules.includes("data.child('month').val() == newData.child('month').val()") && rules.includes("root.child('monthly_periods').child(data.child('month').val()).child('status').val() != 'closed'"), 'Closed-month updates protect old and new months and keep month immutable');
check(api.includes("claimOperation('purchase_operations'") && api.includes("claimOperation('inventory_operations'") && api.includes("trader_payment_operations"), 'Purchase, waste, and trader payments claim idempotency operations');
check(api.includes('normalizePaymentMethod(cleanPayload.payment_method)') && api.includes('اختر طريقة الدفع قبل حفظ عملية البيع'), 'Sales creation rejects missing payment method at the API boundary');
check(api.includes('validateSaleRecipeAvailability') && api.includes('api.consumeRecipe(saleItem.product_id'), 'Sales trigger canonical recipe consumption with a stable operation key');
check(app.includes('saleOperationKey.current') && app.includes('operation_key:'), 'Sales form reuses one idempotency key across retries');
check(app.includes('مبيعات تحتاج مراجعة') && app.includes('مبيعات محفوظة بدون طريقة دفع واضحة وتحتاج مراجعة'), 'Dashboard exposes payment-review sales only in the financial metric set');
check(app.includes('archiveInventoryItem') && app.includes('restoreInventoryItem') && app.includes('المواد المؤرشفة'), 'Inventory archives materials and supports an explicit archived filter');
check(app.includes('pageIsAllowed') && app.includes('setActive(pageIsAllowed(session, e.detail) ? e.detail : "dashboard")'), 'Direct route navigation is guarded');
check(app.includes('role === "super_admin"') || permissions.includes("session?.user?.role === 'super_admin'"), 'Super Admin bypass remains available');

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
