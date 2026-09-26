export const permissionGroups = {
  financial: [
    'financial.view_revenue', 'financial.view_cogs', 'financial.view_gross_profit',
    'financial.view_net_profit', 'financial.view_profit_margin',
    'financial.view_profit_by_category', 'financial.view_profit_by_product',
    'financial.view_financial_dashboard', 'financial.view_profitability_reports', 'financial.view_payroll_cost'
  ],
  other_income: ['other_income.view', 'other_income.create', 'other_income.edit', 'other_income.delete'],
  purchases: ['purchases.view', 'purchases.create', 'purchases.edit', 'purchases.delete'],
  sales: ['sales.view', 'sales.create', 'sales.edit', 'sales.delete'],
  expenses: ['expenses.view', 'expenses.create', 'expenses.edit', 'expenses.delete'],
  inventory: ['inventory.view', 'inventory.adjust', 'inventory.count'],
  materials: ['materials.view', 'materials.create', 'materials.edit', 'materials.delete'],
  employees: ['employees.view', 'employees.create', 'employees.edit', 'employees.disable'],
  payroll: ['payroll.view', 'payroll.create', 'payroll.edit', 'payroll.delete', 'payroll.pay', 'payroll.add_bonus', 'payroll.add_deduction'],
  employee_debts: ['employee_debts.view', 'employee_debts.create', 'employee_debts.settle'],
  debts: ['debts.view', 'debts.create', 'debts.edit', 'debts.settle', 'debts.delete', 'debts.reports'],
  suppliers: ['suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.delete'],
  assets: ['assets.view', 'assets.create', 'assets.edit', 'assets.disable', 'assets.delete'],
  cash_movements: ['cash_movements.view', 'cash_movements.create', 'cash_movements.edit', 'cash_movements.delete', 'cash.view', 'cash.reconcile', 'cash.transfer', 'cash.owner_withdrawal', 'cash.owner_deposit', 'cash.close_month'],
  shifts: ['shifts.view', 'shifts.open', 'shifts.close', 'shifts.reconcile'],
  account_review: ['account_review.view'],
  payment_review: ['payment_review.edit'],
  traders: ['traders.view', 'traders.pay'],
  purchase_invoices: ['purchase_invoices.view', 'purchase_invoices.create', 'purchase_invoices.edit'],
  inventory_operations: ['inventory.scan', 'inventory.waste', 'inventory.stocktake', 'inventory.stocktake_approve', 'inventory.transfer'],
  recipes: ['recipes.view', 'recipes.manage'],
  budgets: ['budgets.view', 'budgets.manage'],
  forecast: ['forecast.view'],
  reports: ['dashboard.view', 'reports.view', 'reports.export'],
  excel: ['excel.import', 'excel.export', 'imports.create', 'imports.undo'],
  monthly_periods: ['monthly_periods.view', 'monthly_periods.close', 'monthly_periods.reopen'],
  settings: ['settings.view', 'settings.edit'],
  users: ['users.view', 'users.create', 'users.edit', 'users.disable', 'users.delete'],
  audit: ['audit.view', 'audit.delete'],
  products: ['products.view', 'products.create', 'products.edit', 'products.delete'],
  categories: ['categories.view', 'categories.create', 'categories.edit', 'categories.disable', 'categories.delete'],
  stock: ['stock_in.create', 'stock_out.create', 'stock_movements.view'],
  backups: ['backups.create', 'backups.restore'],
  system: ['system.reset']
  ,partners: ['partners.view', 'partners.manage']
  ,establishment: ['establishment.view', 'establishment.manage']
  ,pos: ['pos.view', 'pos.sales_view', 'pos.expenses_view', 'pos.reports_view', 'pos.reconciliation_view']
};

export const permissionGroupLabels = {
  financial: 'المالية',
  other_income: 'الإيرادات الأخرى',
  purchases: 'المشتريات',
  sales: 'المبيعات',
  expenses: 'المصروفات',
  inventory: 'المخزون',
  materials: 'المواد',
  employees: 'الموظفون',
  payroll: 'الرواتب',
  debts: 'الديون والآجل',
  suppliers: 'التجار والشركات',
  assets: 'الأصول',
  cash_movements: 'حركة الصندوق',
  traders: 'حسابات التجار', purchase_invoices: 'فواتير الشراء', inventory_operations: 'عمليات المخزون', recipes: 'الوصفات', budgets: 'الميزانيات', forecast: 'التوقعات',
  reports: 'التقارير',
  excel: 'الاستيراد والتصدير',
  settings: 'الإعدادات',
  monthly_periods: 'الأشهر المالية',
  users: 'المستخدمون والصلاحيات',
  audit: 'سجل التدقيق',
  products: 'المنتجات',
  categories: 'الأقسام',
  stock: 'حركات المخزون',
  backups: 'النسخ الاحتياطي',
  system: 'النظام'
  ,partners: 'الشركاء ورأس المال'
  ,establishment: 'تكاليف التأسيس والافتتاح'
  ,pos: 'نقاط البيع (POS)'
};

// Firebase Realtime Database does not allow . # $ [ ] / in child keys.
// Keep the human-readable permission IDs in the UI, but use this one
// canonical encoding at every Firebase write boundary.
export const permissionKey = (permission) => String(permission ?? '').replace(/[.#$\/\[\]]/g, '_');

const permissionKeyToId = () => Object.fromEntries(
  Object.values(permissionGroups).flat().map((permission) => [permissionKey(permission), permission])
);

export const permissionsToFirebase = (permissions = {}) => {
  const result = {};
  const visit = (value, prefix = '') => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    Object.entries(value).forEach(([key, enabled]) => {
      const id = prefix ? `${prefix}.${key}` : key;
      if (enabled && typeof enabled === 'object' && !Array.isArray(enabled)) visit(enabled, id);
      else if (enabled === true) result[permissionKey(id)] = true;
    });
  };
  visit(permissions);
  return result;
};

export const permissionsFromFirebase = (permissions = {}) => {
  const safeToId = permissionKeyToId();
  const result = {};
  const visit = (value, prefix = '') => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    Object.entries(value).forEach(([key, enabled]) => {
      const id = prefix ? `${prefix}.${key}` : key;
      if (enabled && typeof enabled === 'object' && !Array.isArray(enabled)) return visit(enabled, id);
      if (enabled !== true) return;
      const canonical = safeToId[key] || safeToId[permissionKey(id)] || id;
      if (allPermissionKeys.includes(canonical)) result[canonical] = true;
    });
  };
  visit(permissions);
  return result;
};

export const permissionsToRules = (permissions = {}) => {
  const safe = permissionsToFirebase(permissions);
  const nested = {};
  Object.keys(safe).forEach((safeId) => {
    const id = permissionKeyToId()[safeId] || safeId;
    const dot = id.lastIndexOf('.');
    if (dot < 1) return;
    const group = id.slice(0, dot);
    const action = id.slice(dot + 1);
    nested[group] ||= {};
    nested[group][action] = true;
  });
  return nested;
};

export const permissionLabels = {
  'dashboard.view': 'عرض لوحة التشغيل',
  'financial.view_revenue': 'عرض الإيرادات',
  'financial.view_cogs': 'عرض تكلفة البضاعة',
  'financial.view_gross_profit': 'عرض الربح الإجمالي',
  'financial.view_net_profit': 'عرض صافي المبلغ',
  'financial.view_profit_margin': 'عرض هامش الربح',
  'financial.view_profit_by_product': 'عرض الربح حسب المنتج',
  'financial.view_profit_by_category': 'عرض الربح حسب القسم',
  'financial.view_profitability_reports': 'عرض تقارير الربحية',
  'financial.view_financial_dashboard': 'عرض لوحة المؤشرات المالية',
  'financial.view_payroll_cost': 'عرض تكلفة الرواتب',
  'other_income.view': 'عرض الإيرادات الأخرى',
  'other_income.create': 'إضافة إيراد آخر',
  'other_income.edit': 'تعديل إيراد آخر',
  'other_income.delete': 'حذف إيراد آخر',
  'purchases.view': 'عرض المشتريات',
  'purchases.create': 'إضافة مشتريات',
  'purchases.edit': 'تعديل المشتريات',
  'purchases.delete': 'حذف المشتريات',
  'sales.view': 'عرض المبيعات',
  'sales.create': 'إضافة مبيعات',
  'sales.edit': 'تعديل المبيعات',
  'sales.delete': 'حذف المبيعات',
  'expenses.view': 'عرض المصروفات',
  'expenses.create': 'إضافة مصروفات',
  'expenses.edit': 'تعديل المصروفات',
  'expenses.delete': 'حذف المصروفات',
  'inventory.view': 'عرض المخزون',
  'inventory.count': 'جرد المخزون',
  'inventory.adjust': 'تعديل كمية المخزون',
  'materials.view': 'عرض المواد',
  'materials.create': 'إضافة مادة',
  'materials.edit': 'تعديل مادة',
  'materials.delete': 'تعطيل أو حذف مادة',
  'employees.view': 'عرض الموظفين',
  'employees.create': 'إضافة موظف',
  'employees.edit': 'تعديل موظف',
  'employees.disable': 'تعطيل موظف',
  'payroll.view': 'عرض الرواتب',
  'payroll.create': 'إضافة راتب',
  'payroll.edit': 'تعديل راتب',
  'payroll.delete': 'حذف كشف راتب',
  'payroll.pay': 'دفع راتب',
  'payroll.add_bonus': 'إضافة مكافأة',
  'payroll.add_deduction': 'إضافة خصم',
  'employee_debts.view': 'عرض ديون الموظفين',
  'employee_debts.create': 'تسجيل دين موظف',
  'employee_debts.settle': 'تسوية دين موظف',
  'debts.view': 'عرض دفتر الديون والآجل', 'debts.create': 'إضافة دين أو آجل', 'debts.edit': 'تعديل دين أو آجل', 'debts.settle': 'تسجيل تسوية دين', 'debts.delete': 'حذف دين أو آجل', 'debts.reports': 'تقارير الديون والآجل',
  'suppliers.view': 'عرض الموردين',
  'suppliers.create': 'إضافة مورد',
  'suppliers.edit': 'تعديل مورد',
  'suppliers.delete': 'حذف مورد',
  'assets.view': 'عرض الأصول',
  'assets.create': 'إضافة أصل',
  'assets.edit': 'تعديل أصل',
  'assets.disable': 'تعطيل أصل',
  'assets.delete': 'حذف أصل',
  'cash_movements.view': 'عرض حركة الصندوق',
  'cash_movements.create': 'إضافة حركة صندوق',
  'cash_movements.edit': 'تعديل حركة صندوق',
  'cash_movements.delete': 'حذف حركة صندوق',
  'cash.view': 'عرض الأرصدة النقدية', 'cash.reconcile': 'مطابقة الصندوق', 'cash.transfer': 'تحويل نقدي داخلي', 'cash.owner_withdrawal': 'سحب صاحب الكوفي', 'cash.owner_deposit': 'إيداع مالك', 'cash.close_month': 'إغلاق النقد الشهري',
  'shifts.view': 'عرض الورديات', 'shifts.open': 'فتح وردية', 'shifts.close': 'إغلاق وردية', 'shifts.reconcile': 'تسوية فرق الوردية', 'account_review.view': 'مراجعة الحسابات', 'payment_review.edit': 'تصحيح طريقة الدفع',
  'traders.view': 'عرض حسابات التجار', 'traders.pay': 'دفع مستحقات التجار',
  'purchase_invoices.view': 'عرض فواتير الشراء', 'purchase_invoices.create': 'إنشاء فاتورة شراء', 'purchase_invoices.edit': 'تعديل فاتورة شراء',
  'inventory.scan': 'مسح الباركود', 'inventory.waste': 'تسجيل الهدر', 'inventory.stocktake': 'إنشاء جرد', 'inventory.stocktake_approve': 'اعتماد الجرد', 'inventory.transfer': 'نقل المخزون',
  'recipes.view': 'عرض الوصفات', 'recipes.manage': 'إدارة الوصفات', 'budgets.view': 'عرض الميزانيات', 'budgets.manage': 'إدارة الميزانيات', 'forecast.view': 'عرض التوقع النقدي',
  'reports.view': 'عرض التقارير',
  'reports.export': 'تصدير التقارير',
  'excel.import': 'استيراد Excel',
  'excel.export': 'تصدير Excel',
  'imports.create': 'إنشاء دفعة استيراد',
  'imports.undo': 'التراجع عن الاستيراد',
  'settings.view': 'عرض الإعدادات',
  'settings.edit': 'تعديل الإعدادات',
  'users.view': 'عرض المستخدمين والصلاحيات',
  'users.create': 'إضافة مستخدم',
  'users.edit': 'تعديل مستخدم',
  'users.disable': 'تعطيل مستخدم',
  'users.delete': 'حذف مستخدم',
  'audit.view': 'عرض سجل التدقيق',
  'audit.delete': 'حذف من سجل التدقيق',
  'products.view': 'عرض المنتجات',
  'products.create': 'إضافة منتج',
  'products.edit': 'تعديل منتج',
  'products.delete': 'تعطيل أو حذف منتج',
  'categories.view': 'عرض الأقسام',
  'categories.create': 'إضافة قسم',
  'categories.edit': 'تعديل قسم',
  'categories.disable': 'تعطيل قسم',
  'categories.delete': 'حذف قسم',
  'stock_in.create': 'تسجيل إدخال مخزون',
  'stock_out.create': 'تسجيل إخراج مخزون',
  'stock_movements.view': 'عرض حركات المخزون',
  'backups.create': 'إنشاء نسخة احتياطية',
  'backups.restore': 'استعادة نسخة احتياطية',
  'system.reset': 'إعادة ضبط النظام',
  'partners.view': 'عرض الشركاء ورأس المال',
  'partners.manage': 'إدارة الشركاء ودفعات رأس المال',
  'establishment.view': 'عرض تكاليف التأسيس',
  'establishment.manage': 'إدارة تكاليف التأسيس والتصنيفات',
  'monthly_periods.view': 'عرض الأشهر المالية',
  'monthly_periods.close': 'إغلاق الشهر',
  'monthly_periods.reopen': 'إعادة فتح الشهر'
  ,'pos.view': 'عرض قسم POS', 'pos.sales_view': 'عرض مبيعات POS', 'pos.expenses_view': 'عرض مصاريف POS', 'pos.reports_view': 'عرض تقارير POS', 'pos.reconciliation_view': 'عرض المطابقة المالية'
};

export const roleLabels = {
  super_admin: 'سوبر أدمن',
  manager: 'مدير',
  supervisor: 'مشرف',
  cashier: 'كاشير',
  employee: 'موظف',
  viewer: 'مشاهدة فقط'
};

export const getPermissionLabel = (permissionKey) => {
  const label = permissionLabels[permissionKey];
  if (label) return label;
  console.warn('UNKNOWN_PERMISSION_LABEL', permissionKey);
  return 'صلاحية غير معرّفة';
};

export const getRoleLabel = (role) => roleLabels[role] || 'دور غير معرّف';

export const allPermissionKeys = Object.values(permissionGroups).flat();
export const cashierDefaultPermissionKeys = [
  'dashboard.view',
  'sales.view', 'sales.create',
  'purchases.view', 'purchases.create',
  'expenses.view', 'expenses.create',
  'inventory.view', 'materials.view', 'products.view', 'categories.view',
  'cash_movements.view', 'cash_movements.create'
];

export const getPermissionPreset = (role) => {
  const preset = Object.fromEntries(allPermissionKeys.map((key) => [key, false]));
  if (role === 'cashier') cashierDefaultPermissionKeys.forEach((key) => { preset[key] = true; });
  if (role === 'super_admin') allPermissionKeys.forEach((key) => { preset[key] = true; });
  return preset;
};

const permissionAliases = {
  'excel.import': 'imports.create',
  'cash_movements.view': 'cash.view',
  'cash_movements.create': 'cash.create',
  'cash_movements.edit': 'cash.edit',
  'cash_movements.delete': 'cash.delete',
  'pos.sales_view': 'pos.view', 'pos.expenses_view': 'pos.view', 'pos.reports_view': 'pos.view', 'pos.reconciliation_view': 'pos.view'
};

export const hasPermission = (session, permission) => Boolean(
  session?.user?.role === 'super_admin' ||
  session?.permissions?.includes(permission) ||
  session?.permissions?.includes(permissionKey(permission)) ||
  (permissionAliases[permission] && (session?.permissions?.includes(permissionAliases[permission]) || session?.permissions?.includes(permissionKey(permissionAliases[permission]))))
);

export const permissionForEntity = {
  purchases: { view: 'purchases.view', create: 'purchases.create', edit: 'purchases.edit', delete: 'purchases.delete' },
  sales: { view: 'sales.view', create: 'sales.create', edit: 'sales.edit', delete: 'sales.delete' },
  expenses: { view: 'expenses.view', create: 'expenses.create', edit: 'expenses.edit', delete: 'expenses.delete' },
  products: { view: 'products.view', create: 'products.create', edit: 'products.edit', delete: 'products.delete' },
  product_categories: { view: 'categories.view', create: 'categories.create', edit: 'categories.edit', delete: 'categories.delete' },
  categories: { view: 'categories.view', create: 'categories.create', edit: 'categories.edit', delete: 'categories.delete' },
  inventory_categories: { view: 'inventory.view', create: 'materials.create', edit: 'materials.edit', delete: 'materials.delete' },
  inventory_items: { view: 'inventory.view', create: 'materials.create', edit: 'materials.edit', delete: 'materials.delete' },
  inventory_movements: { view: 'stock_movements.view', create: 'inventory.adjust', edit: 'inventory.adjust', delete: 'inventory.adjust' },
  materials: { view: 'materials.view', create: 'materials.create', edit: 'materials.edit', delete: 'materials.delete' },
  suppliers: { view: 'suppliers.view', create: 'suppliers.create', edit: 'suppliers.edit', delete: 'suppliers.delete' },
  assets: { view: 'assets.view', create: 'assets.create', edit: 'assets.edit', delete: 'assets.delete' },
  payroll: { view: 'payroll.view', create: 'payroll.create', edit: 'payroll.edit', delete: 'payroll.delete' },
  payroll_adjustments: { view: 'payroll.view', create: 'payroll.edit', edit: 'payroll.edit', delete: 'payroll.edit' },
  payroll_payments: { view: 'payroll.view', create: 'payroll.pay', edit: 'payroll.pay', delete: 'payroll.pay' },
  employee_advances: { view: 'payroll.view', create: 'payroll.edit', edit: 'payroll.edit', delete: 'payroll.edit' },
  employee_debts: { view: 'employee_debts.view', create: 'employee_debts.create', edit: 'employee_debts.settle', delete: 'employee_debts.settle' },
  debts: { view: 'debts.view', create: 'debts.create', edit: 'debts.edit', delete: 'debts.delete' },
  other_income: { view: 'other_income.view', create: 'other_income.create', edit: 'other_income.edit', delete: 'other_income.delete' },
  other_income_categories: { view: 'other_income.view', create: 'other_income.edit', edit: 'other_income.edit', delete: 'other_income.edit' },
  cash_movements: { view: 'cash_movements.view', create: 'cash_movements.create', edit: 'cash_movements.edit', delete: 'cash_movements.delete' },
  cash_accounts: { view: 'cash.view', create: 'cash.transfer', edit: 'cash.transfer', delete: 'cash.transfer' },
  cash_transfers: { view: 'cash.view', create: 'cash.transfer', edit: 'cash.transfer', delete: 'cash.transfer' },
  cash_reconciliations: { view: 'cash.view', create: 'cash.reconcile', edit: 'cash.reconcile', delete: 'cash.reconcile' },
  owner_withdrawals: { view: 'cash.view', create: 'cash.owner_withdrawal', edit: 'cash.owner_withdrawal', delete: 'cash.owner_withdrawal' },
  purchase_invoices: { view: 'purchase_invoices.view', create: 'purchase_invoices.create', edit: 'purchase_invoices.edit', delete: 'purchase_invoices.edit' },
  trader_payments: { view: 'traders.view', create: 'traders.pay', edit: 'traders.pay', delete: 'traders.pay' },
  monthly_budgets: { view: 'budgets.view', create: 'budgets.manage', edit: 'budgets.manage', delete: 'budgets.manage' },
  product_recipes: { view: 'recipes.view', create: 'recipes.manage', edit: 'recipes.manage', delete: 'recipes.manage' },
  inventory_batches: { view: 'inventory.view', create: 'inventory.adjust', edit: 'inventory.adjust', delete: 'inventory.adjust' },
  inventory_waste: { view: 'inventory.view', create: 'inventory.waste', edit: 'inventory.waste', delete: 'inventory.waste' },
  stocktakes: { view: 'inventory.view', create: 'inventory.stocktake', edit: 'inventory.stocktake', delete: 'inventory.stocktake' },
  inventory_transfers: { view: 'inventory.view', create: 'inventory.transfer', edit: 'inventory.transfer', delete: 'inventory.transfer' },
  employees: { view: 'employees.view', create: 'employees.create', edit: 'employees.edit', delete: 'employees.disable' },
  authorized_users: { view: 'users.view', create: 'users.create', edit: 'users.edit', delete: 'users.disable' }
  ,partners: { view: 'partners.view', create: 'partners.manage', edit: 'partners.manage', delete: 'partners.manage' }
  ,partner_payments: { view: 'partners.view', create: 'partners.manage', edit: 'partners.manage', delete: 'partners.manage' }
  ,establishment_categories: { view: 'establishment.view', create: 'establishment.manage', edit: 'establishment.manage', delete: 'establishment.manage' }
  ,establishment_costs: { view: 'establishment.view', create: 'establishment.manage', edit: 'establishment.manage', delete: 'establishment.manage' }
};
