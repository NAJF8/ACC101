import { auth, db, ref, set, get, push, update, remove, onValue, serverTimestamp, runTransaction, signOut, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, onAuthStateChanged } from './firebase.js';
import * as XLSX from 'xlsx';
import {
  permissionGroups,
  allPermissionKeys,
  cashierDefaultPermissionKeys,
  hasPermission,
  permissionForEntity,
  permissionsToFirebase,
  permissionsFromFirebase,
  permissionsToRules
} from './permissions.js';
import { amountOf, buildCashCarryForward, buildPeriodComparison, buildAccountReview, buildEstablishmentReport, buildPartnerCapitalSummary, countCashDenominations, buildMonthCloseReview, buildPayrollRows, calculatePayroll, calculatePayrollWithDebts, calculatePayable, cashSourceKey, currentMonth, filterRecordsByDateRange, getAvailableMonths, getCashMonthSummary, getImmediateCashPurchasePaid, getMonthlyCashMovement, getMonthlyExpenses, getMonthlyLegacyWithdrawals, getMonthlyOtherIncome, getMonthlyPayrollCost, getMonthlyPayrollPaid, getMonthlyPurchases, getMonthlyProfit, getMonthlySales, getMonthlySalesBreakdown, getRecordDate, getRecordMonth, getSalesTransactionNet, isCashPayment, localBusinessDate, money, nextMonth, normalizePaymentMethod, resolvePaymentMethod, previousMonth, recordsForMonth, resolvePurchaseRows, sum } from './financial.js';
import { createDashboardRefreshScheduler } from './dashboard-realtime.js';
import { DEFAULT_LOCATION_ID, availableServings, barcodeMatch, expiryAlerts, locationBalances, locationQuantity, makeInternalCode, recipeCost, roundInventory, selectFefoBatches, toBaseQuantity, weightedAverageCost, inventoryQuantity } from './inventory.js';
import { buildSystemNotifications } from './notifications.js';
import { debtAmount, debtPaid, normalizeDebt, resolveDebts } from './debts.js';
import { buildAuditSnapshot } from './audit-center.js';
export { permissionGroups } from './permissions.js';

const withoutUndefined = (value) => {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, withoutUndefined(item)]));
};

const historicalAssetId = (historicalId) => `historical_${String(historicalId || '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
const classificationReviewState = (accountingClass) => String(accountingClass || 'review').trim() === 'review';
const historicalDestinationMap = {
  fixed_asset: 'assets',
  expense: 'expenses',
  purchase: 'purchases',
  supplies: 'expenses',
  setup_cost: 'establishment_costs',
};
const historicalSupportedClasses = new Set(Object.keys(historicalDestinationMap));
const historicalAssetPayload = ({ historical, assetId, existing, session, now, status }) => withoutUndefined({
  ...(existing || {}),
  id: assetId,
  historical_import_id: historical.id,
  source_type: 'historical_import',
  source_id: historical.id,
  import_key: historical.import_key,
  name: historical.name,
  category: historical.proposed_category || historical.category || 'بنود تحتاج مراجعة',
  asset_category_id: historical.asset_category_id || null,
  accounting_class: historical.accounting_class || 'review',
  review_required: classificationReviewState(historical.accounting_class),
  classification_review_status: classificationReviewState(historical.accounting_class) ? 'needs_review' : 'approved',
  quantity: historical.quantity ?? null,
  unit_price: historical.unit_price ?? null,
  total: Number(historical.amount || 0),
  purchase_price: Number(historical.amount || 0),
  purchase_date: historical.date || null,
  month: historical.month || null,
  accounting_month: historical.accounting_month || historical.month || null,
  month_source: historical.month_source || null,
  transaction_date: historical.transaction_date || historical.date || null,
  without_month: !historical.month,
  notes: historical.description || historical.notes || '',
  source_filename: historical.source_filename || '',
  source_sheet: historical.source_sheet || '',
  source_row: Number(historical.source_row || 0),
  import_batch_id: historical.import_batch_id || null,
  status: status || 'active',
  classification_status: status === 'active' ? 'active' : 'classified_elsewhere',
  deleted: status !== 'active',
  created_at: existing?.created_at || historical.created_at || now,
  created_by: existing?.created_by || historical.created_by || session.user.id,
  updated_at: now,
  updated_by: session.user.id,
});
const findHistoricalAsset = (assets, historical) => assets.find((asset) => asset.historical_import_id === historical.id || (historical.import_key && asset.import_key === historical.import_key));
const historicalDestinationId = (historicalId) => historicalAssetId(historicalId);
const historicalSourceFields = ({ historical, id, now, userId, status = 'active', deleted = false }) => withoutUndefined({
  id,
  historical_import_id: historical.id,
  source_type: 'historical_import',
  source_id: historical.id,
  source_key: `historical_import:${historical.id}`,
  import_key: historical.import_key,
  name: historical.name,
  description: historical.description || historical.name,
  notes: historical.notes || historical.description || '',
  amount: Number(historical.amount || 0),
  date: historical.date || null,
  month: historical.month || null,
  accounting_month: historical.accounting_month || historical.month || null,
  month_source: historical.month_source || null,
  transaction_date: historical.transaction_date || historical.date || null,
  without_month: !historical.month,
  source_filename: historical.source_filename || '',
  source_sheet: historical.source_sheet || '',
  source_row: Number(historical.source_row || 0),
  status,
  classification_status: status,
  deleted,
  created_at: now,
  created_by: userId,
  updated_at: now,
  updated_by: userId,
});
const historicalDestinationPayload = ({ historical, destinationType, id, existing, session, now }) => {
  const base = historicalSourceFields({ historical, id, now, userId: session.user.id });
  const category = historical.proposed_category || historical.category || 'مصروفات تاريخية';
  if (destinationType === 'assets') return historicalAssetPayload({ historical, assetId: id, existing, session, now, status: 'active' });
  if (destinationType === 'expenses') return withoutUndefined({ ...existing, ...base, category, category_name: category, payment_method: 'historical', paid_amount: Number(historical.amount || 0), remaining_amount: 0, payment_status: 'paid', historical_classification: true });
  if (destinationType === 'purchases') return withoutUndefined({ ...existing, ...base, purchase_type: 'historical', item_name: historical.name, inventory_item_name: historical.name, quantity: historical.quantity ?? null, unit: historical.unit || '', unit_price: historical.unit_price ?? Number(historical.amount || 0), total_after_discount: Number(historical.amount || 0), payment_method: 'historical', historical_classification: true });
  return withoutUndefined({ ...existing, ...base, date: historical.date || '', month: historical.month || '', category_name: category, paid_amount: Number(historical.amount || 0), remaining_amount: 0, payment_status: 'paid', payment_method: 'historical', historical_classification: true });
};

const normalizePurchasePayload = (payload) => {
  const data = withoutUndefined(payload);
  if (data.purchase_type === 'inventory') {
    delete data.product_id;
    delete data.product_name;
    delete data.item_id;
    delete data.item_name;
  } else if (data.purchase_type === 'product') {
    delete data.inventory_item_id;
    delete data.inventory_item_name;
    delete data.item_id;
    delete data.item_name;
  }
  return withoutUndefined(data);
};

const operationKeyFor = (prefix, suppliedKey) => `${prefix}:${String(suppliedKey || crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/[.#$\[\]/]/g, '_')}`;
const cleanSaleKey = (value) => String(value || '').replace(/[.#$\[\]/]/g, '_');
const saleFingerprint = (data) => JSON.stringify({
  items: (data.items || [{ product_id: data.product_id, quantity: data.quantity, unit_price: data.unit_price }]).map((item) => ({ product_id: item.product_id, quantity: Number(item.quantity || 0), unit_price: Number(item.unit_price || 0) })),
  subtotal: Number(data.subtotal || 0), discount: Number(data.discount_amount || 0), total: Number(data.total_after_discount || 0), payment_method: data.payment_method || ''
});
const claimOperation = async (path, key, value) => {
  const claimed = await runTransaction(ref(db, `${path}/${key}`), (existing) => existing ? undefined : value);
  return { committed: claimed.committed, operation: claimed.snapshot.val() };
};
const duplicateOperationResult = (operation, operation_key) => ({ ok: true, already_processed: true, pending: operation?.status === 'pending', operation_key, existing_id: operation?.result_id || null });

export const defaultCats = [
    { id: 1, name_ar: 'قهوة', name_en: 'Coffee', type: 'مواد أولية', icon: 'coffee', color: '#1f7a4d', sort_order: 1, active: 1 },
    { id: 2, name_ar: 'شاي', name_en: 'Tea', type: 'مواد أولية', icon: 'cup', color: '#427a39', sort_order: 2, active: 1 },
    { id: 3, name_ar: 'حليب', name_en: 'Milk', type: 'مواد أولية', icon: 'milk', color: '#9c7a47', sort_order: 3, active: 1 },
    { id: 4, name_ar: 'سيربات', name_en: 'Syrups', type: 'مواد أولية', icon: 'droplet', color: '#b97d3c', sort_order: 4, active: 1 },
    { id: 5, name_ar: 'أكواب', name_en: 'Cups', type: 'مخزون', icon: 'package', color: '#606c38', sort_order: 5, active: 1 },
    { id: 6, name_ar: 'مواد تنظيف', name_en: 'Cleaning', type: 'مصاريف تشغيلية', icon: 'spray', color: '#3a6b66', sort_order: 6, active: 1 },
    { id: 7, name_ar: 'إيجار', name_en: 'Rent', type: 'مصاريف تشغيلية', icon: 'home', color: '#7f5539', sort_order: 7, active: 1 },
    { id: 8, name_ar: 'كهرباء', name_en: 'Electricity', type: 'خدمات', icon: 'bolt', color: '#b45309', sort_order: 8, active: 1 },
    { id: 9, name_ar: 'إنترنت', name_en: 'Internet', type: 'خدمات', icon: 'wifi', color: '#386641', sort_order: 9, active: 1 },
    { id: 10, name_ar: 'ماء', name_en: 'Water', type: 'خدمات', icon: 'droplet', color: '#00CED1', sort_order: 10, active: 1 },
    { id: 11, name_ar: 'مولدة', name_en: 'Generator', type: 'خدمات', icon: 'settings', color: '#808080', sort_order: 11, active: 1 },
    { id: 12, name_ar: 'صيانة', name_en: 'Maintenance', type: 'مصاريف تشغيلية', icon: 'tool', color: '#FF6347', sort_order: 12, active: 1 },
    { id: 13, name_ar: 'تسويق', name_en: 'Marketing', type: 'تسويق', icon: 'megaphone', color: '#bc6c25', sort_order: 13, active: 1 },
    { id: 14, name_ar: 'إعلانات', name_en: 'Ads', type: 'تسويق', icon: 'megaphone', color: '#FF69B4', sort_order: 14, active: 1 },
    { id: 15, name_ar: 'نقل', name_en: 'Transport', type: 'مصاريف تشغيلية', icon: 'truck', color: '#DAA520', sort_order: 15, active: 1 },
    { id: 16, name_ar: 'رواتب', name_en: 'Payroll', type: 'رواتب', icon: 'wallet', color: '#624c33', sort_order: 16, active: 1 },
    { id: 17, name_ar: 'أخرى', name_en: 'Other', type: 'أخرى', icon: 'more', color: '#6b7280', sort_order: 17, active: 1 }
];

let currentUserProfile = null;
let authInitialized = false;
const AUTH_TIMEOUT_MS = 10000;
let authWaitPromise = null;
const authTimeoutError = () => Object.assign(new Error('تعذر التحقق من جلسة تسجيل الدخول'), { code: 'AUTH_TIMEOUT' });
const withAuthTimeout = (promise) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(authTimeoutError()), AUTH_TIMEOUT_MS))]);
const waitForAuthState = () => {
  if (authInitialized) return Promise.resolve(auth.currentUser);
  if (authWaitPromise) return authWaitPromise;
  authWaitPromise = new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      callback(value);
      authWaitPromise = null;
    };
    const timer = setTimeout(() => finish(reject, authTimeoutError()), AUTH_TIMEOUT_MS);
    unsubscribe = onAuthStateChanged(auth, (user) => {
      authInitialized = true;
      finish(resolve, user);
    }, (error) => finish(reject, error));
  });
  return authWaitPromise;
};

async function fetchUserProfile(uid) {
  const snap = await get(ref(db, `users/${uid}`));
  if (snap.exists()) {
    return { id: uid, ...snap.val() };
  }
  return null;
}

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const normalizedEmailKey = (email) => normalizeEmail(email).replace(/[.#$\[\]/]/g, '_');
const normalizeArabic = (value) => String(value || '').trim().toLowerCase().replace(/[ًٌٍَُِّْـ]/g, '').replace(/[إأآ]/g, 'ا').replace(/ى/g, 'ي').replace(/\s+/g, ' ');
const normalizeName = (value) => normalizeArabic(value);
const inventoryCategoryDefaults = ['قهوة مخفقة', 'قهوة إيلي', 'الحليب', 'العصائر', 'مشروبات ساخنة', 'مشروبات باردة', 'المنظفات', 'مياه الشرب', 'أدوات', 'مواد غذائية / مؤنة', 'حلويات', 'ساندويتشات', 'إضافات / أخرى'];
const assetCategoryDefaults = ['أجهزة القهوة', 'الكهربائيات', 'معدات المطبخ', 'الكاونترات والديكور', 'الأرضيات والإنشائيات', 'التبريد والتكييف', 'الأثاث', 'أجهزة الكاشير والحاسبات', 'تجهيزات أخرى'];
const assetCategoryKey = (value) => normalizeName(value).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80) || 'asset-category';
const validNumber = (value, label) => { const n = Number(value); if (!Number.isFinite(n) || n < 0) throw new Error(`${label} يجب أن يكون رقماً موجباً.`); return n; };
const requireEmployeeId = (employeeId, message = 'تعذر تنفيذ العملية لأن الموظف غير مربوط بملف موظف.') => {
  if (!employeeId) throw new Error(message);
  return employeeId;
};
const canManage = (session) => ['super_admin', 'manager'].includes(session?.user?.role);
const requireOtherIncomeCategoryManager = async () => {
  const session = await api.session();
  if (!canManage(session)) throw new Error('إدارة فئات الإيرادات الأخرى للمدير أو السوبر أدمن فقط.');
  return session;
};
const requirePermission = async (permission) => {
  const session = await api.session();
  if (!hasPermission(session, permission)) throw new Error('غير مصرح بهذه العملية.');
  return session;
};
const requireEntityPermission = async (entity, action) => {
  const permission = permissionForEntity[entity]?.[action];
  if (!permission) return api.session();
  return requirePermission(permission);
};
const financialEntities = new Set(['purchases', 'expenses', 'sales', 'other_income', 'legacy_payroll_costs', 'payroll', 'payroll_adjustments', 'payroll_payments', 'employee_advances', 'employee_debts', 'cash_movements']);
const requireSuperAdmin = async () => {
  const session = await api.session();
  if (session?.user?.role !== 'super_admin') throw new Error('هذه العملية للسوبر أدمن فقط.');
  return session;
};
const SYSTEM_RESET_TARGETS = [
  'sales', 'sales_operations', 'purchases', 'purchase_invoices', 'purchase_operations', 'trader_payments', 'trader_payment_operations',
  'expenses', 'other_income', 'payroll', 'payroll_adjustments', 'payroll_payments', 'employee_advances', 'employee_debts', 'debts', 'debt_payments', 'debt_settlement_operations',
  'cash_movements', 'cash_transfers', 'owner_withdrawals', 'owner_deposits', 'cashier_shifts', 'cash_month_closings', 'cash_month_openings', 'cash_carry_forwards',
  'monthly_periods', 'legacy_monthly_summaries', 'legacy_payroll_costs', 'inventory_movements', 'inventory_operations', 'inventory_batches', 'inventory_waste', 'inventory_transfers', 'stocktakes', 'stocktake_items',
  'partners', 'partner_payments', 'partner_operations', 'partner_operation_claims', 'partner_settlements', 'establishment_costs', 'establishment_categories'
];
const resetBackupCounts = (snapshot) => Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, value && typeof value === 'object' ? Object.keys(value).length : 0]));
const checkMonthOpen = async (month) => {
  if (!month || month === 'all') return true;
  const period = await api.get(`monthly_periods/${month}`);
  if (period?.status === 'closed') throw Object.assign(new Error('هذا الشهر مغلق. أعد فتح الشهر أولاً للتعديل.'), { code: 'MONTH_CLOSED' });
  return true;
};

const validateSaleRecipeAvailability = async (saleData) => {
  const itemsToSell = saleData.items || (saleData.product_id ? [{ product_id: saleData.product_id, quantity: saleData.quantity }] : []);
  if (!itemsToSell.length) return true;
  const inventory = await api.list('inventory_items');
  const byId = new Map(inventory.map((item) => [item.id, item]));
  const requiredMaterials = new Map();
  for (const saleItem of itemsToSell) {
    const recipe = await api.get(`product_recipes/${saleItem.product_id}`);
    if (!recipe?.items?.length) continue;
    for (const line of recipe.items) {
      const item = byId.get(line.inventory_item_id);
      if (!item || item.active === false) throw new Error('مادة الوصفة غير موجودة أو مؤرشفة.');
      const required = toBaseQuantity({ quantity: Number(line.quantity) * Number(saleItem.quantity), unit: line.unit || item.base_unit || item.unit, baseUnit: item.base_unit || item.unit, conversionFactor: line.conversion_factor || 1 });
      requiredMaterials.set(item.id, (requiredMaterials.get(item.id) || 0) + required);
    }
  }
  for (const [itemId, required] of requiredMaterials.entries()) {
    const item = byId.get(itemId);
    if (inventoryQuantity(item) < required) throw new Error(`المخزون لا يكفي: ${item.name_ar || item.id}`);
  }
  return true;
};
const saleConsumptionExists = async (sale = {}) => {
  const keys = [sale.id, sale.operation_key].filter(Boolean).map((key) => `sale:${key}`);
  const operations = await Promise.all(keys.map((key) => api.get(`inventory_operations/${key}`).catch(() => null)));
  return operations.some((operation) => operation?.status === 'completed');
};

const cashSourceType = (entity) => ({ purchases: 'purchase', expenses: 'expense', sales: 'sale', other_income: 'other_income' }[entity]);
const cashIsInflow = (sourceType) => sourceType === 'sale' || sourceType === 'other_income';
const isCashMethod = isCashPayment;
// A stocktake can be approved more than once from separate clients.  Keep the
// movement IDs deterministic so an acknowledgement lost after the atomic update
// can be reconciled without applying the snapshot variance a second time.
const stocktakeMovementId = (stocktakeId, itemId) => `stocktake_${String(stocktakeId)}_${String(itemId)}`.replace(/[.#$\[\]/]/g, '_');
const isInventoryPurchase = (record = {}) => record.purchase_type === 'inventory' && Boolean(record.inventory_item_id);
const inventoryPurchaseBaseQuantity = (record = {}, item = {}) => toBaseQuantity({
  quantity: Number(record.quantity || 0),
  unit: record.unit || item.unit || item.base_unit,
  baseUnit: item.base_unit || item.unit,
  conversionFactor: Number(item.units_per_package || 1),
});
const inventoryPurchaseTotal = (record = {}) => Number(record.total_after_discount ?? record.total_price ?? record.total ?? record.amount ?? 0) || 0;
const isDependentStockMovement = (movement = {}) => ['recipe_consumption', 'waste', 'stocktake_adjustment', 'transfer_out', 'OUT'].includes(movement.type);
const listCashMovementsForSync = async () => {
  const snap = await get(ref(db, 'cash_movements'));
  return snap.exists() ? Object.entries(snap.val()).map(([id, value]) => ({ id, ...value })) : [];
};
const createAutoCashMovement = async (sourceType, sourceId, data) => {
  if (!sourceType || !sourceId || !isCashPayment(data.payment_method)) return null;
  const existing = await listCashMovementsForSync().catch(() => []);
  const source_key = cashSourceKey(sourceType, sourceId);
  if (existing.some((row) => (row.source_key === source_key || (row.source_type === sourceType && row.source_id === sourceId)) && !row.deleted)) return existing.find((row) => row.source_key === source_key || (row.source_type === sourceType && row.source_id === sourceId));
  const movementRef = push(ref(db, 'cash_movements'));
  const amount = Number(data.total_after_discount ?? data.amount ?? 0);
  const item = withoutUndefined({ id: movementRef.key, type: cashIsInflow(sourceType) ? 'IN' : 'OUT', amount, date: data.date || new Date().toISOString().slice(0, 10), month: getRecordMonth(data), reason: data.reason || `تلقائي: ${sourceType}`, payment_method: 'cash', source_type: sourceType, source_id: sourceId, source_key, auto: true, created_at: new Date().toISOString(), created_by: auth.currentUser?.uid || 'system' });
  await set(movementRef, item);
  await api.logAudit('CASH_MOVEMENT_AUTO_CREATED', 'cash_movements', movementRef.key, item).catch(() => null);
  return item;
};

const expensePaymentState = (payload = {}) => {
  const total = money(payload.amount ?? payload.total);
  const explicitStatus = String(payload.payment_status || '').trim();
  const hasExplicitPayment = payload.paid_amount !== undefined || explicitStatus;
  const status = explicitStatus || (hasExplicitPayment ? (money(payload.paid_amount) >= total ? 'paid' : money(payload.paid_amount) > 0 ? 'partial' : 'unpaid') : 'legacy');
  const paid = status === 'paid' ? total : status === 'unpaid' ? 0 : Math.min(total, Math.max(0, money(payload.paid_amount)));
  return { total, paid, remaining: Math.max(0, total - paid), status };
};

const buildExpensePayable = ({ expense, userId, now }) => {
  if (expense.remaining_amount <= 0) return null;
  return withoutUndefined({
    id: `expense:${expense.id}`,
    type: 'payable',
    party_type: 'service',
    party_name: expense.party_name || expense.company_name || expense.supplier_name || expense.beneficiary || expense.category_name || 'مصروف',
    category: expense.category_name || expense.category || 'مصروفات',
    original_amount: expense.amount,
    paid_amount: expense.paid_amount,
    initial_paid_amount: expense.paid_amount,
    remaining_amount: expense.remaining_amount,
    status: expense.remaining_amount === 0 ? 'paid' : expense.paid_amount > 0 ? 'partial' : 'unpaid',
    debt_date: expense.date,
    due_date: expense.due_date || '',
    month: expense.month,
    source_type: 'expense',
    source_id: expense.id,
    source_key: `expense:${expense.id}`,
    notes: expense.notes || expense.description || '',
    created_at: now,
    created_by: userId,
    updated_at: now,
    updated_by: userId
  });
};

export const api = {
  normalizeName,
  ensureInventoryCategories: async () => {
    const s = await api.session(); if (!canManage(s)) throw new Error('غير مصرح بإضافة أقسام المخزون.');
    const existing = await api.list('inventory_categories'); const keys = new Set(existing.map(x => normalizeName(x.name_ar || x.nameAr || x.name)));
    const updates = {};
    inventoryCategoryDefaults.forEach((name, index) => { const key = normalizeName(name); if (!keys.has(key)) { const id = `inv-${index + 1}`; updates[`inventory_categories/${id}`] = { id, name_ar: name, name_en: name, active: true, sort_order: index + 1, source: 'default' }; } });
    if (Object.keys(updates).length) await update(ref(db), updates);
    return api.list('inventory_categories');
  },
  seedMenuData: async (productsList) => {
    const s = await api.session();
    if (s?.user?.role !== 'super_admin' && s?.user?.role !== 'manager') throw new Error('Unauthorized');

    const catMap = {
      'قهوة مختصة': { id: 'specialty-coffee', nameEn: 'Specialty Coffee', sortOrder: 1, icon: 'coffee' },
      'قهوة ساخنة': { id: 'hot-coffee', nameEn: 'Hot Coffee', sortOrder: 2, icon: 'coffee' },
      'مشروبات باردة': { id: 'cold-drinks', nameEn: 'Cold Drinks', sortOrder: 3, icon: 'coffee' },
      'مشروبات 101': { id: '101-drinks', nameEn: '101 Drinks', sortOrder: 4, icon: 'coffee' },
      'حلويات': { id: 'desserts', nameEn: 'Desserts', sortOrder: 5, icon: 'coffee' },
      'ساندويتشات': { id: 'sandwiches', nameEn: 'Sandwiches', sortOrder: 6, icon: 'coffee' },
      'إضافات/أخرى': { id: 'extras', nameEn: 'Extras / Others', sortOrder: 7, icon: 'coffee' }
    };

    const updates = {};
    for (const [ar, info] of Object.entries(catMap)) {
      updates['categories/' + info.id] = {
        id: info.id,
        nameAr: ar,
        nameEn: info.nameEn,
        active: true,
        sortOrder: info.sortOrder,
        icon: info.icon
      };
    }

    let prodCount = 0;
    productsList.forEach((p, idx) => {
      const catInfo = catMap[p.category];
      if (!catInfo) return;
      const priceNum = p.price ? Number(p.price) : null;
      let productId = p.nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      if (!productId) productId = 'prod-' + idx;
      updates['products/' + productId] = {
        id: productId,
        categoryId: catInfo.id,
        nameAr: p.nameAr,
        nameEn: p.nameEn,
        description: p.description,
        sellingPrice: priceNum,
        priceStatus: priceNum === null ? 'not_set' : 'set',
        active: true,
        sortOrder: ++prodCount
      };
    });

    await update(ref(db), updates);

    const seedLogRef = push(ref(db, 'imports'));
    await set(seedLogRef, {
      source: '101_Coffee_House_Menu.xlsx',
      categoriesImported: 7,
      productsImported: prodCount,
      importedBy: s.user.id,
      importedAt: serverTimestamp(),
      type: 'SEED_MENU_DATA'
    });

    if (api.logAudit) {
      await api.logAudit('SEED_MENU_DATA', 'imports', seedLogRef.key, { categories: 7, products: prodCount });
    }
  },
  authorizeUser: async (payload) => {
    const s = await api.session(); if (s?.user?.role !== 'super_admin') throw new Error('هذه العملية للسوبر أدمن فقط.');
    const email = normalizeEmail(payload.email); if (!email || !email.includes('@')) throw new Error('أدخل بريداً إلكترونياً صحيحاً.');
    const data = withoutUndefined({ email, name: payload.name || '', phone: payload.phone || '', address: payload.address || '', job_title: payload.job_title || '', department: payload.department || '', hire_date: payload.hire_date || '', notes: payload.notes || '', role: payload.role || 'employee', base_salary: payload.base_salary != null && payload.base_salary !== '' ? Number(payload.base_salary) : undefined, permissions: permissionsToFirebase(payload.permissions || {}), active: payload.active !== false, created_at: new Date().toISOString(), created_by: s.user.id });
    const key = normalizedEmailKey(email); const previous = await api.get(`employees/${key}`).catch(() => null);
    // authorized_users is the canonical flat safe-key representation and is
    // never written with dotted IDs. Existing users/{uid} profiles are kept
    // separate because that node is keyed by Firebase Auth UID.
    await update(ref(db), { [`authorized_users/${key}`]: data, [`employees/${key}`]: { id: key, employee_id: key, ...data } });
    await api.logAudit('USER_AUTHORIZE', 'authorized_users', key, data);
    if (previous?.base_salary !== data.base_salary) await api.logAudit('EMPLOYEE_BASE_SALARY_CHANGED', 'employees', key, { employee_id: key, before: previous?.base_salary ?? null, after: data.base_salary ?? null });
    return data;
  },
  saveSettings: async (section, payload) => {
    const s = await api.session(); if (!canManage(s)) throw new Error('غير مصرح بتعديل الإعدادات.');
    await update(ref(db, `settings/${section}`), { ...payload, updated_at: new Date().toISOString(), updated_by: s.user.id }); await api.logAudit('SETTINGS_UPDATE', 'settings', section, payload); return true;
  },
  listPartnerCapital: async () => {
    await requireSuperAdmin();
    const [partners, payments, operations, settlements] = await Promise.all([api.list('partners'), api.list('partner_payments'), api.list('partner_operations').catch(() => []), api.list('partner_settlements').catch(() => [])]);
    const activeOperations = operations.filter((row) => !row.deleted);
    const rows = partners.filter((row) => !row.deleted).map((partner) => {
      const capitalPayments = payments.filter((row) => !row.deleted && row.partner_id === partner.id).reduce((n, row) => n + Number(row.amount || 0), 0);
      const capitalOperations = activeOperations.filter((row) => row.partner_id === partner.id && row.operation_type === 'personal_purchase' && row.funding_mode === 'capital').reduce((n, row) => n + Number(row.amount || 0), 0);
      const personalPurchases = activeOperations.filter((row) => row.partner_id === partner.id && row.operation_type === 'personal_purchase').reduce((n, row) => n + Number(row.amount || 0), 0);
      const owed = activeOperations.filter((row) => row.partner_id === partner.id && (row.operation_type === 'partner_loan' || (row.operation_type === 'personal_purchase' && row.funding_mode === 'payable'))).reduce((n, row) => n + Number(row.amount || 0), 0);
      const settled = settlements.filter((row) => !row.deleted && row.partner_id === partner.id).reduce((n, row) => n + Number(row.amount || 0), 0);
      const withdrawals = activeOperations.filter((row) => row.partner_id === partner.id && row.operation_type === 'partner_withdrawal').reduce((n, row) => n + Number(row.amount || 0), 0);
      const dates = [...payments, ...activeOperations, ...settlements].filter((row) => row.partner_id === partner.id).map((row) => row.date || row.created_at).filter(Boolean).sort();
      return { ...partner, paid_capital: capitalPayments + capitalOperations, capital_operations: capitalOperations, personal_purchases: personalPurchases, owed_amount: owed, settled_amount: settled, remaining_owed: Math.max(0, owed - settled), withdrawals, last_operation_date: dates.at(-1) || null };
    });
    const grouped = new Map();
    rows.forEach((row) => {
      const key = normalizeName(row.name);
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, { ...row, partner_ids: [row.id], duplicate_record_count: 1 });
        return;
      }
      const preferred = row.agreed_capital_specified !== false && existing.agreed_capital_specified === false ? row : existing;
      grouped.set(key, {
        ...preferred,
        partner_ids: [...existing.partner_ids, row.id],
        duplicate_record_count: existing.duplicate_record_count + 1,
        paid_capital: Number(existing.paid_capital || 0) + Number(row.paid_capital || 0),
        capital_operations: Number(existing.capital_operations || 0) + Number(row.capital_operations || 0),
        personal_purchases: Number(existing.personal_purchases || 0) + Number(row.personal_purchases || 0),
        owed_amount: Number(existing.owed_amount || 0) + Number(row.owed_amount || 0),
        settled_amount: Number(existing.settled_amount || 0) + Number(row.settled_amount || 0),
        withdrawals: Number(existing.withdrawals || 0) + Number(row.withdrawals || 0),
        remaining_owed: Math.max(0, Number(existing.owed_amount || 0) + Number(row.owed_amount || 0) - Number(existing.settled_amount || 0) - Number(row.settled_amount || 0)),
        last_operation_date: [existing.last_operation_date, row.last_operation_date].filter(Boolean).sort().at(-1) || null,
      });
    });
    const displayPartners = [...grouped.values()];
    return { partners: displayPartners, operations: activeOperations.sort((a, b) => String(b.date || b.created_at).localeCompare(String(a.date || a.created_at))), settlements, payments, agreed: displayPartners.filter((row) => row.agreed_capital_specified !== false).reduce((n, row) => n + Number(row.agreed_capital || 0), 0), paid: displayPartners.reduce((n, row) => n + Number(row.paid_capital || 0), 0), remaining: displayPartners.filter((row) => row.agreed_capital_specified !== false).reduce((n, row) => n + Math.max(0, Number(row.agreed_capital || 0) - Number(row.paid_capital || 0)), 0), documentedCapital: displayPartners.reduce((n, row) => n + Number(row.paid_capital || 0), 0), totalOwed: displayPartners.reduce((n, row) => n + Number(row.remaining_owed || 0), 0) };
  },
  savePartner: async ({ id, name, agreed_capital, notes = '' } = {}) => {
    const s = await requireSuperAdmin();
    const nameValue = String(name || '').trim();
    const agreedProvided = agreed_capital !== null && agreed_capital !== undefined && String(agreed_capital).trim() !== '';
    const agreed = agreedProvided ? Number(agreed_capital) : null;
    if (!nameValue || (agreedProvided && (!Number.isFinite(agreed) || agreed < 0))) throw new Error('اسم الشريك مطلوب، ورأس المال المتفق عليه يجب أن يكون رقماً موجباً أو صفراً عند تحديده.');
    if (!id) { const duplicate = (await api.list('partners')).find((row) => !row.deleted && normalizeName(row.name) === normalizeName(nameValue)); if (duplicate) throw new Error('هذا الشريك موجود مسبقًا. افتح سجله وعدّل بياناته بدل إنشاء شريك مكرر.'); }
    const partnerRef = id ? ref(db, `partners/${id}`) : push(ref(db, 'partners')); const old = id ? await api.get(`partners/${id}`) : null; const now = new Date().toISOString();
    const item = withoutUndefined({ id: partnerRef.key, name: nameValue, agreed_capital: agreed, agreed_capital_specified: agreedProvided, notes: String(notes || '').trim(), created_at: old?.created_at || now, created_by: old?.created_by || s.user.id, updated_at: now, updated_by: s.user.id });
    await set(partnerRef, item); await api.logAudit(old ? 'PARTNER_UPDATED' : 'PARTNER_CREATED', 'partners', item.id, { before: old, after: item }); return item;
  },
  addPartnerPayment: async ({ partner_id, amount, date, payment_method = 'cash', cash_account_id, notes = '' } = {}) => {
    const s = await requireSuperAdmin(); const partner = await api.get(`partners/${partner_id}`); const value = Number(amount);
    if (!partner || partner.deleted) throw new Error('الشريك غير موجود.');
    if (!Number.isFinite(value) || value <= 0) throw new Error('مبلغ الدفعة يجب أن يكون أكبر من صفر.');
    const now = new Date().toISOString(); const paymentRef = push(ref(db, 'partner_payments')); const resolvedDate = date || now.slice(0, 10); const account = cash_account_id || (payment_method === 'cash' ? 'cashier' : 'electronic');
    const item = { id: paymentRef.key, partner_id, partner_name: partner.name, amount: value, date: resolvedDate, month: resolvedDate.slice(0, 7), payment_method, cash_account_id: account, notes: String(notes || '').trim(), created_at: now, created_by: s.user.id };
    const movementRef = push(ref(db, 'cash_movements')); const movement = { id: movementRef.key, type: 'IN', amount: value, cash_account_id: account, date: resolvedDate, month: item.month, payment_method, source_type: 'partner_capital', source_id: item.id, source_key: `partner_capital:${item.id}`, reason: 'رأس مال شريك', created_at: now, created_by: s.user.id };
    await update(ref(db), { [`partner_payments/${item.id}`]: item, [`cash_movements/${movement.id}`]: movement });
    await api.logAudit('PARTNER_PAYMENT_CREATED', 'partner_payments', item.id, item); return item;
  },
  createPartnerOperation: async (payload = {}) => {
    const s = await requireSuperAdmin();
    const partner = await api.get(`partners/${payload.partner_id}`);
    const type = String(payload.operation_type || '').trim();
    const value = Number(payload.amount);
    const date = payload.date || new Date().toISOString().slice(0, 10);
    const month = payload.month || date.slice(0, 7);
    const allowed = new Set(['capital_contribution', 'personal_purchase', 'partner_loan', 'partner_settlement', 'partner_withdrawal']);
    if (!partner || partner.deleted) throw new Error('الشريك غير موجود.');
    if (!allowed.has(type) || !Number.isFinite(value) || value <= 0) throw new Error('نوع العملية والمبلغ مطلوبان.');
    await checkMonthOpen(month);
    const operationKey = operationKeyFor('partner_operation', payload.operation_key);
    const claim = await claimOperation('partner_operation_claims', operationKey, { operation_key: operationKey, status: 'pending', created_at: new Date().toISOString(), created_by: s.user.id });
    if (!claim.committed) return duplicateOperationResult(claim.operation, operationKey);
    const now = new Date().toISOString();
    const opRef = push(ref(db, 'partner_operations'));
    const op = withoutUndefined({ id: opRef.key, operation_key: operationKey, partner_id: partner.id, partner_name: partner.name, operation_type: type, amount: value, date, month, description: String(payload.description || '').trim(), item_name: String(payload.item_name || '').trim(), accounting_class: payload.accounting_class || '', asset_category_id: payload.asset_category_id || '', asset_category_name: payload.asset_category_name || '', asset_subcategory_id: payload.asset_subcategory_id || '', asset_subcategory_name: payload.asset_subcategory_name || '', funding_mode: payload.funding_mode || '', payment_method: payload.payment_method || 'personal', cash_account_id: payload.cash_account_id || '', notes: String(payload.notes || '').trim(), created_at: now, created_by: s.user.id, status: 'completed' });
    const updates = { [`partner_operations/${op.id}`]: op, [`partner_operation_claims/${operationKey}`]: { ...claim.operation, id: op.id, result_id: op.id, status: 'completed', completed_at: now } };
    if (type === 'partner_settlement') {
      const all = await api.listPartnerCapital();
      const row = all.partners.find((item) => item.id === partner.id);
      if (!row || value > Number(row.remaining_owed || 0)) throw new Error('التسديد يتجاوز المستحق غير المسدد.');
      const settlementRef = push(ref(db, 'partner_settlements'));
      const settlement = { id: settlementRef.key, partner_id: partner.id, partner_name: partner.name, amount: value, date, month, payment_method: payload.payment_method || 'cash', cash_account_id: payload.cash_account_id || 'cashier', original_operation_id: payload.original_operation_id || '', operation_key: operationKey, notes: op.notes, created_at: now, created_by: s.user.id };
      updates[`partner_settlements/${settlement.id}`] = settlement;
      if (String(payload.payment_method || 'cash') === 'cash') { const cashRef = push(ref(db, 'cash_movements')); updates[`cash_movements/${cashRef.key}`] = { id: cashRef.key, type: 'OUT', amount: value, cash_account_id: settlement.cash_account_id, date, month, payment_method: 'cash', source_type: 'partner_settlement', source_id: settlement.id, source_key: `partner_settlement:${operationKey}`, operation_key: operationKey, reason: 'تسديد مستحق شريك', created_at: now, created_by: s.user.id }; }
    } else if (type === 'capital_contribution') {
      const paymentRef = push(ref(db, 'partner_payments')); const payment = { id: paymentRef.key, partner_id: partner.id, partner_name: partner.name, amount: value, date, month, payment_method: payload.payment_method || 'cash', cash_account_id: payload.cash_account_id || 'cashier', operation_key: operationKey, notes: op.notes, created_at: now, created_by: s.user.id }; updates[`partner_payments/${payment.id}`] = payment;
      if (payload.cash_received === true && String(payload.payment_method || 'cash') === 'cash') { const cashRef = push(ref(db, 'cash_movements')); updates[`cash_movements/${cashRef.key}`] = { id: cashRef.key, type: 'IN', amount: value, cash_account_id: payment.cash_account_id, date, month, payment_method: 'cash', source_type: 'partner_capital', source_id: payment.id, source_key: `partner_capital:${operationKey}`, operation_key: operationKey, reason: 'مساهمة رأس مال شريك', created_at: now, created_by: s.user.id }; }
    } else if (type === 'personal_purchase') {
      if (!['capital', 'payable'].includes(payload.funding_mode)) throw new Error('اختر زيادة رأس مال أو مبلغ مستحق للشريك.');
      const destinationType = payload.accounting_class === 'fixed_asset' ? 'assets' : payload.accounting_class === 'supplies' ? 'purchases' : payload.accounting_class === 'setup_cost' ? 'establishment_costs' : 'expenses';
      const destinationRef = push(ref(db, destinationType));
      const common = { id: destinationRef.key, source_type: 'partner_personal_purchase', source_id: op.id, source_key: `partner_personal_purchase:${operationKey}`, partner_id: partner.id, partner_name: partner.name, name: op.item_name || op.description, item_name: op.item_name || op.description, description: op.description, amount: value, total: value, date, month, payment_method: 'partner_personal', funding_mode: payload.funding_mode, accounting_class: payload.accounting_class, created_at: now, created_by: s.user.id };
      if (destinationType === 'assets') updates[`${destinationType}/${destinationRef.key}`] = { ...common, purchase_price: value, asset_category_id: op.asset_category_id, asset_category_name: op.asset_category_name || 'تجهيزات أخرى', asset_subcategory_id: op.asset_subcategory_id || null, asset_subcategory_name: op.asset_subcategory_name || null, status: 'active' };
      else if (destinationType === 'purchases') updates[`${destinationType}/${destinationRef.key}`] = { ...common, purchase_type: 'inventory', quantity: Number(payload.quantity || 1), unit: payload.unit || '', unit_price: value / Math.max(1, Number(payload.quantity || 1)), total_after_discount: value, paid_amount: 0, remaining_amount: 0 };
      else if (destinationType === 'establishment_costs') updates[`${destinationType}/${destinationRef.key}`] = { ...common, category_name: payload.subcategory || 'تكاليف تأسيس', paid_amount: 0, remaining_amount: 0, payment_status: 'paid' };
      else updates[`${destinationType}/${destinationRef.key}`] = { ...common, category_name: payload.subcategory || 'مصروفات', paid_amount: 0, remaining_amount: 0, payment_status: 'paid' };
      updates[`partner_operations/${op.id}`] = { ...op, destination_type: destinationType, destination_id: destinationRef.key };
      if (payload.funding_mode === 'payable') { const debtId = `partner:${op.id}`; updates[`debts/${debtId}`] = { id: debtId, type: 'payable', party_type: 'partner', party_id: partner.id, party_name: partner.name, category: payload.subcategory || 'شراء شخصي للشريك', original_amount: value, paid_amount: 0, remaining_amount: value, status: 'unpaid', debt_date: date, month, source_type: 'partner_personal_purchase', source_id: op.id, source_key: `partner_personal_purchase:${operationKey}`, created_at: now, created_by: s.user.id }; updates[`partner_operations/${op.id}`] = { ...op, destination_type: destinationType, destination_id: destinationRef.key, debt_id: debtId }; }
    } else if (type === 'partner_loan') {
      const debtId = `partner:${op.id}`; updates[`debts/${debtId}`] = { id: debtId, type: 'payable', party_type: 'partner', party_id: partner.id, party_name: partner.name, category: 'قرض شريك', original_amount: value, paid_amount: 0, remaining_amount: value, status: 'unpaid', debt_date: date, month, source_type: 'partner_loan', source_id: op.id, source_key: `partner_loan:${operationKey}`, created_at: now, created_by: s.user.id }; updates[`partner_operations/${op.id}`] = { ...op, debt_id: debtId };
      if (payload.cash_received === true) { const cashRef = push(ref(db, 'cash_movements')); updates[`cash_movements/${cashRef.key}`] = { id: cashRef.key, type: 'IN', amount: value, cash_account_id: payload.cash_account_id || 'cashier', date, month, payment_method: payload.payment_method || 'cash', source_type: 'partner_loan', source_id: op.id, source_key: `partner_loan:${operationKey}`, operation_key: operationKey, reason: 'قرض نقدي من شريك', created_at: now, created_by: s.user.id }; }
    } else if (type === 'partner_withdrawal' && String(payload.payment_method || 'cash') === 'cash') { const cashRef = push(ref(db, 'cash_movements')); updates[`cash_movements/${cashRef.key}`] = { id: cashRef.key, type: 'OUT', amount: value, cash_account_id: payload.cash_account_id || 'cashier', date, month, payment_method: 'cash', source_type: 'partner_withdrawal', source_id: op.id, source_key: `partner_withdrawal:${operationKey}`, operation_key: operationKey, reason: 'مسحوبات شريك', created_at: now, created_by: s.user.id }; }
    await update(ref(db), updates); await api.logAudit('PARTNER_OPERATION_CREATED', 'partner_operations', op.id, op); return op;
  },
  listPartnerOperations: async (partnerId = '') => { await requireSuperAdmin(); const [operations, settlements] = await Promise.all([api.list('partner_operations').catch(() => []), api.list('partner_settlements').catch(() => [])]); return { operations: operations.filter((row) => !row.deleted && (!partnerId || row.partner_id === partnerId)), settlements: settlements.filter((row) => !row.deleted && (!partnerId || row.partner_id === partnerId)) }; },
  saveEstablishmentCategory: async ({ id, name, active = true } = {}) => {
    const s = await requireSuperAdmin(); const value = String(name || '').trim(); if (!value) throw new Error('اسم التصنيف مطلوب.');
    const categoryRef = id ? ref(db, `establishment_categories/${id}`) : push(ref(db, 'establishment_categories')); const old = id ? await api.get(`establishment_categories/${id}`) : null; const now = new Date().toISOString();
    const item = { id: categoryRef.key, name, active: active !== false, created_at: old?.created_at || now, created_by: old?.created_by || s.user.id, updated_at: now, updated_by: s.user.id };
    await set(categoryRef, item); await api.logAudit(old ? 'ESTABLISHMENT_CATEGORY_UPDATED' : 'ESTABLISHMENT_CATEGORY_CREATED', 'establishment_categories', item.id, { before: old, after: item }); return item;
  },
  listAssetCategories: async () => {
    const s = await requirePermission('assets.view');
    const snap = await get(ref(db, 'asset_categories'));
    if (!snap.exists()) return [];
    return Object.keys(snap.val()).map((id) => ({ id, ...snap.val()[id] })).filter((row) => row.deleted !== true);
  },
  saveAssetCategory: async ({ id, name, description = '', icon = '', active = true } = {}) => {
    const s = await requirePermission(id ? 'assets.edit' : 'assets.create');
    const value = String(name || '').trim();
    if (!value) throw new Error('اسم قسم الأصول مطلوب.');
    const existing = await api.listAssetCategories();
    const normalized = normalizeName(value);
    const duplicate = existing.find((row) => normalizeName(row.name) === normalized && row.id !== id) || (!id && assetCategoryDefaults.some((defaultName) => normalizeName(defaultName) === normalized) ? { name: value } : null);
    if (duplicate) throw new Error('يوجد قسم أصول بالاسم نفسه أو بكتابة مكافئة.');
    const key = id || `custom-${assetCategoryKey(value)}`;
    const categoryRef = ref(db, `asset_categories/${key}`);
    const old = id ? await api.get(`asset_categories/${id}`) : null;
    const now = new Date().toISOString();
    const item = withoutUndefined({ id: key, name: value, description: String(description || '').trim(), icon: String(icon || '').trim(), active: active !== false, source: old?.source || 'user', created_at: old?.created_at || now, created_by: old?.created_by || s.user.id, updated_at: now, updated_by: s.user.id });
    await set(categoryRef, item);
    await api.logAudit(old ? 'ASSET_CATEGORY_UPDATED' : 'ASSET_CATEGORY_CREATED', 'asset_categories', key, { before: old, after: item });
    return item;
  },
  listAssetSubcategories: async (parentId = '') => {
    await requirePermission('assets.view');
    const snap = await get(ref(db, 'asset_subcategories'));
    if (!snap.exists()) return [];
    return Object.keys(snap.val()).map((id) => ({ id, ...snap.val()[id] })).filter((row) => row.deleted !== true && (!parentId || row.parent_id === parentId));
  },
  saveAssetSubcategory: async ({ id, parent_id, name, description = '', active = true } = {}) => {
    const s = await requirePermission(id ? 'assets.edit' : 'assets.create');
    const parent = String(parent_id || '').trim(); const value = String(name || '').trim();
    if (!parent || !value) throw new Error('القسم الرئيسي واسم القسم الفرعي مطلوبان.');
    const parentExists = (await api.listAssetCategories()).some((row) => row.id === parent && row.active !== false);
    if (!parentExists) throw new Error('القسم الرئيسي غير موجود أو غير فعال.');
    const existing = await api.listAssetSubcategories(parent);
    const duplicate = existing.find((row) => normalizeName(row.name) === normalizeName(value) && row.id !== id);
    if (duplicate) throw new Error('يوجد قسم فرعي بالاسم نفسه داخل القسم الرئيسي.');
    const key = id || `${parent}--${assetCategoryKey(value)}`;
    const old = id ? await api.get(`asset_subcategories/${id}`) : null; const now = new Date().toISOString();
    const item = withoutUndefined({ id: key, parent_id: parent, name: value, description: String(description || '').trim(), active: active !== false, created_at: old?.created_at || now, created_by: old?.created_by || s.user.id, updated_at: now, updated_by: s.user.id });
    await set(ref(db, `asset_subcategories/${key}`), item);
    await api.logAudit(old ? 'ASSET_SUBCATEGORY_UPDATED' : 'ASSET_SUBCATEGORY_CREATED', 'asset_subcategories', key, { before: old, after: item });
    return item;
  },
  listEstablishmentCosts: async () => {
    await requireSuperAdmin(); const [costs, categories] = await Promise.all([api.list('establishment_costs'), api.list('establishment_categories')]);
    return { costs, categories, report: buildEstablishmentReport({ costs, partners: (await api.list('partners')), partnerPayments: (await api.list('partner_payments')) }) };
  },
  addEstablishmentCost: async ({ amount, date, category_id, category_name, description = '', payment_method = 'cash', paid_amount, linked_source_type = '', linked_source_id = '', attachment_url = '', notes = '' } = {}) => {
    const s = await requireSuperAdmin(); const total = Number(amount); if (!Number.isFinite(total) || total <= 0) throw new Error('مبلغ تكلفة التأسيس يجب أن يكون أكبر من صفر.');
    const category = category_id ? await api.get(`establishment_categories/${category_id}`) : null; const resolvedCategory = category?.name || String(category_name || 'تكاليف تأسيس أخرى').trim();
    const paid = Math.min(total, Math.max(0, paid_amount === '' || paid_amount == null ? total : Number(paid_amount))); if (!Number.isFinite(paid)) throw new Error('المبلغ المدفوع غير صحيح.');
    const now = new Date().toISOString(); const resolvedDate = date || now.slice(0, 10); const costRef = push(ref(db, 'establishment_costs')); const item = withoutUndefined({ id: costRef.key, amount: total, paid_amount: paid, remaining_amount: total - paid, payment_status: paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid', date: resolvedDate, month: resolvedDate.slice(0, 7), category_id: category_id || '', category_name: resolvedCategory, description: String(description || '').trim(), payment_method, linked_source_type: String(linked_source_type || '').trim(), linked_source_id: String(linked_source_id || '').trim(), attachment_url: String(attachment_url || '').trim(), notes: String(notes || '').trim(), created_at: now, created_by: s.user.id });
    const updates = { [`establishment_costs/${item.id}`]: item };
    if (item.linked_source_id) {
      if (!['purchases', 'purchase_invoices', 'expenses', 'assets'].includes(item.linked_source_type)) throw new Error('حدد نوع المصدر المرتبط: مشتريات أو فواتير شراء أو مصروفات أو أصول.');
      const source = await api.get(`${item.linked_source_type}/${item.linked_source_id}`); if (!source) throw new Error('المصدر المرتبط غير موجود؛ لم يتم تسجيل تكلفة التأسيس.');
      updates[`${item.linked_source_type}/${item.linked_source_id}/establishment_reclassified`] = true;
      updates[`${item.linked_source_type}/${item.linked_source_id}/establishment_reclassified_by`] = s.user.id;
      updates[`${item.linked_source_type}/${item.linked_source_id}/establishment_reclassified_at`] = now;
    }
    if (paid > 0 && !item.linked_source_id) { const movementRef = push(ref(db, 'cash_movements')); updates[`cash_movements/${movementRef.key}`] = { id: movementRef.key, type: 'OUT', amount: paid, cash_account_id: payment_method === 'cash' ? 'cashier' : 'electronic', payment_method, date: resolvedDate, month: item.month, source_type: 'establishment_cost', source_id: item.id, source_key: `establishment_cost:${item.id}`, reason: 'تكلفة تأسيس وافتتاح', created_at: now, created_by: s.user.id }; }
    await update(ref(db), updates); await api.logAudit('ESTABLISHMENT_COST_CREATED', 'establishment_costs', item.id, item); return item;
  },
  updateEstablishmentCost: async (id, patch = {}) => {
    const s = await requireSuperAdmin(); const old = await api.get(`establishment_costs/${id}`); if (!old) throw new Error('تكلفة التأسيس غير موجودة.');
    const total = patch.amount == null ? Number(old.amount || 0) : Number(patch.amount); const paid = patch.paid_amount == null ? Number(old.paid_amount || 0) : Number(patch.paid_amount);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(paid) || paid < 0 || paid > total) throw new Error('إجمالي التكلفة والمدفوع غير صحيحين.');
    const now = new Date().toISOString(); const item = withoutUndefined({ ...old, ...patch, id, amount: total, paid_amount: paid, remaining_amount: total - paid, payment_status: paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid', updated_at: now, updated_by: s.user.id });
    const updates = { [`establishment_costs/${id}`]: item }; const movements = await api.list('cash_movements').catch(() => []); const linked = movements.filter((row) => row.source_type === 'establishment_cost' && row.source_id === id && !row.deleted);
    linked.forEach((row) => { updates[`cash_movements/${row.id}/deleted`] = true; updates[`cash_movements/${row.id}/deleted_at`] = now; updates[`cash_movements/${row.id}/deleted_by`] = s.user.id; });
    if (paid > 0 && !item.linked_source_id) { const movementRef = push(ref(db, 'cash_movements')); updates[`cash_movements/${movementRef.key}`] = { id: movementRef.key, type: 'OUT', amount: paid, cash_account_id: item.payment_method === 'cash' ? 'cashier' : 'electronic', payment_method: item.payment_method, date: item.date, month: item.month || String(item.date || '').slice(0, 7), source_type: 'establishment_cost', source_id: id, source_key: `establishment_cost:${id}:revision:${now}`, reason: 'تعديل تكلفة تأسيس', created_at: now, created_by: s.user.id }; }
    await update(ref(db), updates); await api.logAudit('ESTABLISHMENT_COST_UPDATED', 'establishment_costs', id, { before: old, after: item }); return item;
  },
  establishmentReport: async () => {
    await requireSuperAdmin(); const [costs, partners, partnerPayments] = await Promise.all([api.list('establishment_costs'), api.list('partners'), api.list('partner_payments')]);
    return buildEstablishmentReport({ costs, partners, partnerPayments });
  },
  prepareSystemReset: async () => {
    await requireSuperAdmin(); const entries = await Promise.all(SYSTEM_RESET_TARGETS.map(async (path) => [path, (await get(ref(db, path))).val() || {}]));
    const snapshot = Object.fromEntries(entries); const accounts = (await get(ref(db, 'cash_accounts'))).val() || {}; const inventory = (await get(ref(db, 'inventory_items'))).val() || {};
    const counts = resetBackupCounts(snapshot); counts.cash_accounts = Object.keys(accounts).length; counts.inventory_items = Object.keys(inventory).length;
    return { snapshot, counts, generated_at: new Date().toISOString(), targets: SYSTEM_RESET_TARGETS };
  },
  executeSystemReset: async ({ confirmation, backupHash, includeInventory = false, backupCounts = {} } = {}) => {
    const s = await requireSuperAdmin();
    const localEmulator = (typeof process !== 'undefined' && ['127.0.0.1', 'localhost'].includes(String(process.env?.FIREBASE_EMULATOR_HOST || '').split(':')[0])) || (typeof window !== 'undefined' && import.meta.env?.DEV && ['localhost', '127.0.0.1'].includes(window.location.hostname));
    if (!localEmulator) throw new Error('التصفير متاح محلياً على Emulator فقط في هذه المرحلة.');
    if (confirmation !== 'أوافق على تصفير النظام وبدء حسابات جديدة') throw new Error('اكتب عبارة التأكيد كاملة قبل التصفير.');
    if (!backupHash || !Object.keys(backupCounts).length) throw new Error('يجب إنشاء نسخة احتياطية والتحقق منها قبل التصفير.');
    const liveCounts = {};
    for (const path of SYSTEM_RESET_TARGETS) { const value = (await get(ref(db, path))).val() || {}; liveCounts[path] = Object.keys(value).length; }
    const countMismatch = SYSTEM_RESET_TARGETS.find((path) => Number(liveCounts[path]) !== Number(backupCounts[path] || 0));
    if (countMismatch) throw new Error(`تغيرت البيانات بعد إنشاء النسخة الاحتياطية (${countMismatch}). أنشئ نسخة جديدة قبل التصفير.`);
    const currentPeriods = (await get(ref(db, 'monthly_periods'))).val() || {};
    for (const [id, period] of Object.entries(currentPeriods)) {
      if (period?.status === 'closed') await update(ref(db, `monthly_periods/${id}`), { status: 'open', reset_prepared_at: new Date().toISOString(), reset_prepared_by: s.user.id });
    }
    const updates = {};
    for (const path of SYSTEM_RESET_TARGETS) {
      const value = (await get(ref(db, path))).val() || {};
      if (path === 'monthly_periods') {
        Object.entries(value).forEach(([id]) => { updates[`${path}/${id}`] = { id, month: id, status: 'open', reset_at: new Date().toISOString(), reset_by: s.user.id }; });
      } else Object.keys(value).forEach((id) => { updates[`${path}/${id}`] = null; });
    }
    const accounts = (await get(ref(db, 'cash_accounts'))).val() || {}; Object.keys(accounts).forEach((id) => { updates[`cash_accounts/${id}/opening_balance`] = 0; updates[`cash_accounts/${id}/current_balance`] = 0; });
    if (includeInventory) { const inventory = (await get(ref(db, 'inventory_items'))).val() || {}; Object.keys(inventory).forEach((id) => { updates[`inventory_items/${id}/quantity`] = 0; updates[`inventory_items/${id}/location_quantities`] = {}; }); }
    await update(ref(db), updates);
    const result = { id: `reset_${Date.now()}`, backup_hash: backupHash, backup_counts: backupCounts, include_inventory: includeInventory, completed_at: new Date().toISOString(), executed_by: s.user.id };
    await api.logAudit('SYSTEM_RESET_COMPLETED', 'system', result.id, result); return result;
  },
  verifySystemReset: async ({ includeInventory = false } = {}) => {
    await requireSuperAdmin(); const checks = {};
    for (const path of SYSTEM_RESET_TARGETS) checks[path] = path === 'monthly_periods' ? true : !(await get(ref(db, path))).exists();
    const periods = (await get(ref(db, 'monthly_periods'))).val() || {}; checks.monthly_periods_zero = Object.values(periods).every((period) => period && Number(period.total || 0) === 0 && Number(period.revenue || 0) === 0 && Number(period.expenses || 0) === 0);
    if (includeInventory) { const inventory = (await get(ref(db, 'inventory_items'))).val() || {}; checks.inventory_zero = Object.values(inventory).every((item) => Number(item.quantity || 0) === 0); }
    return { checks, passed: Object.values(checks).every(Boolean) };
  },
  listAuthorizedUsers: async () => {
    await requirePermission('users.view');
    const data = await api.get('authorized_users');
    return Object.entries(data || {}).map(([id, value]) => ({ id, ...value, permissions: permissionsFromFirebase(value?.permissions || {}) }));
  },
  stockMovement: async ({ itemId, itemName, type, quantity, unit, reason, date, notes, operation_key }) => {
    const s = await api.session();
    if (!s?.user || (!s.permissions?.includes('stock_in.create') && !s.permissions?.includes('stock_out.create') && s.user.role !== 'super_admin' && s.user.role !== 'manager')) throw new Error('غير مصرح بحركة المخزون.');
    const qty = validNumber(quantity, 'الكمية');
    if (!['IN', 'OUT', 'ADJUSTMENT'].includes(type) || qty <= 0 || !itemId) throw new Error('نوع أو كمية الحركة غير صحيحة.');
    const item = await api.get(`inventory_items/${itemId}`); if (!item) throw new Error('مادة المخزون غير موجودة.');
    const baseQty = toBaseQuantity({ quantity: qty, unit: unit || item.base_unit || item.unit, baseUnit: item.base_unit || item.unit, conversionFactor: item.units_per_package || 1 });
    const current = Number(item.quantity ?? item.current_stock ?? item.stock ?? item.initial_stock ?? 0);
    const next = type === 'IN' ? current + baseQty : type === 'OUT' ? current - baseQty : baseQty;
    const allowNegative = (await api.get('settings/inventory/allow_negative_stock')) === true;
    if (next < 0 && !allowNegative) throw new Error('الرصيد لا يكفي للإخراج.');
    const key = operationKeyFor('manual_stock', operation_key || `${itemId}:${type}:${date || new Date().toISOString()}:${qty}:${reason || ''}`);
    const claim = await claimOperation('inventory_operations', key, { id: key, status: 'pending', kind: 'manual_stock', source_type: 'manual_stock', source_id: itemId, created_at: new Date().toISOString(), created_by: s.user.id });
    if (!claim.committed) return { already_processed: true, operation_key: key };
    const movementRef = push(ref(db, 'inventory_movements')); const now = new Date().toISOString();
    const payload = { id: movementRef.key, item_id: itemId, item_name: itemName || item.name_ar || item.name || '', type, quantity: qty, base_quantity: baseQty, quantity_delta: type === 'IN' ? baseQty : type === 'OUT' ? -baseQty : baseQty - current, unit: unit || item.base_unit || item.unit || '', base_unit: item.base_unit || item.unit || '', before_quantity: current, after_quantity: next, reason: reason || '', date: date || now.slice(0, 10), notes: notes || '', source_type: 'manual_stock', source_id: key, operation_id: key, created_at: now, created_by: s.user.id, created_by_name: s.user.name || '' };
    await update(ref(db), { [`inventory_movements/${movementRef.key}`]: payload, [`inventory_items/${itemId}/quantity`]: roundInventory(next), [`inventory_items/${itemId}/updated_at`]: now, [`inventory_operations/${key}/status`]: 'completed', [`inventory_operations/${key}/movement_id`]: movementRef.key, [`inventory_operations/${key}/completed_at`]: now });
    await api.logAudit('STOCK_MOVEMENT', 'inventory_movements', movementRef.key, payload);
    return payload;
  },
  lookupBarcode: async (code) => {
    await requirePermission('inventory.scan'); const items = await api.list('inventory_items');
    return barcodeMatch(items, code);
  },
  assignInternalBarcode: async (itemId) => {
    const s = await requirePermission('inventory.scan'); const item = await api.get(`inventory_items/${itemId}`); if (!item) throw new Error('المادة غير موجودة.');
    const internal_barcode = item.internal_barcode || makeInternalCode(itemId); await update(ref(db, `inventory_items/${itemId}`), { internal_barcode, updated_at: new Date().toISOString(), updated_by: s.user.id }); await api.logAudit('INTERNAL_BARCODE_GENERATED', 'inventory_items', itemId, { internal_barcode }); return internal_barcode;
  },
  saveRecipe: async ({ product_id, items }) => {
    const s = await requirePermission('recipes.manage');
    if (!product_id || !Array.isArray(items)) throw new Error('المنتج وبنود الوصفة مطلوبة.');
    const inventory = await api.list('inventory_items'); const byId = new Map(inventory.map((item) => [String(item.id), item]));
    const ids = new Set();
    const normalized = items.map((line) => {
      const item = byId.get(String(line.inventory_item_id || ''));
      if (!item || item.active === false) throw new Error('اختر مادة مخزون فعالة لكل بند في الوصفة.');
      if (ids.has(String(item.id))) throw new Error('لا يمكن تكرار المادة نفسها في الوصفة.');
      ids.add(String(item.id));
      const quantity = Number(line.quantity);
      const unit = item.base_unit || item.unit;
      if (!Number.isFinite(quantity) || quantity <= 0 || !['ml', 'g', 'piece'].includes(unit)) throw new Error('استخدم كمية موجبة ووحدة أساسية معتمدة (ml أو g أو piece).');
      return { inventory_item_id: item.id, quantity, unit };
    });
    const existing = await api.get(`product_recipes/${product_id}`); const now = new Date().toISOString();
    if (!normalized.length) {
      if (existing) await remove(ref(db, `product_recipes/${product_id}`));
      await api.logAudit('RECIPE_REMOVED', 'product_recipes', product_id, { product_id, previous_items: existing?.items || [] });
      return null;
    }
    recipeCost({ recipe: normalized, inventory });
    const value = { id: product_id, product_id, items: normalized, updated_at: now, updated_by: s.user.id, created_at: existing?.created_at || now, created_by: existing?.created_by || s.user.id };
    await set(ref(db, `product_recipes/${product_id}`), value); await api.logAudit(existing ? 'RECIPE_UPDATED' : 'RECIPE_CREATED', 'product_recipes', product_id, value); return value;
  },
  listOtherIncomeCategories: async ({ includeInactive = false } = {}) => {
    await requirePermission('other_income.view');
    const rows = await api.list('other_income_categories').catch(() => []);
    return rows.filter((row) => includeInactive || row.active !== false).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name_ar || '').localeCompare(String(b.name_ar || '')));
  },
  saveOtherIncomeCategory: async ({ id, name_ar, active = true }) => {
    const s = await requireOtherIncomeCategoryManager(); const name = String(name_ar || '').trim();
    if (!name) throw new Error('اسم فئة الإيراد مطلوب.');
    const key = id || push(ref(db, 'other_income_categories')).key; const existing = await api.get(`other_income_categories/${key}`);
    const all = await api.list('other_income_categories').catch(() => []);
    if (all.some((row) => row.id !== key && String(row.name_ar || '').trim() === name)) throw new Error('فئة الإيراد موجودة مسبقاً.');
    const now = new Date().toISOString(); const item = { id: key, name_ar: name, active: active !== false, sort_order: existing?.sort_order ?? all.length + 1, created_at: existing?.created_at || now, created_by: existing?.created_by || s.user.id, updated_at: now, updated_by: s.user.id };
    await set(ref(db, `other_income_categories/${key}`), item); await api.logAudit(existing ? 'OTHER_INCOME_CATEGORY_UPDATED' : 'OTHER_INCOME_CATEGORY_CREATED', 'other_income_categories', key, item); return item;
  },
  archiveOtherIncomeCategory: async (id) => {
    const s = await requireOtherIncomeCategoryManager(); const existing = await api.get(`other_income_categories/${id}`); if (!existing) throw new Error('فئة الإيراد غير موجودة.');
    const item = { ...existing, active: false, archived_at: new Date().toISOString(), archived_by: s.user.id, updated_at: new Date().toISOString(), updated_by: s.user.id };
    await set(ref(db, `other_income_categories/${id}`), item); await api.logAudit('OTHER_INCOME_CATEGORY_ARCHIVED', 'other_income_categories', id, item); return item;
  },
  recipeMetrics: async (productId) => {
    await requirePermission('recipes.view'); const [recipe, inventory, product] = await Promise.all([api.get(`product_recipes/${productId}`), api.list('inventory_items'), api.get(`products/${productId}`)]); if (!recipe) return null; const cost = recipeCost({ recipe: recipe.items || [], inventory }); const stock = new Map(inventory.map((item) => [item.id, item])); const selling = Number(product?.selling_price ?? product?.sellingPrice ?? 0); return { recipe, cost: cost.total, ingredients: cost.lines.map((line) => ({ ...line, available_quantity: Number(stock.get(line.inventory_item_id)?.quantity || 0), base_unit: stock.get(line.inventory_item_id)?.base_unit || stock.get(line.inventory_item_id)?.unit || '' })), available_servings: availableServings({ recipe: recipe.items || [], inventory }), selling_price: selling, gross_profit: selling - cost.total, gross_margin: selling > 0 ? (selling - cost.total) / selling * 100 : null };
  },
  consumeRecipe: async (productId, quantity, source = {}) => {
    const s = await api.session();
    if (!hasPermission(s, 'recipes.manage') && !hasPermission(s, 'sales.create')) throw new Error('غير مصرح باستهلاك الوصفة.');
    const amount = Number(quantity); if (!Number.isFinite(amount) || amount <= 0 || !source.source_key) throw new Error('كمية ومفتاح مصدر فريد مطلوبان.'); await checkMonthOpen(source.month || currentMonth());
    const operationKey = String(source.source_key).replace(/[.#$\[\]/]/g, '_'); const operationRef = ref(db, `inventory_operations/${operationKey}`); const now = new Date().toISOString();
    const [recipe, inventory, batches] = await Promise.all([api.get(`product_recipes/${productId}`), api.list('inventory_items'), api.list('inventory_batches').catch(() => [])]); if (!recipe) throw new Error('لا توجد وصفة للمنتج.'); const byId = new Map(inventory.map((item) => [item.id, item])); const updates = {};
    for (const line of recipe.items || []) { const item = byId.get(line.inventory_item_id); if (!item) throw new Error('مادة الوصفة غير موجودة.'); const delta = toBaseQuantity({ quantity: Number(line.quantity) * amount, unit: line.unit || item.base_unit, baseUnit: item.base_unit || item.unit, conversionFactor: line.conversion_factor || 1 }); const before = inventoryQuantity(item); if (before < delta) throw new Error(`المخزون لا يكفي: ${item.name_ar || item.id}`); const usableBatches = batches.filter((batch) => batch.item_id === item.id && !batch.deleted && Number(batch.remaining_quantity) > 0 && (!batch.expiry_date || batch.expiry_date >= now.slice(0, 10))); const batchTotal = usableBatches.reduce((sum, batch) => sum + Number(batch.remaining_quantity || 0), 0); const allocations = item.track_expiry && batchTotal >= delta ? selectFefoBatches({ batches: usableBatches, quantity: delta, today: now.slice(0, 10) }) : []; allocations.forEach((allocation) => { const batch = batches.find((row) => row.id === allocation.batch_id); updates[`inventory_batches/${allocation.batch_id}/remaining_quantity`] = roundInventory(Number(batch.remaining_quantity) - allocation.quantity); }); const id = push(ref(db, 'inventory_movements')).key; updates[`inventory_items/${item.id}/quantity`] = roundInventory(before - delta); updates[`inventory_movements/${id}`] = { id, item_id: item.id, product_id: productId, type: 'recipe_consumption', quantity_delta: -delta, base_unit: item.base_unit || item.unit, before_quantity: before, after_quantity: roundInventory(before - delta), batch_allocations: allocations, source_type: source.source_type || 'manual_recipe_consumption', source_id: source.source_id || operationKey, source_key: source.source_key, operation_id: source.operation_id || operationKey, month: source.month || currentMonth(), date: source.date || now.slice(0, 10), created_at: now, created_by: s.user.id }; updates[`inventory_operations/${operationKey}/movement_ids/${id}`] = true; }
    let duplicate = false; const claim = await runTransaction(operationRef, (existing) => { if (existing?.status === 'completed') { duplicate = true; return; } if (existing?.status === 'pending') { duplicate = true; return; } return { id: operationKey, status: 'pending', source_key: source.source_key, source_type: source.source_type || 'manual_recipe_consumption', source_id: source.source_id || operationKey, product_id: productId, quantity: amount, created_at: existing?.created_at || now, created_by: s.user.id }; });
    if (!claim.committed || duplicate) return { idempotent: true, already_processed: true, pending: claim.snapshot.val()?.status === 'pending' };
    updates[`inventory_operations/${operationKey}/status`] = 'completed'; updates[`inventory_operations/${operationKey}/completed_at`] = now; updates[`audit/recipe_consumption_${operationKey}`] = { action: 'RECIPE_CONSUMED', entity: 'product_recipes', entity_id: productId, source_key: source.source_key, created_at: now, created_by: s.user.id }; await update(ref(db), updates); return { idempotent: false, already_processed: false };
  },
  recordWaste: async ({ item_id, quantity, unit, reason, batch_id = '', date, month, notes = '', operation_id, operation_key }) => {
    const s = await requirePermission('inventory.waste'); const item = await api.get(`inventory_items/${item_id}`); if (!item) throw new Error('المادة غير موجودة.'); const resolvedMonth = month || getRecordMonth({ date }) || currentMonth(); await checkMonthOpen(resolvedMonth); const base = toBaseQuantity({ quantity, unit, baseUnit: item.base_unit || item.unit, conversionFactor: item.units_per_package || 1 }); const before = inventoryQuantity(item); if (base <= 0 || before < base) throw new Error('كمية الهدر غير متاحة.');
    const batch = batch_id ? await api.get(`inventory_batches/${batch_id}`) : null;
    if (batch_id && (!batch || batch.item_id !== item_id || Number(batch.remaining_quantity) < base)) throw new Error('دفعة الهدر غير متاحة أو رصيدها لا يكفي.');
    const wasteRef = push(ref(db, 'inventory_waste')), moveRef = push(ref(db, 'inventory_movements')), now = new Date().toISOString(); const key = operationKeyFor('waste', operation_key || operation_id); const waste = { id: wasteRef.key, operation_id: operation_id || key, operation_key: key, item_id, quantity: Number(quantity), unit, base_quantity: base, reason, batch_id, date: date || now.slice(0,10), month: resolvedMonth, notes, created_at: now, created_by: s.user.id };
    const claim = await claimOperation('inventory_operations', key, { id: key, status: 'pending', kind: 'waste', result_id: waste.id, operation_id: waste.operation_id, created_at: now, created_by: s.user.id });
    if (!claim.committed) return duplicateOperationResult(claim.operation, key);
    const updates = { [`inventory_waste/${waste.id}`]: waste, [`inventory_items/${item_id}/quantity`]: before - base, [`inventory_movements/${moveRef.key}`]: { id: moveRef.key, item_id, type: 'waste', quantity_delta: -base, base_unit: item.base_unit || item.unit, before_quantity: before, after_quantity: before-base, batch_id, source_type: 'waste', source_id: waste.id, operation_id: waste.operation_id, operation_key: key, month: resolvedMonth, date: waste.date, created_at: now, created_by: s.user.id }, [`inventory_operations/${key}/status`]: 'completed', [`inventory_operations/${key}/completed_at`]: now, [`audit/inventory_waste_${key}`]: { action: 'INVENTORY_WASTE_CREATED', entity: 'inventory_waste', entity_id: waste.id, operation_key: key, created_at: now, created_by: s.user.id } };
    if (batch) updates[`inventory_batches/${batch_id}/remaining_quantity`] = roundInventory(Number(batch.remaining_quantity) - base);
    await update(ref(db), updates); return { ...waste, ok: true, already_processed: false };
  },
  createStocktake: async ({ date, month, items = [] }) => {
    const s = await requirePermission('inventory.stocktake'); const resolvedMonth = month || getRecordMonth({ date }) || currentMonth(); const inventory = await api.list('inventory_items'); const byId = new Map(inventory.map((item) => [item.id, item]));
    const snapshot = items.map((line) => { const item = byId.get(line.item_id); if (!item) throw new Error('مادة الجرد غير موجودة.'); const expected = Number(line.expected_quantity ?? item.quantity ?? 0); const actual = Number(line.actual_quantity ?? expected); if (!Number.isFinite(actual) || actual < 0) throw new Error('كمية الجرد غير صحيحة.'); return { item_id: item.id, item_name: item.name_ar || item.name || '', base_unit: item.base_unit || item.unit || '', expected_quantity: expected, actual_quantity: actual, variance_quantity: roundInventory(actual - expected), variance_value: roundInventory((actual - expected) * Number(item.average_unit_cost ?? item.purchase_price ?? 0)), average_unit_cost_snapshot: Number(item.average_unit_cost ?? item.purchase_price ?? 0) }; });
    const refStocktake = push(ref(db, 'stocktakes')); const value = { id: refStocktake.key, date: date || new Date().toISOString().slice(0,10), month: resolvedMonth, status: 'draft', items: snapshot, created_at: new Date().toISOString(), created_by: s.user.id }; await set(refStocktake, value); await api.logAudit('STOCKTAKE_CREATED', 'stocktakes', value.id, value); return value;
  },
  submitStocktake: async (id) => { const s = await requirePermission('inventory.stocktake'); const item = await api.get(`stocktakes/${id}`); if (!item || item.status !== 'draft') throw new Error('الجرد غير متاح للإرسال.'); await update(ref(db, `stocktakes/${id}`), { status: 'submitted', submitted_at: new Date().toISOString(), submitted_by: s.user.id }); await api.logAudit('STOCKTAKE_SUBMITTED', 'stocktakes', id, {}); },
  approveStocktake: async (id) => {
    const s = await requirePermission('inventory.stocktake_approve');
    const now = new Date().toISOString();
    const stocktakeRef = ref(db, `stocktakes/${id}`);
    let stocktake = await api.get(`stocktakes/${id}`);
    if (!stocktake) throw new Error('الجرد غير متاح للاعتماد.');
    await checkMonthOpen(stocktake.month);

    const claim = await claimOperation('stocktake_operations', id, { id, status: 'pending', kind: 'stocktake_approval', stocktake_id: id, created_at: now, created_by: s.user.id });
    if (!claim.committed) return duplicateOperationResult(claim.operation, id);
    if (stocktake.status === 'approved') return { idempotent: true };
    if (stocktake.status !== 'submitted' && stocktake.status !== 'approving') throw new Error('يجب إرسال الجرد قبل اعتماده.');
    await update(stocktakeRef, { status: 'approving', approval_claimed_at: now, approval_claimed_by: s.user.id });

    const movementIds = (stocktake.items || []).map((line) => stocktakeMovementId(id, line.item_id));
    const existingMovements = await Promise.all(movementIds.map((moveId) => api.get(`inventory_movements/${moveId}`)));
    if (existingMovements.some(Boolean) && !existingMovements.every((movement) => movement?.source_id === id && movement?.type === 'stocktake_adjustment')) {
      throw new Error('تعذر استئناف اعتماد الجرد بأمان؛ توجد حركة تسوية غير متطابقة.');
    }
    if (existingMovements.length && existingMovements.every((movement) => movement?.source_id === id && movement?.type === 'stocktake_adjustment')) {
      await update(ref(db), { [`stocktakes/${id}/status`]: 'approved', [`stocktakes/${id}/approved_at`]: now, [`stocktakes/${id}/approved_by`]: s.user.id, [`stocktake_operations/${id}/status`]: 'completed', [`stocktake_operations/${id}/completed_at`]: now });
      return { idempotent: true, recovered: true };
    }

    const updates = { [`stocktakes/${id}/status`]: 'approved', [`stocktakes/${id}/approved_at`]: now, [`stocktakes/${id}/approved_by`]: s.user.id, [`stocktake_operations/${id}/status`]: 'completed', [`stocktake_operations/${id}/completed_at`]: now };
    for (const line of stocktake.items || []) {
      const item = await api.get(`inventory_items/${line.item_id}`);
      if (!item) throw new Error('مادة الجرد غير موجودة.');
      const expected = Number(line.expected_quantity), actual = Number(line.actual_quantity);
      if (!Number.isFinite(expected) || !Number.isFinite(actual) || actual < 0) throw new Error('لقطة الجرد غير صحيحة.');
      const delta = roundInventory(actual - expected);
      const before = inventoryQuantity(item);
      const moveId = stocktakeMovementId(id, item.id);
      updates[`inventory_items/${item.id}/quantity`] = roundInventory(before + delta);
      updates[`inventory_movements/${moveId}`] = { id: moveId, item_id: item.id, type: 'stocktake_adjustment', quantity_delta: delta, expected_quantity: expected, actual_quantity: actual, base_unit: item.base_unit || item.unit, before_quantity: before, after_quantity: roundInventory(before + delta), source_type: 'stocktake', source_id: id, month: stocktake.month, date: stocktake.date, created_at: now, created_by: s.user.id };
    }
    await update(ref(db), updates);
    await api.logAudit('STOCKTAKE_APPROVED', 'stocktakes', id, {});
    return { idempotent: false };
  },
  createInventoryTransfer: async ({ item_id, from_location, to_location, quantity, unit, date, month, notes = '' }) => {
    const s = await requirePermission('inventory.transfer'); if (!from_location || !to_location || from_location === to_location) throw new Error('مواقع النقل غير صحيحة.'); const item = await api.get(`inventory_items/${item_id}`); if (!item) throw new Error('المادة غير موجودة.'); const resolvedMonth = month || getRecordMonth({ date }) || currentMonth(); const base = toBaseQuantity({ quantity, unit, baseUnit: item.base_unit || item.unit, conversionFactor: item.units_per_package || 1 }); if (base <= 0) throw new Error('كمية النقل غير صحيحة.'); const balances = locationBalances(item); const fromBefore = Number(balances[from_location] || 0); if (fromBefore < base) throw new Error('رصيد الموقع المصدر لا يكفي.'); const transferRef = push(ref(db,'inventory_transfers')), outRef=push(ref(db,'inventory_movements')), inRef=push(ref(db,'inventory_movements')), now=new Date().toISOString(); const value={id:transferRef.key,item_id,from_location,to_location,quantity:Number(quantity),unit,base_quantity:base,date:date||now.slice(0,10),month:resolvedMonth,notes,created_at:now,created_by:s.user.id}; const toBefore = Number(balances[to_location] || 0); await update(ref(db), {[`inventory_transfers/${value.id}`]:value,[`inventory_items/${item_id}/location_quantities/${from_location}`]:roundInventory(fromBefore-base),[`inventory_items/${item_id}/location_quantities/${to_location}`]:roundInventory(toBefore+base),[`inventory_movements/${outRef.key}`]:{id:outRef.key,item_id,type:'transfer_out',quantity_delta:-base,before_quantity:fromBefore,after_quantity:roundInventory(fromBefore-base),location_id:from_location,base_unit:item.base_unit||item.unit,source_type:'inventory_transfer',source_id:value.id,month:resolvedMonth,date:value.date,created_at:now,created_by:s.user.id},[`inventory_movements/${inRef.key}`]:{id:inRef.key,item_id,type:'transfer_in',quantity_delta:base,before_quantity:toBefore,after_quantity:roundInventory(toBefore+base),location_id:to_location,base_unit:item.base_unit||item.unit,source_type:'inventory_transfer',source_id:value.id,month:resolvedMonth,date:value.date,created_at:now,created_by:s.user.id}}); await api.logAudit('INVENTORY_TRANSFER_CREATED','inventory_transfers',value.id,value); return value;
  },
  expiryAlerts: async () => { await requirePermission('inventory.view'); return expiryAlerts({ batches: await api.list('inventory_batches') }); },
  importBatch: async ({ filename, sheet, entity, mapping, rows, categoryRows = [], categoryMapping = {} }) => {
    const s = await requirePermission('excel.import');
    if (!canManage(s)) throw new Error('غير مصرح بالاستيراد.');
    const batchRef = push(ref(db, 'imports')); const batchId = batchRef.key; const updates = {};
    const existing = await api.list(entity); const nameOf = x => normalizeName(x.name_ar || x.nameAr || x.name || x.item_name || ''); const categoryOf = x => String(x.category_id || x.categoryId || x.category || '').trim().toLowerCase(); const seen = new Set(existing.map(x => `${categoryOf(x)}|${nameOf(x)}`));
    const categoryName = row => String(row[categoryMapping.name] ?? row[categoryMapping.nameAr] ?? '').trim();
    const slug = value => String(value || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'uncategorized';
    const categoryCache = new Map((await api.list('product_categories')).map(x => [normalizeName(x.name_ar || x.nameAr || x.name || ''), x.id]));
    const productCategoryIds = new Set((await api.list('product_categories')).map(x => String(x.id || x.category_id || '')));
    for (const row of categoryRows) {
      const label = categoryName(row); if (!label) continue;
      const key = normalizeName(label); const id = categoryCache.get(key) || slug(label);
      if (!categoryCache.has(key)) {
        const data = { id, name_ar: label, name_en: String(row[categoryMapping.nameEn] || label), active: true, sort_order: Number(row[categoryMapping.sortOrder] || categoryCache.size + 1), source: 'excel', import_batch_id: batchId, created_at: new Date().toISOString(), created_by: s.user.id };
        updates[`product_categories/${id}`] = data;
        categoryCache.set(key, id);
        productCategoryIds.add(id);
      } else if (!productCategoryIds.has(String(id))) {
        updates[`product_categories/${id}`] = { id, name_ar: label, name_en: String(row[categoryMapping.nameEn] || label), active: true, updated_at: new Date().toISOString(), updated_by: s.user.id };
        productCategoryIds.add(String(id));
      }
    }
    let inserted = 0, skipped = 0, invalid = 0;
    rows.forEach((row) => { const item = {}; Object.entries(mapping).forEach(([source, target]) => { if (target) item[target] = row[source]; }); const rawCategory = String(item.category || item.category_name || item.categoryAr || '').trim(); if (rawCategory) { item.category_id = categoryCache.get(normalizeName(rawCategory)) || slug(rawCategory); delete item.category; delete item.category_name; delete item.categoryAr; } item.name_ar = item.name_ar || item.nameAr || ''; item.name_en = item.name_en || item.nameEn || ''; item.selling_price = Number(item.selling_price ?? item.sellingPrice ?? 0) || 0; delete item.nameAr; delete item.nameEn; delete item.sellingPrice; const name = nameOf(item); if (!name || !item.category_id) { invalid++; return; } const key = `${categoryOf(item)}|${name}`; if (seen.has(key)) { skipped++; return; } const id = push(ref(db, entity)).key; item.id = id; item.active = true; item.import_batch_id = batchId; item.source_filename = filename; item.created_at = new Date().toISOString(); item.created_by = s.user.id; updates[`${entity}/${id}`] = item; seen.add(key); inserted++; });
    const batch = { filename, sheet: sheet || 'Sheet1', entity, mapping, created_at: new Date().toISOString(), created_by: s.user.id, total_rows: rows.length, valid_rows: inserted + skipped, inserted_rows: inserted, skipped_rows: skipped, invalid_rows: invalid, status: 'COMPLETED' };
    updates[`imports/${batchId}`] = { id: batchId, ...batch }; await update(ref(db), updates); await api.logAudit('IMPORT', entity, batchId, batch); return { batchId, ...batch };
  },
  importAssetBatch: async ({ filename, sheet = 'ورقة1', rows = [] } = {}) => {
    const emulatorOnly = (typeof process !== 'undefined' && process.env.FIREBASE_EMULATOR_HOST) || (typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname));
    if (!emulatorOnly) throw new Error('استيراد الأصول التاريخية محصور ببيئة Emulator المحلية.');
    const s = await requirePermission('excel.import');
    if (!canManage(s)) throw new Error('غير مصرح باستيراد الأصول.');
    const batchRef = push(ref(db, 'imports'));
    const batchId = batchRef.key;
    const now = new Date().toISOString();
    const existing = await api.list('assets');
    const existingKeys = new Set(existing.map((row) => row.import_key).filter(Boolean));
    const updates = {};
    let inserted = 0, skipped = 0, invalid = 0;
    rows.forEach((row) => {
      const key = String(row.import_key || '').trim();
      const amount = Number(row.total);
      if (!key || !row.name || !Number.isFinite(amount)) { invalid++; return; }
      if (existingKeys.has(key)) { skipped++; return; }
      const id = push(ref(db, 'assets')).key;
      updates[`assets/${id}`] = {
        id,
        name: String(row.name).trim(),
        category: String(row.category || 'بنود تحتاج مراجعة').trim(),
        accounting_class: row.accounting_class || 'review',
        review_required: row.review_required === true || row.accounting_class === 'review',
        quantity: row.quantity == null ? null : Number(row.quantity),
        unit_price: row.unit_price == null ? null : Number(row.unit_price),
        total: amount,
        purchase_price: amount,
        purchase_date: row.purchase_date || null,
        notes: String(row.notes || '').trim(),
        source_filename: filename,
        source_sheet: sheet,
        source_row: Number(row.source_row),
        import_key: key,
        import_batch_id: batchId,
        owner_approval_note: row.owner_approval_note || null,
        status: 'active',
        created_at: now,
        created_by: s.user.id,
      };
      existingKeys.add(key);
      inserted++;
    });
    const batch = {
      id: batchId, filename, sheet, entity: 'assets', import_type: 'historical_asset_opening',
      total_rows: rows.length, valid_rows: inserted + skipped, inserted_rows: inserted,
      skipped_rows: skipped, invalid_rows: invalid, status: 'COMPLETED', created_at: now, created_by: s.user.id,
      owner_approval: { source_row: 36, amount: 6889000, note: 'اعتمد المالك الإجمالي المكتوب في E36 رغم اختلافه عن حاصل ضرب الكمية بالسعر؛ لا يُسجل الفرق كبند مستقل.' },
    };
    updates[`imports/${batchId}`] = batch;
    await update(ref(db), updates);
    await api.logAudit('IMPORT_ASSETS', 'assets', batchId, batch);
    return { batchId, ...batch };
  },
  importHistoricalBatch: async ({ filename, rows = [], excluded = false } = {}) => {
    const s = await requirePermission('excel.import');
    if (!canManage(s)) throw new Error('غير مصرح بالاستيراد التاريخي.');
    const existing = await api.list('historical_imports').catch(() => []);
    const existingKeys = new Set(existing.map((row) => row.import_key).filter(Boolean));
    const batchRef = push(ref(db, 'imports')); const batchId = batchRef.key; const now = new Date().toISOString(); const updates = {};
    let inserted = 0, skipped = 0, invalid = 0;
    for (const row of rows) {
      const key = String(row.import_key || '').trim();
      if (!key || !row.name || !Number.isFinite(Number(row.amount))) { invalid++; continue; }
      if (existingKeys.has(key)) { skipped++; continue; }
      const id = key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-120) || push(ref(db, 'historical_imports')).key;
      const item = withoutUndefined({ ...row, id, amount: Number(row.amount), import_batch_id: batchId, created_at: now, created_by: s.user.id, excluded_from_month_totals: row.duplicate_status !== 'clear', status: row.status || 'active' });
      updates[`historical_imports/${id}`] = item; existingKeys.add(key); inserted++;
    }
    const batch = { id: batchId, filename, entity: 'historical_imports', import_type: 'historical_finance_unified', total_rows: rows.length, inserted_rows: inserted, skipped_rows: skipped, invalid_rows: invalid, excluded, status: 'COMPLETED', created_at: now, created_by: s.user.id };
    updates[`imports/${batchId}`] = batch;
    await update(ref(db), updates); await api.logAudit('IMPORT_HISTORICAL_FINANCE', 'historical_imports', batchId, batch);
    return { batchId, ...batch };
  },
  updateHistoricalImport: async (id, patch = {}) => {
    const s = await requirePermission('excel.import'); if (!canManage(s)) throw new Error('غير مصرح بتعديل الاستيراد التاريخي.');
    const old = await api.get(`historical_imports/${id}`); if (!old) throw new Error('السجل التاريخي غير موجود.');
    const next = { ...old };
    const now = new Date().toISOString();
    if (Object.prototype.hasOwnProperty.call(patch, 'month')) {
      const month = patch.month == null || patch.month === '' ? null : String(patch.month);
      if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('الشهر غير صحيح.');
      next.month = month; next.accounting_month = month; next.month_source = patch.month_source || next.month_source || 'owner_default';
      next.without_month = !month; next.month_assigned_at = month ? now : null; next.month_assigned_by = month ? s.user.id : null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'accounting_class')) {
      const accountingClass = String(patch.accounting_class || 'review').trim();
      if (accountingClass !== 'review' && !historicalSupportedClasses.has(accountingClass)) throw new Error('التصنيف غير مدعوم بالنقل التاريخي.');
      next.accounting_class = accountingClass; next.classification_updated_at = now; next.classification_updated_by = s.user.id;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'proposed_category')) next.proposed_category = String(patch.proposed_category || '').trim();
    if (Object.prototype.hasOwnProperty.call(patch, 'asset_category_id')) next.asset_category_id = patch.asset_category_id == null || patch.asset_category_id === '' ? null : String(patch.asset_category_id);
    if (Object.prototype.hasOwnProperty.call(patch, 'notes')) next.notes = String(patch.notes || '').trim();
    next.review_required = classificationReviewState(next.accounting_class);
    next.classification_review_status = next.review_required ? 'needs_review' : 'approved';
    next.updated_at = now; next.updated_by = s.user.id;

    const [assets, expenses, purchases, establishmentCosts] = await Promise.all([
      api.list('assets').catch(() => []), api.list('expenses').catch(() => []), api.list('purchases').catch(() => []), api.list('establishment_costs').catch(() => []),
    ]);
    const existingDestinations = { assets, expenses, purchases, establishment_costs: establishmentCosts };
    const linkedEntries = Object.entries(existingDestinations).flatMap(([type, records]) => records.filter((record) => record.historical_import_id === id || record.source_id === id || (next.import_key && record.import_key === next.import_key)).map((record) => ({ type, record })));
    const destinationId = next.destination_id || linkedEntries.find(({ type }) => type === historicalDestinationMap[next.accounting_class])?.record.id || historicalDestinationId(id);
    const destinationType = historicalDestinationMap[next.accounting_class];
    const updates = {};
    for (const { type, record } of linkedEntries) {
      if (type === destinationType && record.id === destinationId) continue;
      updates[`${type}/${record.id}`] = { ...record, status: 'classified_elsewhere', deleted: true, classification_status: 'classified_elsewhere', archived_at: now, archived_by: s.user.id, updated_at: now, updated_by: s.user.id };
    }
    if (destinationType) {
      next.destination_type = destinationType; next.destination_id = destinationId;
      if (destinationType === 'assets') next.asset_id = destinationId;
      const existing = existingDestinations[destinationType].find((record) => record.id === destinationId) || linkedEntries.find(({ type }) => type === destinationType)?.record;
      updates[`${destinationType}/${destinationId}`] = historicalDestinationPayload({ historical: next, destinationType, id: destinationId, existing, session: s, now });
    } else {
      next.destination_type = null; next.destination_id = null; next.asset_id = null;
    }
    updates[`historical_imports/${id}`] = withoutUndefined(next);
    await update(ref(db), updates);
    await api.logAudit('HISTORICAL_IMPORT_UPDATED', 'historical_imports', id, { month: next.month || null, accounting_class: next.accounting_class, destination_type: next.destination_type || null, destination_id: next.destination_id || null, duplicate_status: next.duplicate_status || 'clear' });
    return next;
  },
  repairHistoricalDestinations: async () => {
    const s = await requirePermission('excel.import'); if (!canManage(s)) throw new Error('غير مصرح بإصلاح وجهات الاستيراد التاريخي.');
    const [historical, assets, expenses, purchases, establishmentCosts] = await Promise.all([
      api.list('historical_imports'), api.list('assets'), api.list('expenses').catch(() => []), api.list('purchases').catch(() => []), api.list('establishment_costs').catch(() => []),
    ]);
    const destinations = { assets, expenses, purchases, establishment_costs: establishmentCosts };
    const destinationByClass = { fixed_asset: 'assets', expense: 'expenses', supplies: 'expenses', purchase: 'purchases', setup_cost: 'establishment_costs' };
    const candidates = historical.filter((row) => {
      const destinationType = destinationByClass[row.accounting_class];
      if (row.status === 'void' || !destinationType) return false;
      // Duplicate review remains independent. A suspected duplicate must never
      // create a financial destination merely because its class is approved.
      if (['suspected', 'existing'].includes(row.duplicate_status)) return false;
      const expectedId = row.destination_id || (row.accounting_class === 'fixed_asset' ? row.asset_id : null) || historicalDestinationId(row.id);
      const linked = (destinations[destinationType] || []).find((item) => item.id === expectedId || item.historical_import_id === row.id || item.source_id === row.id || (row.import_key && item.import_key === row.import_key));
      return row.destination_type !== destinationType || row.destination_id !== expectedId || !linked || linked.deleted || linked.status === 'classified_elsewhere';
    });
    for (const row of candidates) await api.updateHistoricalImport(row.id, {});
    if (candidates.length) await api.logAudit('HISTORICAL_DESTINATIONS_REPAIRED', 'historical_imports', 'destination-links', { repaired: candidates.length });
    return { repaired: candidates.length, skipped_duplicate_review: historical.filter((row) => ['suspected', 'existing'].includes(row.duplicate_status) && destinationByClass[row.accounting_class]).length };
  },
  repairHistoricalAssets: async () => {
    const s = await requirePermission('excel.import'); if (!canManage(s)) throw new Error('غير مصرح بإصلاح روابط الأصول التاريخية.');
    const [historical, assets] = await Promise.all([api.list('historical_imports'), api.list('assets')]);
    const now = new Date().toISOString(); const updates = {}; let repaired = 0;
    historical.filter((row) => row.status !== 'void').forEach((row) => {
      const linked = findHistoricalAsset(assets, row);
      if (row.accounting_class === 'fixed_asset') {
        const assetId = linked?.id || row.asset_id || historicalAssetId(row.id);
        const asset = historicalAssetPayload({ historical: { ...row, asset_id: assetId }, assetId, existing: linked, session: s, now, status: 'active' });
        if (!linked || linked.status !== 'active' || linked.accounting_class !== row.accounting_class || linked.total !== asset.total || row.asset_id !== assetId) repaired++;
        updates[`assets/${assetId}`] = asset;
        if (row.asset_id !== assetId) updates[`historical_imports/${row.id}/asset_id`] = assetId;
      } else if (linked && linked.status !== 'classified_elsewhere') {
        repaired++; updates[`assets/${linked.id}/status`] = 'classified_elsewhere'; updates[`assets/${linked.id}/accounting_class`] = row.accounting_class || 'review'; updates[`assets/${linked.id}/updated_at`] = now; updates[`assets/${linked.id}/updated_by`] = s.user.id;
      }
    });
    for (const [path, value] of Object.entries(updates)) await set(ref(db, path), value);
    if (repaired) await api.logAudit('HISTORICAL_ASSETS_REPAIRED', 'historical_imports', 'asset-links', { repaired });
    return { repaired };
  },
  repairHistoricalClassificationState: async () => {
    const s = await requirePermission('excel.import'); if (!canManage(s)) throw new Error('غير مصرح بإصلاح حالة مراجعة التصنيف.');
    const rows = await api.list('historical_imports'); const updates = {}; const now = new Date().toISOString(); let repaired = 0;
    rows.filter((row) => row.status !== 'void').forEach((row) => {
      const reviewRequired = classificationReviewState(row.accounting_class);
      const reviewStatus = reviewRequired ? 'needs_review' : 'approved';
      if (row.review_required !== reviewRequired || row.classification_review_status !== reviewStatus) {
        updates[`historical_imports/${row.id}/review_required`] = reviewRequired;
        updates[`historical_imports/${row.id}/classification_review_status`] = reviewStatus;
        updates[`historical_imports/${row.id}/classification_updated_at`] = row.classification_updated_at || now;
        updates[`historical_imports/${row.id}/classification_updated_by`] = row.classification_updated_by || s.user.id;
        repaired++;
      }
    });
    for (const [path, value] of Object.entries(updates)) await set(ref(db, path), value);
    if (repaired) await api.logAudit('HISTORICAL_CLASSIFICATION_STATE_REPAIRED', 'historical_imports', 'classification-state', { repaired });
    return { repaired };
  },
  historicalImportSummary: async () => {
    await requirePermission('excel.import');
    const rows = await api.list('historical_imports');
    const active = rows.filter((row) => row.status !== 'void');
    const isDuplicate = (row) => row.duplicate_status === 'suspected' || row.duplicate_status === 'existing';
    const imported = active.filter((row) => !isDuplicate(row));
    const unresolved = imported.filter((row) => !row.month);
    const suspected = active.filter(isDuplicate);
    const fixedAssets = imported.filter((row) => row.accounting_class === 'fixed_asset');
    const purchases = imported.filter((row) => row.accounting_class === 'purchase');
    const setupMaterials = imported.filter((row) => ['setup_cost', 'supplies', 'expense'].includes(row.accounting_class));
    const total = (items) => items.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return { rows: active, withoutMonth: unresolved, suspected, imported, totals: { importedCount: imported.length, importedValue: total(imported), fixedAssetCount: fixedAssets.length, fixedAssetValue: total(fixedAssets), purchaseCount: purchases.length, purchaseValue: total(purchases), setupMaterialsCount: setupMaterials.length, setupMaterialsValue: total(setupMaterials), withoutMonthCount: unresolved.length, withoutMonthValue: total(unresolved), suspectedCount: suspected.length, suspectedValue: total(suspected) } };
  },
  auditCenterSnapshot: async () => {
    await requirePermission('audit.view');
    await requirePermission('excel.import');
    const readCollection = async (path) => {
      try {
        const snap = await get(ref(db, path));
        if (!snap.exists()) return { rows: [], denied: false };
        const value = snap.val();
        return { rows: Object.entries(value || {}).map(([id, row]) => ({ id, ...(row || {}) })), denied: false };
      } catch (error) {
        return { rows: [], denied: true, code: error?.code || 'READ_FAILED' };
      }
    };
    const paths = ['historical_imports', 'assets', 'expenses', 'purchases', 'establishment_costs', 'sales', 'cash_movements', 'inventory_movements', 'audit'];
    const loaded = Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await readCollection(path)])));
    const unavailable = paths.filter((path) => loaded[path].denied);
    return buildAuditSnapshot({
      historical: loaded.historical_imports.rows,
      assets: loaded.assets.rows,
      expenses: loaded.expenses.rows,
      purchases: loaded.purchases.rows,
      establishment_costs: loaded.establishment_costs.rows,
      sales: loaded.sales.rows,
      cash_movements: loaded.cash_movements.rows,
      inventory_movements: loaded.inventory_movements.rows,
      audit: loaded.audit.rows,
      unavailable,
    });
  },
  previewLegacyMonthlyImport: async (data) => {
    const s = await requirePermission('excel.import'); if (!canManage(s)) throw new Error('غير مصرح بالاستيراد.');
    const [summaries, expenses, advances, payroll] = await Promise.all([api.list('legacy_monthly_summaries'), api.list('expenses'), api.list('employee_advances'), api.list('payroll')]);
    const summaryKeys = new Set(summaries.map(x => `${x.import_type}|${x.date}`));
    const detailKeys = new Set([...expenses, ...advances].map(x => `${x.date}|${normalizeName(x.source_category || x.category_name || x.category)}|${normalizeName(x.source_details || x.description || x.details)}|${Number(x.amount)}`));
    const payrollKeys = new Set(payroll.map(x => `${x.import_month || x.month}|${normalizeName(x.employee_name || x.employee)}`));
    return { summary: data.sheets[0].rows.filter(x => summaryKeys.has(`${data.import_type}|${x.date}`)).length, details: data.sheets[1].rows.filter(x => detailKeys.has(`${x.date}|${normalizeName(x.source_category)}|${normalizeName(x.source_details)}|${Number(x.amount)}`)).length, payroll: data.sheets[2].rows.filter(x => payrollKeys.has(`${data.month}|${normalizeName(x.employee_name)}`)).length, available: true };
  },
  importLegacyMonthlyBatch: async (data) => {
    const s = await requirePermission('excel.import'); if (!canManage(s)) throw new Error('غير مصرح بالاستيراد.');
    const [summaries, expenses, advances, payroll] = await Promise.all([api.list('legacy_monthly_summaries'), api.list('expenses'), api.list('employee_advances'), api.list('payroll')]);
    const batchRef = push(ref(db, 'imports')), batchId = batchRef.key, now = new Date().toISOString(), updates = {};
    const summaryKeys = new Set(summaries.map(x => `${x.import_type}|${x.date}`));
    const detailKeys = new Set([...expenses, ...advances].map(x => `${x.date}|${normalizeName(x.source_category || x.category_name || x.category)}|${normalizeName(x.source_details || x.description || x.details)}|${Number(x.amount)}`));
    const payrollKeys = new Set(payroll.map(x => `${x.import_month || x.month}|${normalizeName(x.employee_name || x.employee)}`));
    let inserted = 0, skipped = 0, invalid = 0;
    const add = (entity, row, key, payload) => { if (!row.date && entity !== 'payroll') { invalid++; return; } if (!key || (entity === 'payroll' && payrollKeys.has(key)) || (entity !== 'payroll' && (entity === 'legacy_monthly_summaries' ? summaryKeys.has(key) : detailKeys.has(key)))) { skipped++; return; } const id = push(ref(db, entity)).key; updates[`${entity}/${id}`] = { id, ...payload, import_batch_id: batchId, source_filename: data.filename, source_sheet: payload.source_sheet, created_at: now, created_by: s.user.id }; if (entity === 'payroll') payrollKeys.add(key); else if (entity === 'legacy_monthly_summaries') summaryKeys.add(key); else detailKeys.add(key); inserted++; };
    data.sheets[0].rows.forEach(row => add('legacy_monthly_summaries', row, `${data.import_type}|${row.date}`, { ...row, import_type: data.import_type, import_month: data.month, source_sheet: 'ورقة1', carryover: data.carryover || null }));
    data.sheets[1].rows.forEach(row => { const valid = row.date && row.source_category && row.source_details && row.amount != null; if (!valid) { invalid++; return; } const isWithdrawal = normalizeName(row.source_category) === normalizeName('سحب موظف'); const entity = isWithdrawal ? 'employee_advances' : 'expenses'; const key = `${row.date}|${normalizeName(row.source_category)}|${normalizeName(row.source_details)}|${Number(row.amount)}`; add(entity, row, key, { date: row.date, amount: row.amount, category_name: row.source_category, description: row.source_details, details: row.source_details, source_category: row.source_category, source_details: row.source_details, legacy_type: isWithdrawal ? 'employee_withdrawal' : ['عصائر', 'حليب', 'حار'].includes(row.source_category) ? 'purchase' : 'expense', import_month: data.month, source_sheet: 'ورقة2' }); });
    data.sheets[2].rows.forEach(row => { if (!row.employee_name) { invalid++; return; } add('payroll', row, `${data.month}|${normalizeName(row.employee_name)}`, { ...row, import_month: data.month, month: data.month, source_sheet: 'ورقة3' }); });
    const batch = { id: batchId, filename: data.filename, import_type: data.import_type, month: data.month, sheets: { ورقة1: data.sheets[0].rows.length, ورقة2: data.sheets[1].rows.length, ورقة3: data.sheets[2].rows.length }, rows_total: data.sheets.reduce((n, x) => n + x.rows.length, 0), rows_inserted: inserted, rows_skipped: skipped, rows_invalid: invalid, created_at: now, created_by: s.user.id, status: 'COMPLETED' };
    updates[`imports/${batchId}`] = batch; await update(ref(db), updates); await api.logAudit('IMPORT', 'legacy_monthly_finance', batchId, batch); return { batchId, ...batch };
  },
  undoImport: async (batchId) => {
    const s = await requirePermission('imports.undo'); if (s?.user?.role !== 'super_admin') throw new Error('التراجع للسوبر أدمن فقط.'); const batchSnap = await get(ref(db, `imports/${batchId}`)); if (!batchSnap.exists()) throw new Error('دفعة الاستيراد غير موجودة.'); const entity = batchSnap.val().entity; const rows = await api.list(entity); const updates = {}; let removed = 0; rows.filter(x => x.import_batch_id === batchId).forEach(x => { if (x.id) { updates[`${entity}/${x.id}`] = null; removed++; } }); updates[`imports/${batchId}/status`] = 'UNDONE'; updates[`imports/${batchId}/undone_at`] = new Date().toISOString(); await update(ref(db), updates); await api.logAudit('UNDO_IMPORT', entity, batchId, { removed }); return removed;
  },
  login: async () => {
    try {
      const provider = new GoogleAuthProvider();
      const userCredential = await withAuthTimeout(signInWithPopup(auth, provider));
      return resolveSession(userCredential.user);
    } catch (err) {
      console.error('SESSION_FAILED', err);
      if (err.message === 'هذا الحساب موقوف.' || err.message === 'هذا الحساب غير مخول لاستخدام النظام.' || err.code === 'AUTH_TIMEOUT') throw err;
      throw new Error(err.code === 'auth/unauthorized-domain'
        ? 'تعذر بدء تسجيل الدخول من هذا العنوان المحلي. استخدم نطاقاً مصرحاً به أو أعد المحاولة.'
        : 'تعذر تسجيل الدخول. تحقق من الاتصال وإعدادات المصادقة ثم أعد المحاولة.');
    }
  },
  loginLocal: async (email, password) => {
    if (typeof window === 'undefined' || !['localhost', '127.0.0.1'].includes(window.location.hostname) || !import.meta.env.DEV) throw new Error('دخول الاختبار المحلي متاح أثناء التطوير المحلي فقط.');
    try {
      const userCredential = await withAuthTimeout(signInWithEmailAndPassword(auth, String(email || '').trim(), String(password || '')));
      return resolveSession(userCredential.user);
    } catch (err) {
      if (err.message === 'هذا الحساب موقوف.' || err.message === 'هذا الحساب غير مخول لاستخدام النظام.' || err.code === 'AUTH_TIMEOUT') throw err;
      throw new Error('تعذر دخول الاختبار المحلي. تحقق من بيانات مستخدم المحاكي.');
    }
  },

  logout: async () => {
    await signOut(auth);
    currentUserProfile = null;
    return true;
  },

  session: async () => {
    const user = await waitForAuthState();
    if (!user) return null;
    return resolveSession(user);
  },

  list: async (entity) => {
    await requireEntityPermission(entity, 'view');
    const snap = await get(ref(db, entity));
    if (!snap.exists()) return [];
    const data = snap.val();
    return Object.keys(data).map(key => ({ id: key, ...data[key] }));
  },
  subscribeCollection: (entity, onData, onError) => {
    let stopped = false;
    const unsubscribe = onValue(ref(db, entity), (snap) => {
      if (stopped) return;
      const value = snap.exists() ? snap.val() : {};
      onData(Object.keys(value || {}).map((id) => ({ id, ...value[id] })));
    }, (error) => { if (!stopped) onError?.(error); });
    return () => { stopped = true; if (typeof unsubscribe === 'function') unsubscribe(); };
  },
  subscribeEmployees: (onData, onError) => api.subscribeCollection('employees', onData, onError),
  subscribeSystemNotifications: ({ month = currentMonth(), onData, onError } = {}) => {
    let stopped = false; const unsubscribers = [];
    const scheduler = createDashboardRefreshScheduler({
      load: async () => {
        const [inventory, products, recipes, sales, operations, period] = await Promise.all([
          api.list('inventory_items').catch(() => []), api.list('products').catch(() => []), api.list('product_recipes').catch(() => []),
          api.list('sales').catch(() => []), api.list('inventory_operations').catch(() => []), api.get(`monthly_periods/${month}`).catch(() => null),
        ]);
        return buildSystemNotifications({ inventory, products, recipes, sales, operations, periods: period ? [period] : [], month });
      }, onData, onError,
    });
    ['inventory_items', 'products', 'product_recipes', 'sales', 'inventory_operations', `monthly_periods/${month}`].forEach((path) => {
      unsubscribers.push(onValue(ref(db, path), scheduler.schedule, () => scheduler.schedule()));
    });
    return () => { stopped = true; scheduler.dispose(); unsubscribers.forEach((unsubscribe) => { if (typeof unsubscribe === 'function') unsubscribe(); }); };
  },
  listPurchases: async (month = 'all') => {
    const [purchases, invoices] = await Promise.all([
      api.list('purchases'),
      api.list('purchase_invoices').catch(() => []),
    ]);
    return resolvePurchaseRows({ purchases, invoices, month });
  },
  listDebts: async (month = 'all') => {
   const [debts, payments, invoices] = await Promise.all([api.list('debts'), api.list('debt_payments').catch(() => []), api.list('purchase_invoices').catch(() => [])]);
    const expenses = await api.list('expenses').catch(() => []);
    const linked = invoices.filter((invoice) => !invoice.deleted && Number(invoice.remaining_amount ?? Number(invoice.total || 0) - Number(invoice.paid_amount || 0)) > 0).map((invoice) => ({ id: 'purchase:' + invoice.id, type: 'payable', party_type: 'trader', party_id: invoice.supplier_id || '', party_name: invoice.supplier_name || invoice.supplier || invoice.company_name || 'تاجر غير محدد', category: 'مشتريات', original_amount: Number(invoice.total || invoice.total_after_discount || 0), paid_amount: Number(invoice.paid_amount || 0), remaining_amount: Number(invoice.remaining_amount ?? 0), debt_date: invoice.date, due_date: invoice.due_date, month: invoice.month, source_type: 'purchase_invoice', source_id: invoice.id, source_key: 'purchase_invoice:' + invoice.id, notes: invoice.notes || '' }));
    linked.push(...expenses.filter((expense) => !expense.deleted && Number(expense.remaining_amount ?? 0) > 0).map((expense) => ({ id: 'expense:' + expense.id, type: 'payable', party_type: 'service', party_name: expense.party_name || expense.company_name || expense.supplier_name || expense.category_name || 'مصروف', category: expense.category_name || expense.category || 'مصروفات', original_amount: Number(expense.amount || expense.total || 0), paid_amount: Number(expense.paid_amount || 0), remaining_amount: Number(expense.remaining_amount || 0), debt_date: expense.date, due_date: expense.due_date, month: expense.month, source_type: 'expense', source_id: expense.id, source_key: 'expense:' + expense.id, notes: expense.notes || expense.description || '' })));
    const manualKeys = new Set(debts.map((debt) => debt.source_key).filter(Boolean));
    return resolveDebts({ debts: [...debts, ...linked.filter((row) => !manualKeys.has(row.source_key))], payments, month });
  },
  createDebt: async (payload = {}) => {
    const s = await requirePermission('debts.create');
    const amount = money(payload.original_amount ?? payload.amount);
    const type = payload.type === 'receivable' ? 'receivable' : 'payable';
    const date = payload.debt_date || payload.date || new Date().toISOString().slice(0, 10);
    const month = payload.month || getRecordMonth({ date }) || currentMonth();
    if (amount <= 0 || !String(payload.party_name || '').trim()) throw new Error('الجهة والمبلغ مطلوبان.');
    await checkMonthOpen(month);
    const itemRef = push(ref(db, 'debts')); const now = new Date().toISOString();
    const item = withoutUndefined({ id: itemRef.key, type, party_type: payload.party_type || 'other', party_id: payload.party_id || '', party_name: String(payload.party_name).trim(), phone: payload.phone || '', category: payload.category || 'أخرى', original_amount: amount, paid_amount: 0, remaining_amount: amount, debt_date: date, due_date: payload.due_date || '', status: 'unpaid', description: payload.description || '', notes: payload.notes || '', source_type: payload.source_type || 'manual_' + type, source_id: payload.source_id || '', source_key: payload.source_key || `manual_debt:${itemRef.key}`, month, created_at: now, created_by: s.user.id, updated_at: now, updated_by: s.user.id });
    await update(ref(db), { [`debts/${item.id}`]: item, [`audit/debt_${item.id}`]: { action: 'DEBT_CREATED', entity: 'debts', entity_id: item.id, amount, source: item.source_type, created_at: now, created_by: s.user.id } });
    return item;
  },
  settleDebt: async ({ debt_id, amount, payment_method = 'cash', cash_account_id = 'cashier', date, month, notes = '', operation_key } = {}) => {
    const s = await requirePermission('debts.settle');
    const linkedId = String(debt_id || '').startsWith('purchase:') ? String(debt_id).slice(9) : '';
    if (linkedId) return api.payTraderInvoice({ invoice_id: linkedId, amount, payment_method, cash_account_id, date, notes, operation_key });
    const debtRef = ref(db, `debts/${debt_id}`); const storedDebt = await api.get(`debts/${debt_id}`);
    const linkedExpenseId = String(debt_id || '').startsWith('expense:') ? String(debt_id).slice(8) : '';
    const linkedExpense = linkedExpenseId ? await api.get(`expenses/${linkedExpenseId}`) : null;
    const initial = storedDebt || (linkedExpense ? { id: debt_id, type: 'payable', original_amount: linkedExpense.amount, paid_amount: linkedExpense.paid_amount || 0, remaining_amount: linkedExpense.remaining_amount || 0, status: linkedExpense.payment_status || 'partial', source_type: 'expense', source_id: linkedExpense.id, month: linkedExpense.month } : null);
    if (!initial) throw new Error('الدين غير موجود.');
    const linkedExpenseFromDebt = initial.source_type === 'expense' && !linkedExpense ? await api.get(`expenses/${initial.source_id}`) : linkedExpense;
    if (initial.source_type === 'expense' && !linkedExpenseFromDebt) throw new Error('المصروف المرتبط بالدين غير موجود.');
    const value = money(amount); if (value <= 0) throw new Error('مبلغ التسوية غير صحيح.');
    const resolvedMonth = month || getRecordMonth({ date }) || currentMonth(); await checkMonthOpen(resolvedMonth);
    const key = operationKeyFor('debt_settlement', operation_key); const now = new Date().toISOString(); const paymentRef = push(ref(db, 'debt_payments')); let claimed = null;
    const current = storedDebt || initial; const remaining = Math.max(0, Number(current.remaining_amount ?? debtAmount(current) - debtPaid(current)));
    if (current.settlement_operations?.[key]) return { ok: true, already_processed: true, operation_key: key, existing_id: current.settlement_operations[key].id };
    if (value > remaining) throw new Error('مبلغ التسوية يتجاوز الرصيد المتبقي.');
    const claim = await claimOperation('debt_settlement_operations', key, { id: paymentRef.key, debt_id, amount: value, operation_key: key, status: 'pending', created_at: now, created_by: s.user.id });
    if (!claim.committed) return { ok: true, already_processed: true, operation_key: key, existing_id: claim.operation?.id || null };
    const nextRemaining = remaining - value;
    const payment = withoutUndefined({ id: paymentRef.key, debt_id, type: current.type, amount: value, date: date || now.slice(0, 10), month: resolvedMonth, payment_method, cash_account_id, notes, operation_key: key, created_at: now, created_by: s.user.id });
    const updates = {
      ...(!linkedExpenseFromDebt || storedDebt ? {
        [`debts/${debt_id}/paid_amount`]: Number(current.paid_amount || 0) + value,
        [`debts/${debt_id}/remaining_amount`]: nextRemaining,
        [`debts/${debt_id}/status`]: nextRemaining === 0 ? 'paid' : 'partial',
        [`debts/${debt_id}/updated_at`]: now,
        [`debts/${debt_id}/updated_by`]: s.user.id,
        [`debts/${debt_id}/settlement_operations/${key}`]: { id: payment.id, amount: value, status: 'completed', completed_at: now },
      } : {}),
      [`debt_payments/${payment.id}`]: payment,
      [`debt_settlement_operations/${key}/status`]: 'completed',
      [`debt_settlement_operations/${key}/completed_at`]: now,
      [`audit/debt_settlement_${key}`]: { action: 'DEBT_SETTLEMENT_CREATED', entity: 'debt_payments', entity_id: payment.id, debt_id, amount: value, created_at: now, created_by: s.user.id },
    };
    if (linkedExpenseFromDebt) {
      const paid = money(Number(linkedExpenseFromDebt.paid_amount || 0) + value);
      const remaining = Math.max(0, money(linkedExpenseFromDebt.amount) - paid);
      updates[`expenses/${linkedExpenseFromDebt.id}`] = withoutUndefined({ ...linkedExpenseFromDebt, paid_amount: paid, remaining_amount: remaining, payment_status: remaining === 0 ? 'paid' : 'partial', updated_at: now, updated_by: s.user.id });
    }
    if (isCashMethod(payment_method)) { const cashRef = push(ref(db, 'cash_movements')); updates[`cash_movements/${cashRef.key}`] = { id: cashRef.key, type: current.type === 'receivable' ? 'IN' : 'OUT', amount: value, cash_account_id, date: payment.date, month: resolvedMonth, payment_method: 'cash', source_type: 'debt_settlement', source_id: payment.id, source_key: `debt_settlement:${key}`, operation_key: key, created_at: now, created_by: s.user.id }; }
    await update(ref(db), updates); return payment;
  },
  get: async (path) => { const snap = await get(ref(db, path)); return snap.exists() ? snap.val() : null; },

  dashboardPins: async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return [];
    const value = await api.get(`users/${uid}/dashboard_pins`);
    return Array.isArray(value) ? value.slice(0, 4) : Object.values(value || {}).slice(0, 4);
  },
  subscribeDashboardData: (selectedMonth, onData, onError) => {
    let stopped = false;
    const unsubscribers = [];
    const scheduler = createDashboardRefreshScheduler({
      load: () => api.dashboard(selectedMonth),
      onData,
      onError,
    });

    api.session().then((session) => {
      if (stopped) return;
      const canReadOtherIncome = ['super_admin', 'supervisor'].includes(session?.user?.role)
        || hasPermission(session, 'other_income.view')
        || hasPermission(session, 'financial.view_revenue');
      const canReadPayroll = hasPermission(session, 'payroll.view');
      const canReadPayrollCost = ['super_admin', 'supervisor'].includes(session?.user?.role)
        || hasPermission(session, 'financial.view_payroll_cost');
      const paths = [
        'sales', 'purchases', 'purchase_invoices', 'expenses', 'legacy_monthly_summaries',
        ...(canReadOtherIncome ? ['other_income'] : []),
        ...(canReadPayrollCost ? ['legacy_payroll_costs'] : []),
        ...(canReadPayroll ? ['payroll', 'payroll_adjustments', 'payroll_payments', 'employee_advances'] : []),
        ...(hasPermission(session, 'cash_movements.view') ? ['cash_movements'] : []),
      ];
      paths.forEach((path) => {
        const unsubscribe = onValue(ref(db, path), scheduler.schedule, (error) => {
          // Optional dashboard sources can be denied independently.  A fresh
          // dashboard read already degrades those sources to an empty set, so
          // do not replace a healthy dashboard with an error state.
          if (!stopped) console.warn('DASHBOARD_SUBSCRIPTION_SOURCE_UNAVAILABLE', path, error?.code || error?.message);
          scheduler.schedule();
        });
        unsubscribers.push(unsubscribe);
      });
    }).catch((error) => { if (!stopped) onError?.(error); });

    return () => {
      stopped = true;
      scheduler.dispose();
      unsubscribers.forEach((unsubscribe) => { if (typeof unsubscribe === "function") unsubscribe(); });
    };
  },
  subscribeInventoryData: (onData, onError) => {
    let stopped = false;
    const unsubscribers = [];
    const scheduler = createDashboardRefreshScheduler({
      load: async () => {
        const [items, movements, categories, batches, locations, sales, recipes, products] = await Promise.all([
          api.list('inventory_items'),
          api.list('inventory_movements').catch(() => []),
          api.list('inventory_categories'),
          api.list('inventory_batches').catch(() => []),
          api.list('inventory_locations').catch(() => []),
          api.list('sales').catch(() => []),
          api.list('product_recipes').catch(() => []),
          api.list('products').catch(() => []),
        ]);
        return { items, movements, categories, batches, locations, sales, recipes, products };
      },
      onData,
      onError,
    });
    ['inventory_items', 'inventory_movements', 'inventory_categories', 'inventory_batches', 'inventory_locations', 'sales', 'product_recipes', 'products'].forEach((path) => {
      unsubscribers.push(onValue(ref(db, path), scheduler.schedule, (error) => {
        if (!stopped) console.warn('INVENTORY_SUBSCRIPTION_SOURCE_UNAVAILABLE', path, error?.code || error?.message);
        scheduler.schedule();
      }));
    });
    return () => {
      stopped = true;
      scheduler.dispose();
      unsubscribers.forEach((unsubscribe) => { if (typeof unsubscribe === "function") unsubscribe(); });
    };
  },
  saveDashboardPins: async (pins) => {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('جلسة المستخدم غير متاحة.');
    if ([...new Set(pins)].length > 4) throw new Error('يمكن تثبيت 4 أقسام فقط');
    const next = [...new Set(pins)];
    await set(ref(db, `users/${uid}/dashboard_pins`), next);
    return next;
  },
  closeMonth: async (month, { actual_counted_cash, notes = '' } = {}) => {
    const s = await requirePermission('monthly_periods.close');
    if (!['super_admin', 'manager'].includes(s?.user?.role)) throw new Error('إغلاق الشهر متاح للمدير أو السوبر أدمن.');
    const review = await api.monthCloseReview(month);
    if (review.some((item) => item.severity === 'BLOCKING')) throw Object.assign(new Error('لا يمكن إغلاق الشهر قبل معالجة البنود المانعة.'), { code: 'MONTH_CLOSE_BLOCKED', review });
    const next = nextMonth(month); const current = await api.get(`monthly_periods/${month}`); const nextPeriod = await api.get(`monthly_periods/${next}`);
    if (current?.status === 'closed') return { ...current, next_month: next, already_closed: true };
    if (nextPeriod?.status === 'closed') throw new Error('الشهر التالي مغلق بالفعل ولا يمكن الانتقال إليه تلقائياً.');
    let cashClose = await api.get(`cash_month_closings/${month}`);
    if (cashClose?.status !== 'closed') {
      const actual = Number(actual_counted_cash);
      if (!Number.isFinite(actual) || actual < 0) throw Object.assign(new Error('أدخل الرصيد النقدي المؤكد لإغلاق الشهر وترحيله.'), { code: 'CASH_CLOSE_REQUIRED' });
      cashClose = await api.closeCashMonth({ month, actual_counted_cash: actual, confirm: true, notes });
    }
    const carried = Number(cashClose.carried_forward_cash ?? cashClose.actual_cash);
    if (!Number.isFinite(carried) || carried < 0) throw new Error('تعذر تأكيد الرصيد المرحّل من إغلاق الصندوق.');
    await api.carryForwardMonth({ sourceMonth: month, targetMonth: next, sourceClosingCash: carried, actor: s.user.id });
    const now = new Date().toISOString();
    const payload = { ...(current || {}), status: 'closed', month, closed_at: now, closed_by: s.user.id, review_snapshot: review };
     await update(ref(db), { [`monthly_periods/${month}`]: payload, [`monthly_periods/${next}`]: { month: next, status: 'open', opened_from_month: month, opened_at: now, opened_by: s.user.id } });
    await api.logAudit('MONTH_CLOSED', 'monthly_periods', month, { ...payload, next_month: next }); return { ...payload, next_month: next, cash_close: cashClose };
  },
  reopenMonth: async (month, reason = '') => {
    const s = await requirePermission('monthly_periods.reopen');
    if (s?.user?.role !== 'super_admin') throw new Error('إعادة فتح الشهر للسوبر أدمن فقط.');
    const explanation = String(reason || '').trim();
    if (!explanation) throw new Error('اذكر سبب إعادة فتح الشهر قبل المتابعة.');
    const payload = { status: 'open', month, reopened_at: new Date().toISOString(), reopened_by: s.user.id, reopen_reason: explanation };
    await set(ref(db, `monthly_periods/${month}`), payload); await api.logAudit('MONTH_REOPENED', 'monthly_periods', month, payload); return payload;
  },
  startNewMonth: async (targetMonth, previousMonth) => {
    const s = await requirePermission('monthly_periods.close');
    if (!['super_admin', 'manager'].includes(s?.user?.role)) throw new Error('بدء شهر جديد متاح للمدير أو السوبر أدمن.');
    if (!targetMonth) throw new Error('الشهر الجديد غير محدد.');
    const targetPeriod = await api.get(`monthly_periods/${targetMonth}`);
    if (targetPeriod) throw new Error('الشهر الجديد موجود مسبقاً.');

    // If the previous month is not closed, its cash will NOT be carried forward automatically here.
    // Carry forward is exclusively handled by `closeMonth`. This preserves idempotency and prevents duplicates.
    const now = new Date().toISOString();
    const payload = { status: 'open', month: targetMonth, opened_at: now, opened_by: s.user.id, opened_from_month: previousMonth || '' };
    await set(ref(db, `monthly_periods/${targetMonth}`), payload);
    await api.logAudit('MONTH_STARTED', 'monthly_periods', targetMonth, payload);
    return payload;
  },

  // Read-only review used by the closing screen.  It never infers profit from
  // physical cash and excludes internal transfers from cash-in/out totals.
  cashMonthReview: async (month) => {
    const s = await requirePermission('cash.view');
    const [accounts, movements, reconciliation, closing, opening] = await Promise.all([
      api.list('cash_accounts').catch(() => []), api.list('cash_movements').catch(() => []),
      api.get(`cash_reconciliations/${month}`).catch(() => null), api.get(`cash_month_closings/${month}`).catch(() => null), api.get(`cash_month_openings/${month}`).catch(() => null),
    ]);
    return { ...getCashMonthSummary({ month, accounts, movements, reconciliation, closing: { ...closing, opening_cash: opening?.opening_cash ?? closing?.opening_cash ?? 0 } }), accounts, reconciliation, closing, opening, requested_by: s.user.id };
  },

  monthCloseReview: async (month) => {
    const s = await requirePermission('monthly_periods.view');
    const [sales, movements, inventory, payroll, debts, invoices, stockOperations] = await Promise.all([
      api.list('sales').catch(() => []), api.list('cash_movements').catch(() => []), api.list('inventory_items').catch(() => []),
      api.list('payroll').catch(() => []), api.listDebts('all').catch(() => []), api.list('purchase_invoices').catch(() => []), api.list('inventory_operations').catch(() => []),
    ]);
    return buildMonthCloseReview({ month, sales: recordsForMonth(sales, month), movements: recordsForMonth(movements, month), inventory, payroll, debts, invoices, stockOperations, requested_by: s.user.id });
  },

  createCashAccount: async ({ id, name, type = 'cashier', opening_balance = 0, active = true }) => {
    const s = await requirePermission('cash.transfer');
    const key = String(id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-');
    if (!key || !String(name || '').trim() || !['cashier', 'safe', 'other'].includes(type)) throw new Error('بيانات الحساب النقدي غير صحيحة.');
    const existing = await api.get(`cash_accounts/${key}`);
    if (existing) throw new Error('معرّف الحساب النقدي مستخدم مسبقاً.');
    const item = { id: key, name: String(name).trim(), type, active: active !== false, opening_balance: money(opening_balance), created_at: new Date().toISOString(), created_by: s.user.id };
    await set(ref(db, `cash_accounts/${key}`), item);
    await api.logAudit('CASH_ACCOUNT_CREATED', 'cash_accounts', key, item);
    return item;
  },

  transferCash: async ({ from_account_id, to_account_id, amount, date, month, notes = '' }) => {
    const s = await requirePermission('cash.transfer');
    const value = money(amount);
    if (!from_account_id || !to_account_id || from_account_id === to_account_id || value <= 0) throw new Error('بيانات التحويل النقدي غير صحيحة.');
    const resolvedMonth = month || getRecordMonth({ date }) || currentMonth(); await checkMonthOpen(resolvedMonth);
    const [from, to, movements] = await Promise.all([api.get(`cash_accounts/${from_account_id}`), api.get(`cash_accounts/${to_account_id}`), api.list('cash_movements')]);
    if (!from || !to || from.active === false || to.active === false) throw new Error('حساب النقد غير متاح.');
    const balances = getCashMonthSummary({ month: 'all', accounts: [from, to], movements, closing: {} }).accountBalances;
    if ((balances[from_account_id] || 0) < value) throw new Error('رصيد الحساب المصدر لا يكفي للتحويل.');
    const transferRef = push(ref(db, 'cash_transfers')); const outRef = push(ref(db, 'cash_movements')); const inRef = push(ref(db, 'cash_movements')); const now = new Date().toISOString();
    const transfer = { id: transferRef.key, from_account_id, to_account_id, amount: value, date: date || now.slice(0, 10), month: resolvedMonth, notes: String(notes), created_at: now, created_by: s.user.id };
    const updates = {
      [`cash_transfers/${transferRef.key}`]: transfer,
      [`cash_movements/${outRef.key}`]: { id: outRef.key, type: 'OUT', amount: value, cash_account_id: from_account_id, date: transfer.date, month: resolvedMonth, internal_transfer: true, source_type: 'cash_transfer', source_id: transferRef.key, source_key: `cash_transfer:${transferRef.key}:out`, created_at: now, created_by: s.user.id },
      [`cash_movements/${inRef.key}`]: { id: inRef.key, type: 'IN', amount: value, cash_account_id: to_account_id, date: transfer.date, month: resolvedMonth, internal_transfer: true, source_type: 'cash_transfer', source_id: transferRef.key, source_key: `cash_transfer:${transferRef.key}:in`, created_at: now, created_by: s.user.id },
    };
    await update(ref(db), updates); await api.logAudit('CASH_TRANSFER_CREATED', 'cash_transfers', transferRef.key, transfer); return transfer;
  },

  reconcileCash: async ({ month, actual_counted_cash, reason = '', notes = '' }) => {
    const s = await requirePermission('cash.reconcile'); await checkMonthOpen(month);
    const review = await api.cashMonthReview(month); const actual = money(actual_counted_cash);
    const difference = actual - review.expectedClosingCash;
    if (difference !== 0 && !String(reason).trim()) throw new Error('سبب الفرق مطلوب عند وجود عجز أو زيادة.');
    const now = new Date().toISOString(); const item = { id: month, month, expected_cash: review.expectedClosingCash, actual_counted_cash: actual, difference, reason: String(reason).trim(), notes: String(notes).trim(), reconciled_at: now, reconciled_by: s.user.id };
    await set(ref(db, `cash_reconciliations/${month}`), item); await api.logAudit('CASH_RECONCILED', 'cash_reconciliations', month, item); return item;
  },

  createOwnerWithdrawal: async ({ amount, cash_account_id = 'cashier', date, month, notes = '' }) => {
    const s = await requirePermission('cash.owner_withdrawal'); const value = money(amount);
    const resolvedMonth = month || getRecordMonth({ date }) || currentMonth(); await checkMonthOpen(resolvedMonth);
    if (value <= 0) throw new Error('مبلغ سحب صاحب الكوفي يجب أن يكون أكبر من صفر.');
    const account = await api.get(`cash_accounts/${cash_account_id}`); if (!account || account.active === false) throw new Error('حساب النقد غير متاح.');
    const movements = await api.list('cash_movements'); const balance = getCashMonthSummary({ month: 'all', accounts: [account], movements, closing: {} }).accountBalances[cash_account_id] || 0;
    if (balance < value) throw new Error('رصيد الحساب لا يكفي للسحب.');
    const withdrawalRef = push(ref(db, 'owner_withdrawals')); const movementRef = push(ref(db, 'cash_movements')); const now = new Date().toISOString();
    const item = { id: withdrawalRef.key, amount: value, cash_account_id, date: date || now.slice(0, 10), month: resolvedMonth, notes: String(notes), created_at: now, created_by: s.user.id };
    await update(ref(db), { [`owner_withdrawals/${withdrawalRef.key}`]: item, [`cash_movements/${movementRef.key}`]: { id: movementRef.key, type: 'OUT', amount: value, cash_account_id, date: item.date, month: resolvedMonth, reason: 'Owner withdrawal', source_type: 'owner_withdrawal', source_id: item.id, source_key: `owner_withdrawal:${item.id}`, created_at: now, created_by: s.user.id } });
    await api.logAudit('OWNER_WITHDRAWAL_CREATED', 'owner_withdrawals', item.id, item); return item;
  },

  createOwnerDeposit: async ({ amount, cash_account_id = 'cashier', date, month, notes = '' }) => {
    const s = await requirePermission('cash.owner_deposit'); const value = money(amount);
    if (value <= 0) throw new Error('مبلغ إيداع صاحب الكوفي يجب أن يكون أكبر من صفر.');
    const resolvedMonth = month || getRecordMonth({ date }) || currentMonth(); await checkMonthOpen(resolvedMonth);
    const account = await api.get(`cash_accounts/${cash_account_id}`); if (!account || account.active === false) throw new Error('حساب النقد غير متاح.');
    const operationRef = push(ref(db, 'owner_deposits')); const movementRef = push(ref(db, 'cash_movements')); const now = new Date().toISOString();
    const item = { id: operationRef.key, amount: value, cash_account_id, date: date || now.slice(0, 10), month: resolvedMonth, notes: String(notes), created_at: now, created_by: s.user.id };
    await update(ref(db), { [`owner_deposits/${operationRef.key}`]: item, [`cash_movements/${movementRef.key}`]: { id: movementRef.key, type: 'IN', amount: value, cash_account_id, date: item.date, month: resolvedMonth, reason: 'Owner deposit', source_type: 'owner_deposit', source_id: item.id, source_key: `owner_deposit:${item.id}`, payment_method: 'cash', created_at: now, created_by: s.user.id } });
    await api.logAudit('OWNER_DEPOSIT_CREATED', 'owner_deposits', item.id, item); return item;
  },

  openCashierShift: async ({ opening_cash = 0, note = '', month = currentMonth() } = {}) => {
    const s = await requirePermission('shifts.open'); await checkMonthOpen(month); const cashierUid = s.user.id;
    const shifts = await api.list('cashier_shifts').catch(() => []);
    if (shifts.some((row) => row.cashier_uid === cashierUid && row.status === 'open')) throw new Error('لديك وردية مفتوحة بالفعل.');
    const now = new Date().toISOString(); const shiftRef = push(ref(db, 'cashier_shifts'));
    const item = { id: shiftRef.key, cashier_uid: cashierUid, cashier_name: s.user.name || '', opened_at: now, opening_cash: money(opening_cash), opened_by: cashierUid, status: 'open', note: String(note), month };
    await set(shiftRef, item); await api.logAudit('SHIFT_OPENED', 'cashier_shifts', item.id, item); return item;
  },

  closeCashierShift: async ({ shift_id, actual_cash, denomination_counts = {}, explanation = '' } = {}) => {
    const s = await requirePermission('shifts.close'); const shift = await api.get(`cashier_shifts/${shift_id}`);
    if (!shift || shift.status !== 'open') return { ...shift, idempotent: true };
    if (!['super_admin', 'manager'].includes(s.user.role) && shift.cashier_uid !== s.user.id) throw new Error('لا يمكنك إغلاق وردية مستخدم آخر.');
    const movements = await api.list('cash_movements').catch(() => []); const start = String(shift.opened_at || '').slice(0, 19);
    const net = movements.filter((row) => !row.deleted && !row.internal_transfer && row.created_at >= start && (row.cashier_uid === shift.cashier_uid || row.created_by === shift.cashier_uid)).reduce((n, row) => n + (row.type === 'IN' ? Number(row.amount || 0) : -Number(row.amount || 0)), 0);
    const expected = Number(shift.opening_cash || 0) + net; const counted = actual_cash == null ? countCashDenominations(denomination_counts) : money(actual_cash); const now = new Date().toISOString();
    const item = { ...shift, expected_cash: expected, actual_cash: counted, difference: counted - expected, denomination_counts, closed_at: now, closed_by: s.user.id, explanation: String(explanation), status: 'closed' };
    const committed = await runTransaction(ref(db, `cashier_shifts/${shift_id}`), (current) => current?.status === 'open' ? item : undefined);
    if (!committed.committed) return { ...(committed.snapshot.val() || shift), idempotent: true };
    await api.logAudit('SHIFT_CLOSED', 'cashier_shifts', shift_id, item); return item;
  },

  closeCashMonth: async ({ month, actual_counted_cash, confirm = false, notes = '' }) => {
    const s = await requirePermission('cash.close_month'); if (!confirm) throw new Error('يلزم تأكيد واضح لإغلاق الشهر.');
    const existing = await api.get(`cash_month_closings/${month}`); if (existing?.status === 'closed') return { ...existing, idempotent: true };
    const review = await api.cashMonthReview(month);
    const reconciliation = await api.reconcileCash({ month, actual_counted_cash, reason: notes || 'مطابقة إغلاق الشهر', notes }); const now = new Date().toISOString();
    const next = nextMonth(month);
    const item = { id: month, month, status: 'closed', opening_cash: review.openingCash, expected_cash: reconciliation.expected_cash, actual_cash: reconciliation.actual_counted_cash, difference: reconciliation.difference, carried_forward_cash: reconciliation.actual_counted_cash, closed_at: now, closed_by: s.user.id };
    const carry = await api.carryForwardMonth({ sourceMonth: month, targetMonth: next, sourceClosingCash: item.carried_forward_cash, actor: s.user.id });
    await update(ref(db), { [`cash_month_closings/${month}`]: item, [`cash_month_openings/${next}`]: carry });
    await api.logAudit('CASH_MONTH_CLOSED', 'cash_month_closings', month, item); return item;
  },

  carryForwardMonth: async ({ sourceMonth, targetMonth = nextMonth(sourceMonth), sourceClosingCash, actor, idempotencyKey } = {}) => {
    const s = await requirePermission('cash.close_month');
    if (!sourceMonth || !targetMonth || sourceMonth === targetMonth) throw new Error('فترة الترحيل غير صحيحة.');
    const amount = money(sourceClosingCash, 'الرصيد المرحّل');
    const key = String(idempotencyKey || `carry-forward:${targetMonth}`).replace(/[.#$\[\]/]/g, '_');
    const carry = buildCashCarryForward({ sourceMonth, targetMonth, closingCash: amount, actor: actor || s.user.id });
    const before = await get(ref(db, `cash_carry_forwards/${targetMonth}`));
    if (before.exists()) return { ...before.val(), idempotent: true };
    const claim = await runTransaction(ref(db, `cash_carry_forwards/${targetMonth}`), (existing) => existing || { ...carry, idempotency_key: key, status: 'pending' });
    const existing = claim.snapshot.val();
    if (!claim.committed) return { ...existing, idempotent: true };
    try {
      const applied = { ...existing, status: 'applied', applied_at: new Date().toISOString() };
      await update(ref(db), { [`cash_carry_forwards/${targetMonth}`]: applied, [`cash_month_openings/${targetMonth}`]: applied });
      await api.logAudit('CASH_CARRY_FORWARD_APPLIED', 'cash_carry_forwards', targetMonth, applied);
      return applied;
    } catch (error) {
      await update(ref(db, `cash_carry_forwards/${targetMonth}`), { status: 'recovery_required', error: String(error.message || error) }).catch(() => null);
      throw error;
    }
  },

  accountReview: async (month = currentMonth()) => {
    await requirePermission('account_review.view');
    const [sales, inventory, cashMovements, debts, payroll, shifts, stockOperations] = await Promise.all([
      api.list('sales').catch(() => []), api.list('inventory_items').catch(() => []), api.list('cash_movements').catch(() => []), api.listDebts('all').catch(() => []), api.list('payroll').catch(() => []), api.list('cashier_shifts').catch(() => []), api.list('inventory_operations').catch(() => [])
    ]);
    return buildAccountReview({ sales, inventory, cashMovements, debts, payroll, shifts, stockOperations, month });
  },

  reviewPayment: async ({ saleId, paymentMethod, reason } = {}) => {
    const s = await requirePermission('payment_review.edit');
    const explanation = String(reason || '').trim();
    const method = normalizePaymentMethod(paymentMethod);
    if (!saleId || !method || !explanation) throw new Error('طريقة الدفع وسبب التصحيح مطلوبان.');
    const sale = await api.get(`sales/${saleId}`); if (!sale) throw new Error('عملية البيع غير موجودة.');
    await checkMonthOpen(getRecordMonth(sale));
    const oldMethod = resolvePaymentMethod(sale.payment_method);
    if (oldMethod === method) return sale;
    const now = new Date().toISOString();
    const updates = { [`sales/${saleId}/payment_method`]: method, [`sales/${saleId}/payment_review`]: { from: oldMethod || 'missing', to: method, reason: explanation, actor: s.user.id, timestamp: now } };
    const movements = await api.list('cash_movements').catch(() => []);
    const linked = movements.find((row) => !row.deleted && row.source_type === 'sale' && row.source_id === saleId);
    if (method === 'cash' && !linked) {
      const id = `payment_review_${String(saleId).replace(/[.#$\[\]/]/g, '_')}`;
      updates[`cash_movements/${id}`] = { id, type: 'IN', amount: getSalesTransactionNet(sale), cash_account_id: sale.cash_account_id || 'cashier', date: sale.date || now.slice(0, 10), month: getRecordMonth(sale), payment_method: 'cash', source_type: 'sale', source_id: saleId, source_key: `sale:${saleId}`, payment_review_id: saleId, created_at: now, created_by: s.user.id };
    } else if (method === 'electronic' && linked) {
      const reversalId = `payment_review_reversal_${String(saleId).replace(/[.#$\[\]/]/g, '_')}`;
      updates[`cash_movements/${linked.id}/deleted`] = true;
      updates[`cash_movements/${linked.id}/reversed_at`] = now;
      updates[`cash_movements/${linked.id}/reversal_reason`] = explanation;
      updates[`cash_movements/${reversalId}`] = { id: reversalId, type: 'OUT', amount: Number(linked.amount || 0), cash_account_id: linked.cash_account_id || 'cashier', date: sale.date || now.slice(0, 10), month: getRecordMonth(sale), payment_method: 'cash', source_type: 'payment_review_reversal', source_id: saleId, source_key: `payment_review_reversal:${saleId}`, reversal_of: linked.id, created_at: now, created_by: s.user.id };
    }
    await update(ref(db), updates); await api.logAudit('PAYMENT_METHOD_REVIEWED', 'sales', saleId, { from: oldMethod || 'missing', to: method, reason: explanation, actor: s.user.id, timestamp: now });
    return { ...sale, payment_method: method, payment_review: updates[`sales/${saleId}/payment_review`] };
  },

  createPurchaseInvoice: async ({ invoice_number, supplier_id, supplier_name = '', date, month, items, discount = 0, paid_amount = 0, payment_method = 'cash', due_date = '', notes = '', operation_id, operation_key }) => {
    const s = await requirePermission('purchase_invoices.create');
    if (!invoice_number || !supplier_id || !Array.isArray(items) || !items.length) throw new Error('رقم الفاتورة والتاجر وبنود الفاتورة مطلوبة.');
    const safeItems = items.map((item) => withoutUndefined({ ...item, quantity: Number(item.quantity), unit_cost: money(item.unit_cost), line_total: money(Number(item.quantity) * money(item.unit_cost)) }));
    if (safeItems.some((item) => !item.inventory_item_id || !Number.isFinite(item.quantity) || item.quantity <= 0)) throw new Error('بنود الفاتورة غير صحيحة.');
    const subtotal = safeItems.reduce((total, item) => total + item.line_total, 0); const total = subtotal - money(discount); const upfront = money(paid_amount);
    if (total < 0 || upfront > total) throw new Error('خصم أو دفعة الفاتورة غير صحيح.');
    const key = operationKeyFor('purchase', operation_key || operation_id);
    const existingOperation = await api.get(`purchase_operations/${key}`).catch(() => null);
    if (existingOperation) return duplicateOperationResult(existingOperation, key);
    const resolvedMonth = month || getRecordMonth({ date }) || currentMonth(); await checkMonthOpen(resolvedMonth);
    const existing = await api.list('purchase_invoices').catch(() => []); if (existing.some((row) => row.invoice_number === invoice_number && row.supplier_id === supplier_id && !row.deleted)) throw new Error('فاتورة هذا التاجر موجودة مسبقاً.');
    const inventory = await Promise.all(safeItems.map((item) => api.get(`inventory_items/${item.inventory_item_id}`)));
    if (inventory.some((item) => !item)) throw new Error('إحدى مواد المخزون غير موجودة.');
    const invoiceRef = push(ref(db, 'purchase_invoices')); const now = new Date().toISOString(); const invoice = withoutUndefined({ id: invoiceRef.key, operation_id: operation_id || key, operation_key: key, invoice_number: String(invoice_number), supplier_id, supplier_name, date: date || now.slice(0, 10), month: resolvedMonth, items: safeItems, subtotal, discount: money(discount), total, paid_amount: upfront, remaining_amount: total - upfront, payment_method, due_date, notes, status: upfront === 0 ? 'unpaid' : upfront < total ? 'partial' : 'paid', created_at: now, created_by: s.user.id });
    const claim = await claimOperation('purchase_operations', key, { id: key, status: 'pending', kind: 'purchase_invoice', result_id: invoice.id, operation_id: invoice.operation_id, created_at: now, created_by: s.user.id });
    if (!claim.committed) return duplicateOperationResult(claim.operation, key);
    const updates = { [`purchase_invoices/${invoice.id}`]: invoice };
    safeItems.forEach((item, index) => { const stock = inventory[index]; const unit = item.purchase_unit || item.unit || stock.unit; const base = toBaseQuantity({ quantity: item.quantity, unit, baseUnit: stock.base_unit || stock.unit, conversionFactor: stock.units_per_package || 1 }); const before = Number(stock.quantity || 0); const next = roundInventory(before + base); const average = weightedAverageCost({ oldQuantity: before, oldUnitCost: Number(stock.average_unit_cost ?? stock.purchase_price ?? 0), addedQuantity: base, addedTotalCost: item.line_total }); const movementRef = push(ref(db, 'inventory_movements')); const batches = Array.isArray(item.batches) ? item.batches : (item.batch_number ? [item] : []);
      if (stock.track_expiry && batches.length) { const allocated = batches.reduce((sum, batch) => sum + Number(batch.base_quantity ?? batch.quantity ?? 0), 0); if (!Number.isFinite(allocated) || roundInventory(allocated) !== roundInventory(base)) throw new Error('مجموع كميات الدفعات يجب أن يساوي الكمية الأساسية المستلمة.'); }
      invoice.items[index] = { ...invoice.items[index], base_quantity_added: base }; updates[`inventory_movements/${movementRef.key}`] = { id: movementRef.key, type: 'purchase', item_id: item.inventory_item_id, item_name: item.inventory_item_name || stock.name_ar || '', quantity: item.quantity, unit, base_quantity: base, quantity_delta: base, base_unit: stock.base_unit || stock.unit, before_quantity: before, after_quantity: next, reason: 'Purchase invoice', source_type: 'purchase_invoice', source_id: invoice.id, date: invoice.date, month: resolvedMonth, created_at: now, created_by: s.user.id }; updates[`inventory_items/${item.inventory_item_id}/quantity`] = next; updates[`inventory_items/${item.inventory_item_id}/average_unit_cost`] = average; updates[`inventory_items/${item.inventory_item_id}/purchase_price`] = item.unit_cost;
      const balances = locationBalances(stock); updates[`inventory_items/${item.inventory_item_id}/location_quantities/${DEFAULT_LOCATION_ID}`] = roundInventory(Number(balances[DEFAULT_LOCATION_ID] || 0) + base);
      batches.forEach((batch) => { const batchRef = push(ref(db, 'inventory_batches')); const amount = Number(batch.base_quantity ?? batch.quantity); updates[`inventory_batches/${batchRef.key}`] = { id: batchRef.key, item_id: stock.id, purchase_invoice_id: invoice.id, batch_number: batch.batch_number || '', received_date: batch.received_date || invoice.date, expiry_date: batch.expiry_date || '', quantity: amount, remaining_quantity: amount, base_unit: stock.base_unit || stock.unit, created_at: now, created_by: s.user.id }; }); });
    if (upfront > 0 && isCashMethod(payment_method)) { const cashRef = push(ref(db, 'cash_movements')); updates[`cash_movements/${cashRef.key}`] = { id: cashRef.key, type: 'OUT', amount: upfront, cash_account_id: 'cashier', date: invoice.date, month: resolvedMonth, source_type: 'purchase_invoice', source_id: invoice.id, source_key: `purchase_invoice:${invoice.id}:upfront`, operation_id: invoice.operation_id, operation_key: key, created_at: now, created_by: s.user.id }; }
    updates[`purchase_operations/${key}/status`] = 'completed'; updates[`purchase_operations/${key}/completed_at`] = now; updates[`audit/purchase_invoice_${key}`] = { action: 'PURCHASE_INVOICE_CREATED', entity: 'purchase_invoices', entity_id: invoice.id, operation_key: key, created_at: now, created_by: s.user.id };
    await update(ref(db), updates); return { ...invoice, ok: true, already_processed: false };
  },

  payTraderInvoice: async ({ invoice_id, amount, payment_method = 'cash', cash_account_id = 'cashier', date, notes = '', operation_id, operation_key }) => {
    const s = await requirePermission('traders.pay'); const initialInvoice = await api.get(`purchase_invoices/${invoice_id}`); if (!initialInvoice) throw new Error('فاتورة الشراء غير موجودة.'); await checkMonthOpen(initialInvoice.month);
    const value = money(amount); if (value <= 0) throw new Error('دفعة التاجر غير صحيحة.'); const now = new Date().toISOString(); const key = operationKeyFor('trader_payment', operation_key || operation_id); const paymentRef = push(ref(db, 'trader_payments')); let claimedPayment = null;
    const invoiceRef = ref(db, `purchase_invoices/${invoice_id}`); await get(invoiceRef);
    const claim = await runTransaction(invoiceRef, (invoice) => {
      invoice = invoice || initialInvoice; if (!invoice) return;
      const existing = invoice.trader_payment_operations?.[key]; if (existing) { claimedPayment = existing; return; }
      const remaining = money(invoice.remaining_amount ?? Number(invoice.total || 0) - Number(invoice.paid_amount || 0)); if (value > remaining) return;
      const paid = money(Number(invoice.paid_amount || 0) + value); claimedPayment = { id: paymentRef.key, status: 'pending', amount: value, operation_id: operation_id || key, operation_key: key, created_at: now, created_by: s.user.id };
      return { ...invoice, paid_amount: paid, remaining_amount: money(remaining - value), status: paid < Number(invoice.total || 0) ? 'partial' : 'paid', updated_at: now, trader_payment_operations: { ...(invoice.trader_payment_operations || {}), [key]: claimedPayment } };
    });
    const invoice = claim.snapshot.val() || initialInvoice; const existingOperation = invoice.trader_payment_operations?.[key];
    if (!claim.committed) {
      if (existingOperation) return duplicateOperationResult(existingOperation, key);
      throw new Error('دفعة التاجر تتجاوز الرصيد المستحق أو غير صحيحة.');
    }
    const item = { id: paymentRef.key, operation_id: operation_id || key, operation_key: key, invoice_id, supplier_id: invoice.supplier_id, amount: value, payment_method, cash_account_id, date: date || now.slice(0, 10), month: invoice.month, notes, created_at: now, created_by: s.user.id };
    const updates = { [`trader_payments/${item.id}`]: item, [`purchase_invoices/${invoice_id}/trader_payment_operations/${key}/status`]: 'completed', [`purchase_invoices/${invoice_id}/trader_payment_operations/${key}/completed_at`]: now, [`trader_payment_operations/${key}`]: { ...claimedPayment, status: 'completed', completed_at: now }, [`audit/trader_payment_${key}`]: { action: 'TRADER_PAYMENT_CREATED', entity: 'trader_payments', entity_id: item.id, operation_key: key, created_at: now, created_by: s.user.id } };
    if (isCashMethod(payment_method)) { const cashRef = push(ref(db, 'cash_movements')); updates[`cash_movements/${cashRef.key}`] = { id: cashRef.key, type: 'OUT', amount: value, cash_account_id, date: item.date, month: invoice.month, source_type: 'trader_payment', source_id: item.id, source_key: `trader_payment:${item.id}`, operation_id: item.operation_id, operation_key: key, created_at: now, created_by: s.user.id }; }
    await update(ref(db), updates); return { ...item, ok: true, already_processed: false };
  },

  saveLegacyPayrollCost: async ({ month, amount, notes = '' }) => {
    const s = await api.session();
    if (s?.user?.role !== 'super_admin') throw new Error('تكلفة الرواتب التاريخية للسوبر أدمن فقط.');
    await checkMonthOpen(month);
    const numeric = Number(amount);
    if (!month || !/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(numeric) || numeric <= 0) throw new Error('أدخل إجمالي تكلفة رواتب صحيحاً أكبر من صفر.');
    const existing = await api.get(`legacy_payroll_costs/${month}`);
    const now = new Date().toISOString();
    const item = withoutUndefined({ month, amount: numeric, notes: String(notes || '').trim(), source: 'manual_legacy', created_at: existing?.created_at || now, created_by: existing?.created_by || s.user.id, updated_at: now, updated_by: s.user.id });
    await set(ref(db, `legacy_payroll_costs/${month}`), item);
    await api.logAudit(existing ? 'LEGACY_PAYROLL_COST_UPDATED' : 'LEGACY_PAYROLL_COST_CREATED', 'legacy_payroll_costs', month, { month, amount: numeric, before: existing?.amount ?? null, after: numeric });
    return item;
  },

  create: async (entity, payload) => {
    await requireEntityPermission(entity, 'create');
    // POS supplies its durable local id. Do not allocate a new push id before
    // claiming the operation: an accepted request may lose its response.
    const suppliedId = entity === 'sales' && (payload?.sale_id || payload?.id) ? cleanSaleKey(payload.sale_id || payload.id) : '';
    // A retry may arrive without the original sale_id (for example, from an
    // older POS client). Reuse the claimed sale id when available, otherwise
    // derive one from the durable operation key instead of allocating a new
    // push id that would falsely look like a conflicting sale.
    let existingSaleOperation = null;
    const suppliedOperationKey = entity === 'sales' && payload?.operation_key ? cleanSaleKey(payload.operation_key) : '';
    if (entity === 'sales' && suppliedOperationKey) existingSaleOperation = (await get(ref(db, `sales_operations/${suppliedOperationKey}`))).val();
    const stableSaleId = entity === 'sales' && suppliedOperationKey
      ? (suppliedId || existingSaleOperation?.sale_id || `sale-${suppliedOperationKey}`)
      : suppliedId;
    const newRef = stableSaleId ? ref(db, `${entity}/${stableSaleId}`) : push(ref(db, entity));
    const now = new Date().toISOString();
    const cleanPayload = entity === 'purchases' ? normalizePurchasePayload(payload) : withoutUndefined(payload);
    if (financialEntities.has(entity)) await checkMonthOpen(getRecordMonth(cleanPayload));
    if (financialEntities.has(entity) && entity !== 'payroll_adjustments' && entity !== 'payroll_payments') { const month = getRecordMonth(cleanPayload); if (month) cleanPayload.month = month; }
    let data = withoutUndefined({ ...cleanPayload, id: newRef.key, created_at: now, created_by: auth.currentUser?.uid || 'system', created_by_name: currentUserProfile?.name || 'System' });
    if (entity === 'sales') {
      const paymentMethod = normalizePaymentMethod(data.payment_method);
      if (!paymentMethod) throw new Error('اختر طريقة الدفع قبل حفظ عملية البيع.');
      data.payment_method = paymentMethod;
      const quantity = Number(data.quantity || 0), unitPrice = Number(data.unit_price || 0), discountType = data.discount_type || 'fixed', discountValue = Number(data.discount_value || 0);
      const subtotal = quantity * unitPrice;
      const discountAmount = discountType === 'percent' ? subtotal * discountValue / 100 : discountValue;
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0 || discountAmount > subtotal) throw new Error('بيانات البيع أو الخصم غير صحيحة.');
      data.subtotal = subtotal; data.discount_amount = discountAmount; data.total_after_discount = subtotal - discountAmount;
      const sourceKey = String(data.operation_key || newRef.key).replace(/[.#$\[\]/]/g, '_');
      const fingerprint = saleFingerprint(data);
      const operationRef = ref(db, `sales_operations/${sourceKey}`);
      const claim = await runTransaction(operationRef, (existing) => existing ? undefined : { id: sourceKey, status: 'pending', source_type: 'sale', operation_key: sourceKey, sale_id: newRef.key, fingerprint, created_at: now, created_by: auth.currentUser?.uid || 'system' });
      const existingOperation = claim.snapshot.val();
      if (!claim.committed && existingOperation?.fingerprint && existingOperation.fingerprint !== fingerprint) throw Object.assign(new Error('تعارض في operation_key: المفتاح مستخدم لمحتوى بيع مختلف.'), { code: 'OPERATION_KEY_CONFLICT' });
      if (!claim.committed && existingOperation?.sale_id && existingOperation.sale_id !== newRef.key) throw Object.assign(new Error('تعارض في معرف البيع المحلي للعملية.'), { code: 'SALE_ID_CONFLICT' });
      if (!claim.committed && existingOperation?.status === 'completed') { const existingSale = existingOperation.sale_id ? await api.get(`sales/${existingOperation.sale_id}`).catch(() => null) : null; return { ...(existingSale || {}), already_processed: true, operation_key: data.operation_key || sourceKey }; }
      await validateSaleRecipeAvailability(data);
      await set(newRef, data);
      try {
        const itemsToSell = data.items || [{ product_id: data.product_id, quantity: data.quantity }];
        let recipeFound = false;
        for (let i = 0; i < itemsToSell.length; i++) {
          const saleItem = itemsToSell[i]; const recipe = await api.get(`product_recipes/${saleItem.product_id}`);
          if (recipe?.items?.length) { recipeFound = true; const suffix = itemsToSell.length > 1 ? `:${saleItem.product_id}:${i}` : ''; await api.consumeRecipe(saleItem.product_id, saleItem.quantity, { source_type: 'sale', source_id: newRef.key, source_key: `sale:${sourceKey}${suffix}`, operation_id: `sale:${sourceKey}${suffix}`, month: data.month, date: data.date }); }
        }
        if (!recipeFound) { data.inventory_consumption_status = 'no_recipe'; await update(ref(db, `sales/${newRef.key}`), { inventory_consumption_status: 'no_recipe' }); }
      } catch (error) {
        await update(ref(db), { [`sales/${newRef.key}/inventory_consumption_status`]: 'needs_review', [`sales/${newRef.key}/inventory_consumption_error`]: error.message || 'تعذر خصم مكونات الوصفة.', [`sales_operations/${sourceKey}/status`]: 'failed', [`sales_operations/${sourceKey}/failed_at`]: new Date().toISOString() });
        throw new Error(`تم تسجيل البيع، لكن تعذر خصم مكونات الوصفة ويحتاج إلى مراجعة: ${error.message || 'خطأ غير معروف'}`);
      }
      await update(ref(db, `sales_operations/${sourceKey}`), { status: 'completed', completed_at: new Date().toISOString() });
    } else if (entity === 'other_income') {
      const categoryId = data.category_id || data.category;
      if (categoryId) {
        const category = await api.get(`other_income_categories/${categoryId}`);
        if (!category || category.active === false) throw new Error('اختر فئة إيراد أخرى فعالة.');
        data.category = category.id;
        data.category_id = category.id;
        data.category_name = category.name_ar;
      }
      await set(newRef, data);
    } else if (entity === 'expenses') {
      const state = expensePaymentState(data);
      data.paid_amount = state.paid;
      data.remaining_amount = state.remaining;
      data.payment_status = state.status;
      const expenseWrites = { [`expenses/${newRef.key}`]: data };
      if (state.remaining > 0) expenseWrites[`debts/expense:${newRef.key}`] = withoutUndefined({
        id: `expense:${newRef.key}`,
        type: 'payable',
        party_type: 'service',
        party_name: data.party_name || data.company_name || data.beneficiary || data.category_name || 'مصروف',
        category: data.category_name || data.category || 'مصروفات',
        original_amount: Number(data.amount || 0),
        paid_amount: state.paid,
        initial_paid_amount: state.paid,
        remaining_amount: state.remaining,
        debt_date: data.date,
        due_date: data.due_date || '',
        status: state.paid > 0 ? 'partial' : 'unpaid',
        description: data.description || '',
        source_type: 'expense',
        source_id: newRef.key,
        source_key: `expense:${newRef.key}`,
        month: data.month,
        created_at: now,
        created_by: auth.currentUser?.uid || 'system',
      });
      await update(ref(db), expenseWrites);
    } else if (entity === 'purchases' && isInventoryPurchase(data)) {
      const stock = await api.get(`inventory_items/${data.inventory_item_id}`);
      if (!stock) throw new Error('مادة المخزون غير موجودة.');
      const base = inventoryPurchaseBaseQuantity(data, stock);
      if (!Number.isFinite(base) || base <= 0) throw new Error('كمية شراء المخزون أو وحدتها غير صحيحة.');
      const before = inventoryQuantity(stock);
      const total = inventoryPurchaseTotal(data) || roundInventory(Number(data.quantity || 0) * Number(data.unit_price || 0));
      const next = roundInventory(before + base);
      const average = weightedAverageCost({
        oldQuantity: before,
        oldUnitCost: Number(stock.average_unit_cost ?? stock.purchase_price ?? 0),
        addedQuantity: base,
        addedTotalCost: total,
      });
      const movementRef = push(ref(db, 'inventory_movements'));
      const purchaseData = withoutUndefined({
        ...data,
        total_after_discount: data.total_after_discount ?? total,
        base_quantity_added: base,
        stock_source_key: `purchase:${newRef.key}`,
      });
      const balances = locationBalances(stock);
      const updates = {
        [`purchases/${newRef.key}`]: purchaseData,
        [`inventory_items/${stock.id}/quantity`]: next,
        [`inventory_items/${stock.id}/average_unit_cost`]: average,
        [`inventory_items/${stock.id}/location_quantities/${DEFAULT_LOCATION_ID}`]: roundInventory(Number(balances[DEFAULT_LOCATION_ID] || 0) + base),
        [`inventory_movements/${movementRef.key}`]: withoutUndefined({
          id: movementRef.key,
          type: 'purchase',
          item_id: stock.id,
          item_name: data.inventory_item_name || stock.name_ar || '',
          quantity: data.quantity,
          unit: data.unit || stock.unit || stock.base_unit || '',
          base_quantity: base,
          quantity_delta: base,
          base_unit: stock.base_unit || stock.unit || '',
          before_quantity: before,
          after_quantity: next,
          reason: 'Generic inventory purchase',
          source_type: 'purchase',
          source_id: newRef.key,
          source_key: `purchase:${newRef.key}`,
          date: data.date || new Date().toISOString().slice(0, 10),
          month: getRecordMonth(data),
          created_at: now,
          created_by: auth.currentUser?.uid || 'system',
        }),
      };
      await update(ref(db), updates);
      data = purchaseData;
    } else {
      await set(newRef, data);
    }
    if (cashSourceType(entity)) await createAutoCashMovement(cashSourceType(entity), newRef.key, entity === 'expenses' ? { ...data, amount: data.paid_amount } : data);
    const createAudit = entity === 'other_income' ? 'OTHER_INCOME_CREATED' : entity === 'employees' ? 'EMPLOYEE_CREATED' : entity === 'suppliers' ? 'TRADER_COMPANY_CREATED' : 'CREATE';
    await api.logAudit(createAudit, entity, newRef.key, data).catch((error) => console.warn('Audit write skipped after primary write:', error?.code || error?.message));
    return data;
  },

  update: async (entity, id, payload) => {
    await requireEntityPermission(entity, 'edit');
    const itemRef = ref(db, `${entity}/${id}`);
    const oldSnap = await get(itemRef); const oldData = oldSnap.exists() ? oldSnap.val() : {};
    if (financialEntities.has(entity)) await checkMonthOpen(getRecordMonth({ ...oldData, ...payload }));
    const cleanPayload = entity === 'purchases' ? normalizePurchasePayload(payload) : withoutUndefined(payload);
    if (entity === 'sales' && oldData.product_id && (cleanPayload.quantity !== undefined || cleanPayload.product_id !== undefined) && await saleConsumptionExists(oldData)) throw new Error('لا يمكن تعديل كمية أو منتج بيع استهلك المخزون. استخدم إجراء إلغاء معكوساً معتمداً.');
    const data = withoutUndefined({
      ...cleanPayload,
      updated_at: new Date().toISOString(),
      updated_by: auth.currentUser?.uid || 'system'
    });
    if (financialEntities.has(entity) && !data.month) { const month = getRecordMonth({ ...oldData, ...data }); if (month) data.month = month; }
    if (entity === 'sales' && Object.prototype.hasOwnProperty.call(cleanPayload, 'payment_method')) {
      const paymentMethod = normalizePaymentMethod(cleanPayload.payment_method);
      if (!paymentMethod) throw new Error('اختر طريقة الدفع قبل حفظ عملية البيع.');
      data.payment_method = paymentMethod;
    }
    if (entity === 'purchases' || entity === 'sales') {
      const quantity = Number(data.quantity ?? oldData.quantity ?? 0), unitPrice = Number(data.unit_price ?? oldData.unit_price ?? 0);
      const discountType = data.discount_type ?? oldData.discount_type;
      const discountValue = Number(data.discount_value ?? oldData.discount_value ?? 0);
      const subtotal = quantity * unitPrice;
      const discountAmount = discountType === 'percent' ? subtotal * discountValue / 100 : discountType === 'fixed' ? discountValue : Number(data.discount_amount ?? oldData.discount_amount ?? 0);
      if (discountAmount > subtotal) throw new Error('الخصم لا يمكن أن يتجاوز الإجمالي.');
      data.subtotal = subtotal; data.discount_amount = discountAmount; data.total_after_discount = subtotal - discountAmount;
    }
    if (entity === 'other_income') {
      const amount = Number(data.amount ?? oldData.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('مبلغ الإيراد الآخر يجب أن يكون أكبر من صفر.');
      if (Object.prototype.hasOwnProperty.call(cleanPayload, 'category')) {
        const category = await api.get(`other_income_categories/${cleanPayload.category}`);
        if (!category || category.active === false) throw new Error('اختر فئة إيراد أخرى فعالة.');
        data.category = category.id; data.category_id = category.id; data.category_name = category.name_ar;
      }
      data.amount = amount;
    }
    if (entity === 'expenses') {
      const merged = { ...oldData, ...data };
      const state = expensePaymentState(merged);
      if (state.paid > state.total) throw new Error('المبلغ المدفوع أكبر من إجمالي المصروف.');
      data.paid_amount = state.paid;
      data.remaining_amount = state.remaining;
      data.payment_status = state.remaining === 0 ? 'paid' : state.paid > 0 ? 'partial' : 'unpaid';
      data.source_type = 'expense';
      data.source_id = id;
      data.source_key = `expense:${id}`;
    }
    let primaryWriteDone = false;
    // Generic inventory purchases predate the invoice workflow.  Keep them
    // compatible, but make edits a net correction against their own recorded
    // stock effects instead of adding the edited quantity a second time.
    if (entity === 'purchases' && (isInventoryPurchase(oldData) || isInventoryPurchase({ ...oldData, ...data }))) {
      const merged = { ...oldData, ...data };
      const movements = await api.list('inventory_movements').catch(() => []);
      const linked = movements.filter((movement) => movement.source_id === id || movement.reference === id);
      const linkedItemIds = [...new Set(linked.map((movement) => movement.item_id).filter(Boolean))];
      const newestLinkedAt = linked.reduce((latest, movement) => String(movement.created_at || movement.date || '') > latest ? String(movement.created_at || movement.date || '') : latest, '');
      if (newestLinkedAt && linkedItemIds.length && movements.some((movement) => linkedItemIds.includes(movement.item_id) && isDependentStockMovement(movement) && String(movement.created_at || movement.date || '') > newestLinkedAt)) {
        throw new Error('لا يمكن تعديل هذا الشراء تلقائياً لأن المادة استُهلكت أو عُدّلت بعده. راجع حركة المادة أولاً.');
      }
      const existingEffects = new Map();
      linked.forEach((movement) => {
        const effect = Number(movement.quantity_delta ?? movement.base_quantity ?? movement.quantity ?? 0);
        if (movement.item_id && Number.isFinite(effect)) existingEffects.set(movement.item_id, roundInventory((existingEffects.get(movement.item_id) || 0) + effect));
      });
      // A legacy row can have no movement link.  Its old balance must not be
      // guessed or migrated during an edit; only linked stock effects are safe
      // to reverse automatically.
      if (isInventoryPurchase(oldData) && !linked.length) throw new Error('هذا الشراء القديم لا يملك رابط حركة مخزون آمن. لا يمكن تعديله تلقائياً.');
      const desiredEffects = new Map();
      if (isInventoryPurchase(merged)) {
        const nextItem = await api.get(`inventory_items/${merged.inventory_item_id}`);
        if (!nextItem) throw new Error('مادة المخزون غير موجودة.');
        const base = inventoryPurchaseBaseQuantity(merged, nextItem);
        if (!Number.isFinite(base) || base <= 0) throw new Error('كمية شراء المخزون أو وحدتها غير صحيحة.');
        desiredEffects.set(merged.inventory_item_id, base);
        data.base_quantity_added = base;
        data.stock_source_key = `purchase:${id}`;
      }
      const affectedIds = [...new Set([...existingEffects.keys(), ...desiredEffects.keys()])];
      const updates = { [`purchases/${id}`]: withoutUndefined({ ...oldData, ...data }) };
      for (const itemId of affectedIds) {
        const delta = roundInventory((desiredEffects.get(itemId) || 0) - (existingEffects.get(itemId) || 0));
        if (!delta) continue;
        const item = await api.get(`inventory_items/${itemId}`);
        if (!item) throw new Error('مادة المخزون المرتبطة بالشراء لم تعد موجودة.');
        const before = inventoryQuantity(item);
        const after = roundInventory(before + delta);
        if (after < 0) throw new Error('لا يمكن تعديل الشراء لأن رصيد المخزون الحالي لا يكفي للتصحيح.');
        const balances = locationBalances(item);
        updates[`inventory_items/${itemId}/quantity`] = after;
        updates[`inventory_items/${itemId}/location_quantities/${DEFAULT_LOCATION_ID}`] = roundInventory(Number(balances[DEFAULT_LOCATION_ID] || 0) + delta);
        if (delta > 0) updates[`inventory_items/${itemId}/average_unit_cost`] = weightedAverageCost({ oldQuantity: before, oldUnitCost: Number(item.average_unit_cost ?? item.purchase_price ?? 0), addedQuantity: delta, addedTotalCost: inventoryPurchaseTotal(merged) });
        const movementRef = push(ref(db, 'inventory_movements'));
        updates[`inventory_movements/${movementRef.key}`] = withoutUndefined({ id: movementRef.key, type: 'purchase_adjustment', item_id: itemId, item_name: item.name_ar || '', quantity_delta: delta, base_unit: item.base_unit || item.unit || '', before_quantity: before, after_quantity: after, reason: 'Purchase edit correction', source_type: 'purchase_adjustment', source_id: id, source_key: `purchase:${id}`, date: merged.date || new Date().toISOString().slice(0, 10), month: merged.month, created_at: data.updated_at, created_by: auth.currentUser?.uid || 'system' });
      }
      await update(ref(db), updates);
      primaryWriteDone = true;
    }
    if (!primaryWriteDone) await update(itemRef, data);
    const sourceType = cashSourceType(entity);
    if (sourceType) {
      const movements = await listCashMovementsForSync().catch(() => []);
      const linked = movements.find((row) => row.source_key === cashSourceKey(sourceType, id) || (row.source_type === sourceType && row.source_id === id));
      if (linked) {
        if (isCashPayment(data.payment_method ?? oldData.payment_method)) {
          const cashAmount = entity === 'expenses' ? Number(data.paid_amount ?? oldData.paid_amount ?? 0) : Number(data.total_after_discount ?? data.amount ?? oldData.total_after_discount ?? oldData.amount ?? 0);
          if (cashAmount > 0) await update(ref(db, `cash_movements/${linked.id}`), withoutUndefined({ amount: cashAmount, date: data.date ?? oldData.date, month: data.month ?? oldData.month, payment_method: 'cash', deleted: false, updated_at: new Date().toISOString() }));
          else await update(ref(db, `cash_movements/${linked.id}`), { deleted: true, deleted_at: new Date().toISOString(), deleted_by: auth.currentUser?.uid || 'system' });
        } else {
          await update(ref(db, `cash_movements/${linked.id}`), { deleted: true, deleted_at: new Date().toISOString(), deleted_by: auth.currentUser?.uid || 'system' });
        }
      } else if (isCashPayment(data.payment_method ?? oldData.payment_method) && Number(data.paid_amount ?? data.amount ?? 0) > 0) await createAutoCashMovement(sourceType, id, { ...oldData, ...data, amount: entity === 'expenses' ? data.paid_amount : data.amount });
    }
    if (entity === 'expenses') {
      const merged = { ...oldData, ...data };
      const payable = buildExpensePayable({ expense: merged, userId: auth.currentUser?.uid || 'system', now: new Date().toISOString() });
      await update(ref(db), { [`debts/expense:${id}`]: payable || null });
    }
    const updateAudit = entity === 'other_income' ? 'OTHER_INCOME_UPDATED' : entity === 'employees' ? 'EMPLOYEE_UPDATED' : entity === 'suppliers' ? 'TRADER_COMPANY_UPDATED' : 'UPDATE';
    await api.logAudit(updateAudit, entity, id, entity === 'other_income' ? { before: oldData, after: { ...oldData, ...data } } : data).catch((error) => console.warn('Audit write skipped after primary update:', error?.code || error?.message));
    if (entity === 'employees' && Object.prototype.hasOwnProperty.call(data, 'base_salary') && Number(data.base_salary) !== Number(oldData.base_salary)) await api.logAudit('EMPLOYEE_BASE_SALARY_CHANGED', entity, id, { before: oldData.base_salary ?? null, after: data.base_salary ?? null }).catch((error) => console.warn('Audit write skipped after salary update:', error?.code || error?.message));
    return true;
  },

  archiveInventoryItem: async (id) => {
    const s = await requirePermission('materials.delete');
    if (!id) throw new Error('المادة غير محددة.');
    const item = await api.get(`inventory_items/${id}`);
    if (!item) throw new Error('المادة غير موجودة.');
    if (item.active === false) return item;
    const now = new Date().toISOString();
    const next = { active: false, archived_at: now, archived_by: s.user.id, updated_at: now, updated_by: s.user.id };
    await update(ref(db, `inventory_items/${id}`), next);
    await api.logAudit('INVENTORY_ITEM_ARCHIVED', 'inventory_items', id, next).catch(() => null);
    return { ...item, ...next };
  },

  restoreInventoryItem: async (id) => {
    const s = await requirePermission('materials.edit');
    if (!id) throw new Error('المادة غير محددة.');
    const item = await api.get(`inventory_items/${id}`);
    if (!item) throw new Error('المادة غير موجودة.');
    const now = new Date().toISOString();
    const next = { active: true, restored_at: now, restored_by: s.user.id, updated_at: now, updated_by: s.user.id };
    await update(ref(db, `inventory_items/${id}`), next);
    await api.logAudit('INVENTORY_ITEM_RESTORED', 'inventory_items', id, next).catch(() => null);
    return { ...item, ...next };
  },

  remove: async (entity, id, reason = '') => {
    await requireEntityPermission(entity, 'delete');
    const itemRef = ref(db, `${entity}/${id}`);
    const oldSnap = await get(itemRef);
    const oldData = oldSnap.exists() ? oldSnap.val() : null;
    if (oldData?.deleted) return true;
    if (financialEntities.has(entity)) await checkMonthOpen(getRecordMonth(oldData || {}));
    if (entity === 'sales' && oldData.product_id && await saleConsumptionExists(oldData)) throw new Error('لا يمكن حذف بيع استهلك المخزون قبل تنفيذ إجراء إلغاء معكوساً معتمداً.');
    if (entity === 'purchases' && isInventoryPurchase(oldData)) {
      const movements = await api.list('inventory_movements').catch(() => []);
      const linked = movements.filter((movement) => movement.source_id === id || movement.reference === id);
      if (!linked.length) throw new Error('هذا الشراء القديم لا يملك رابط حركة مخزون آمن. لا يمكن حذفه تلقائياً.');
      const itemIds = [...new Set(linked.map((movement) => movement.item_id).filter(Boolean))];
      const newestLinkedAt = linked.reduce((latest, movement) => String(movement.created_at || movement.date || '') > latest ? String(movement.created_at || movement.date || '') : latest, '');
      if (newestLinkedAt && movements.some((movement) => itemIds.includes(movement.item_id) && isDependentStockMovement(movement) && String(movement.created_at || movement.date || '') > newestLinkedAt)) {
        throw new Error('لا يمكن حذف هذا الشراء تلقائياً لأن المادة استُهلكت أو عُدّلت بعده. تبقى السجلات محفوظة؛ راجع حركة المادة أولاً.');
      }
      const effects = new Map();
      linked.forEach((movement) => {
        const effect = Number(movement.quantity_delta ?? movement.base_quantity ?? movement.quantity ?? 0);
        if (movement.item_id && Number.isFinite(effect)) effects.set(movement.item_id, roundInventory((effects.get(movement.item_id) || 0) + effect));
      });
      const now = new Date().toISOString();
      const updates = { [`purchases/${id}/deleted`]: true, [`purchases/${id}/deleted_at`]: now, [`purchases/${id}/deleted_by`]: auth.currentUser?.uid || 'system' };
      for (const [itemId, effect] of effects) {
        const item = await api.get(`inventory_items/${itemId}`);
        if (!item) throw new Error('مادة المخزون المرتبطة بالشراء لم تعد موجودة.');
        const before = inventoryQuantity(item);
        const after = roundInventory(before - effect);
        if (after < 0) throw new Error('لا يمكن حذف الشراء لأن رصيد المخزون الحالي لا يكفي لعكس أثره بأمان.');
        const balances = locationBalances(item);
        updates[`inventory_items/${itemId}/quantity`] = after;
        updates[`inventory_items/${itemId}/location_quantities/${DEFAULT_LOCATION_ID}`] = roundInventory(Number(balances[DEFAULT_LOCATION_ID] || 0) - effect);
        const movementRef = push(ref(db, 'inventory_movements'));
        updates[`inventory_movements/${movementRef.key}`] = { id: movementRef.key, type: 'purchase_reversal', item_id: itemId, item_name: item.name_ar || '', quantity_delta: -effect, base_unit: item.base_unit || item.unit || '', before_quantity: before, after_quantity: after, reason: 'Purchase archive reversal', source_type: 'purchase_reversal', source_id: id, source_key: `purchase:${id}`, date: oldData.date || now.slice(0, 10), month: oldData.month, created_at: now, created_by: auth.currentUser?.uid || 'system' };
      }
      await update(ref(db), updates);
    }

    // Keep financial history and catalog references recoverable.
    if (['purchases', 'expenses', 'sales', 'other_income', 'payroll'].includes(entity)) {
      await update(itemRef, { deleted: true, deleted_at: new Date().toISOString(), deleted_by: auth.currentUser?.uid });
    } else if (['products', 'product_categories', 'inventory_categories', 'inventory_items'].includes(entity)) {
      await update(itemRef, { active: false, deleted_at: new Date().toISOString(), deleted_by: auth.currentUser?.uid });
    } else {
      await remove(itemRef);
    }
    const sourceType = cashSourceType(entity);
    if (sourceType) {
      const movements = await listCashMovementsForSync().catch(() => []);
      const linked = movements.find((row) => row.source_key === cashSourceKey(sourceType, id) || (row.source_type === sourceType && row.source_id === id));
      if (linked) await update(ref(db, `cash_movements/${linked.id}`), { deleted: true, deleted_at: new Date().toISOString(), deleted_by: auth.currentUser?.uid || 'system' });
    }
    if (entity === 'other_income') await api.logAudit('OTHER_INCOME_DELETED', entity, id, oldData).catch(() => null);

    await api.logAudit('DELETE', entity, id, { before: oldData, reason: String(reason || '').trim() });
    return true;
  },

  logAudit: async (action, entity, entityId, newValue) => {
    if (entity === 'auditLogs' || entity === 'audit') return;
    const logRef = push(ref(db, 'audit'));
    await set(logRef, {
      id: logRef.key,
      created_at: new Date().toISOString(),
      actor_uid: auth.currentUser?.uid || 'system',
      actor_name: currentUserProfile?.name || 'System',
      role: currentUserProfile?.role || 'system',
      action,
      entity,
      entity_id: entityId,
      new_value: JSON.stringify(newValue || {})
    });
  },

  availableMonths: async () => {
    const session = await requirePermission('dashboard.view');
    const entities = ['purchases', 'purchase_invoices', 'expenses', 'assets', 'establishment_costs', 'historical_imports', 'sales', 'other_income', 'legacy_payroll_costs', 'payroll', 'payroll_payments', 'employee_advances', 'cash_movements', 'legacy_monthly_summaries'];
    const allowed = entities.filter((entity) => permissionForEntity[entity]?.view ? hasPermission(session, permissionForEntity[entity].view) : true);
    const values = await Promise.all(allowed.map(async (entity) => {
      try { const snap = await get(ref(db, entity)); return snap.exists() ? Object.values(snap.val()) : []; } catch { return []; }
    }));
    return getAvailableMonths(values);
  },

  checkMonthOpen,
  calculatePayroll: async (payroll, adjustments = [], payments = [], employee) => calculatePayroll(payroll, adjustments, payments, employee),
  calculatePayrollWithDebts: async (payload) => calculatePayrollWithDebts(payload),
  createPayrollForMonth: async (month) => {
    const s = await requirePermission('payroll.create'); await checkMonthOpen(month);
    const [employees, existing] = await Promise.all([api.list('employees').catch(() => []), api.list('payroll')]);
    const byEmployee = new Set(existing.filter((item) => getRecordMonth(item) === month).map((item) => item.employee_id || item.employee));
    const updates = {}; let created = 0;
    employees.filter((employee) => employee.active !== false).forEach((employee) => {
      const employeeId = employee.id || employee.employee_id; if (!employeeId || byEmployee.has(employeeId)) return;
      const id = push(ref(db, 'payroll')).key; const base = Number(employee.base_salary ?? 0);
      updates[`payroll/${id}`] = { id, employee_id: employeeId, employee_name: employee.name || employee.name_ar || '', month, base_salary_snapshot: base, paid_amount: 0, remaining_amount: base, status: 'unpaid', created_at: new Date().toISOString(), created_by: s.user.id };
      created++;
    });
    if (created) await update(ref(db), updates); return created;
  },
  addPayrollAdjustment: async (payload) => {
    const permission = `payroll.add_${payload.type === 'manual_adjustment' ? 'addition' : payload.type}`;
    const s = await requirePermission(permission); await checkMonthOpen(payload.month);
    if (!payload.employee_id) throw new Error('تعذر حفظ الحركة لأن الموظف غير مربوط بملف موظف.');
    const employee = await api.get(`employees/${payload.employee_id}`).catch(() => null);
    if (!employee) throw new Error('تعذر حفظ الحركة لأن الموظف غير مربوط بملف موظف.');
    if (!['bonus', 'deduction'].includes(payload.type)) throw new Error('استخدم مكافأة أو خصماً من واجهة الرواتب.');
    if (payload.source_id) { const existing = (await api.list('payroll_adjustments')).find((item) => item.source_id === payload.source_id); if (existing) return existing; }
    const itemRef = push(ref(db, 'payroll_adjustments')); const item = { id: itemRef.key, ...payload, source: payload.source || 'manual', amount: Number(payload.amount || 0), created_at: new Date().toISOString(), created_by: s.user.id };
    await set(itemRef, item); await api.logAudit(`PAYROLL_${String(payload.type).toUpperCase()}_ADDED`, 'payroll_adjustments', item.id, item); return item;
  },
  addPayrollPayment: async (payload) => {
    const s = await requirePermission('payroll.pay'); await checkMonthOpen(payload.month);
    requireEmployeeId(payload.employee_id, 'تعذر حفظ الدفعة لأن الموظف غير مربوط بشكل صحيح.');
    const employee = await api.get(`employees/${payload.employee_id}`).catch(() => null);
    if (!employee) throw new Error('تعذر حفظ الدفعة لأن الموظف غير مربوط بشكل صحيح.');
    const cleanPayload = withoutUndefined(payload);
    const amount = money(cleanPayload.amount, 'دفعة الراتب'); if (amount <= 0) throw new Error('دفعة الراتب يجب أن تكون أكبر من صفر.');
    const payroll = await api.get(`payroll/${payload.payroll_id}`).catch(() => null);
    if (!payroll) throw new Error('كشف الراتب غير موجود.');
    const [adjustments, payments, debts] = await Promise.all([api.list('payroll_adjustments').catch(() => []), api.list('payroll_payments').catch(() => []), api.list('employee_debts').catch(() => [])]);
    const operationKey = operationKeyFor('payroll-payment', cleanPayload.operation_key || cleanPayload.operation_id || `${cleanPayload.payroll_id}:${cleanPayload.amount}:${cleanPayload.date || ''}`);
    const operationClaim = await claimOperation('payroll_payment_operations', operationKey, { id: operationKey, kind: 'payroll_payment', status: 'pending', created_at: new Date().toISOString(), created_by: s.user.id });
    if (!operationClaim.committed) return duplicateOperationResult(operationClaim.operation, operationKey);
    const paymentRef = push(ref(db, 'payroll_payments')); const now = new Date().toISOString(); const item = withoutUndefined({ id: paymentRef.key, ...cleanPayload, operation_key: operationKey, amount, created_at: now, created_by: s.user.id });
    // Single source of truth: debt is deducted from salary due here, never
    // again from the remaining amount after previous payroll payments.
    const calculated = calculatePayrollWithDebts({ payroll, adjustments, payments, debts, employee, month: item.month });
    const salaryDue = calculated.net_salary;
    const openDebts = calculated.eligible_debts;
    const paidBefore = payments.filter((payment) => payment.payroll_id === item.payroll_id && !payment.deleted).reduce((total, payment) => total + money(payment.amount || 0), 0);
    if (paidBefore + amount > salaryDue) throw new Error('المبلغ المدفوع أكبر من الرصيد المتبقي للراتب.');
    const paidTotal = paidBefore + amount;
    const remainingAmount = Math.max(0, salaryDue - paidTotal);
    const updates = { [`payroll_payments/${item.id}`]: item, [`payroll/${payload.payroll_id}/paid_amount`]: paidTotal, [`payroll/${payload.payroll_id}/remaining_amount`]: remainingAmount, [`payroll/${payload.payroll_id}/status`]: paidTotal === 0 ? 'unpaid' : paidTotal < salaryDue ? 'partial' : 'paid', [`payroll/${payload.payroll_id}/updated_at`]: now, [`payroll/${payload.payroll_id}/updated_by`]: s.user.id };
    if (openDebts.length && paidTotal >= salaryDue) {
      const settledAt = now;
      openDebts.forEach((debt) => { updates[`employee_debts/${debt.id}`] = withoutUndefined({ ...debt, status: 'settled', settled_month: item.month, settled_payroll_id: item.payroll_id, settled_at: settledAt }); });
    }
    if (isCashMethod(item.payment_method)) {
      const cashRef = push(ref(db, 'cash_movements'));
      updates[`cash_movements/${cashRef.key}`] = { id: cashRef.key, type: 'OUT', amount, cash_account_id: item.cash_account_id || 'cashier', date: item.date || now.slice(0, 10), month: item.month, reason: 'Payroll payment', payment_method: 'cash', source_type: 'payroll_payment', source_id: item.id, source_key: `payroll_payment:${item.id}`, auto: true, created_at: now, created_by: s.user.id };
    }
    updates[`payroll_payment_operations/${operationKey}/status`] = 'completed'; updates[`payroll_payment_operations/${operationKey}/result_id`] = item.id; updates[`payroll_payment_operations/${operationKey}/completed_at`] = now;
    await update(ref(db), updates);
    await api.logAudit('PAYROLL_PAYMENT_CREATED', 'payroll_payments', item.id, item); return item;
  },
  addEmployeeDebt: async (payload) => {
    const s = await requirePermission('employee_debts.create'); await checkMonthOpen(payload.month || getRecordMonth(payload));
    requireEmployeeId(payload.employee_id, 'تعذر حفظ الدين لأن الموظف غير مربوط بملف موظف.');
    const employee = await api.get(`employees/${payload.employee_id}`).catch(() => null);
    if (!employee) throw new Error('تعذر حفظ الدين لأن الموظف غير مربوط بملف موظف.');
    const itemRef = push(ref(db, 'employee_debts'));
    const debtAmount = money(payload.amount, 'الدين'); if (debtAmount <= 0) throw new Error('مبلغ الدين يجب أن يكون أكبر من صفر.');
    const item = withoutUndefined({ id: itemRef.key, employee_id: employee.id, employee_name: employee.name || employee.name_ar || '', amount: debtAmount, date: payload.date || new Date().toISOString().slice(0, 10), month: payload.month || getRecordMonth(payload), reason: payload.reason || '', notes: payload.notes || '', status: 'open', created_at: new Date().toISOString(), created_by: s.user.id });
    await set(itemRef, item); await api.logAudit('EMPLOYEE_DEBT_CREATED', 'employee_debts', item.id, item); if (isCashMethod(payload.payment_method)) await createAutoCashMovement('employee_debt', item.id, { ...item, payment_method: 'cash', reason: item.reason || 'دين موظف' }); return item;
  },
  linkLegacyEmployee: async ({ entity = 'payroll', id, employeeId }) => {
    const s = await requirePermission('employees.edit');
    if (!id || !employeeId) throw new Error('تعذر ربط السجل: ملف الموظف غير محدد.');
    const employee = await api.get(`employees/${employeeId}`);
    if (!employee) throw new Error('ملف الموظف غير موجود.');
    const current = await api.get(`${entity}/${id}`);
    if (!current) throw new Error('السجل التاريخي غير موجود.');
    if (current.employee_id && current.employee_id !== employeeId) throw new Error('السجل مربوط بملف موظف آخر.');
    await update(ref(db, `${entity}/${id}`), { employee_id: employeeId, linked_at: new Date().toISOString(), linked_by: s.user.id });
    await api.logAudit('LEGACY_EMPLOYEE_LINKED', entity, id, { employee_id: employeeId, employee_name: employee.name || employee.name_ar || '' });
    return { ...current, employee_id: employeeId };
  },
  linkLegacyAdvances: async (month) => {
    const s = await requirePermission('payroll.edit');
    const [advances, employees, adjustments] = await Promise.all([api.list('employee_advances'), api.list('employees').catch(() => []), api.list('payroll_adjustments').catch(() => [])]);
    const linkedIds = new Set(adjustments.filter((item) => item.source === 'employee_advance' && item.source_id).map((item) => item.source_id));
    const eligible = recordsForMonth(advances, month); let linked = 0; let skipped_existing = 0; let unmatched = 0;
    for (const advance of eligible) {
      if (linkedIds.has(advance.id)) { skipped_existing++; continue; }
      const advanceName = normalizeName(advance.employee_name || advance.employee || advance.name || advance.source_details);
      const employee = employees.find((item) => (advance.employee_id && item.id === advance.employee_id) || (advanceName && normalizeName(item.name || item.name_ar) === advanceName));
      if (!employee) { unmatched++; continue; }
      try { await api.addPayrollAdjustment({ payroll_id: advance.payroll_id, employee_id: employee.id, employee_name: employee.name || employee.name_ar, month, type: 'advance', amount: Number(advance.amount ?? advance.advance ?? 0), reason: advance.reason || 'Legacy employee advance', date: advance.date, source: 'employee_advance', source_id: advance.id }); linked++; } catch (error) { if (error.code === 'MONTH_CLOSED') { skipped_existing++; } else throw error; }
    }
    if (linked) await api.logAudit('LEGACY_ADVANCE_LINKED', 'employee_advances', month, { month, linked, actor: s.user.id });
    return { linked, skipped_existing, unmatched };
  },

  dashboard: async (selectedMonth = currentMonth()) => {
    const s = await requirePermission('dashboard.view'); const perms = s?.permissions || [];
    const [expSnap, purSnap, purchaseInvoiceSnap, salSnap, otherIncomeSnap, legacyCostSnap, catSnap, prodSnap, matSnap, productCatSnap, payrollSnap, cashSnap, legacySnap, adjustmentSnap, paymentSnap, advanceSnap] = await Promise.all([
      get(ref(db, 'expenses')),
      get(ref(db, 'purchases')),
      get(ref(db, 'purchase_invoices')).catch(() => null),
      get(ref(db, 'sales')),
      ['super_admin', 'supervisor'].includes(s?.user?.role) || hasPermission(s, 'other_income.view') || hasPermission(s, 'financial.view_revenue') ? get(ref(db, 'other_income')).catch(() => null) : Promise.resolve(null),
      (['super_admin', 'supervisor'].includes(s?.user?.role) || hasPermission(s, 'financial.view_payroll_cost')) ? get(ref(db, 'legacy_payroll_costs')).catch(() => null) : Promise.resolve(null),
      get(ref(db, 'categories')),
      get(ref(db, 'products')),
      get(ref(db, 'materials')),
      get(ref(db, 'product_categories')),
      hasPermission(s, 'payroll.view') ? get(ref(db, 'payroll')).catch(() => null) : Promise.resolve(null),
      hasPermission(s, 'cash_movements.view') ? get(ref(db, 'cash_movements')).catch(() => null) : Promise.resolve(null),
      get(ref(db, 'legacy_monthly_summaries')).catch(() => null),
      hasPermission(s, 'payroll.view') ? get(ref(db, 'payroll_adjustments')).catch(() => null) : Promise.resolve(null),
      hasPermission(s, 'payroll.view') ? get(ref(db, 'payroll_payments')).catch(() => null) : Promise.resolve(null),
      hasPermission(s, 'payroll.view') ? get(ref(db, 'employee_advances')).catch(() => null) : Promise.resolve(null)
    ]);

    const exp = expSnap.exists() ? Object.values(expSnap.val()).filter(x => !x.deleted) : [];
    const pur = purSnap.exists() ? Object.values(purSnap.val()).filter(x => !x.deleted) : [];
    const purchaseInvoices = purchaseInvoiceSnap?.exists() ? Object.values(purchaseInvoiceSnap.val()).filter(x => !x.deleted) : [];
    const sal = salSnap.exists() ? Object.values(salSnap.val()).filter(x => !x.deleted) : [];
    const otherIncome = otherIncomeSnap?.exists() ? Object.values(otherIncomeSnap.val()).filter(x => !x.deleted) : [];
    const legacyCosts = legacyCostSnap?.exists() ? Object.values(legacyCostSnap.val()).filter(x => !x.deleted) : [];
    const priorMonth = previousMonth(selectedMonth);
    const monthExp = recordsForMonth(exp, selectedMonth), monthPur = recordsForMonth(pur, selectedMonth), monthSal = recordsForMonth(sal, selectedMonth);
    const resolvedPurchases = resolvePurchaseRows({ purchases: pur, invoices: purchaseInvoices, month: selectedMonth });
    const priorResolvedPurchases = resolvePurchaseRows({ purchases: pur, invoices: purchaseInvoices, month: priorMonth });
    const priorExp = recordsForMonth(exp, priorMonth);
    const payroll = payrollSnap?.exists() ? Object.values(payrollSnap.val()).filter(x => !x.deleted) : [];
    const legacySummaries = legacySnap?.exists() ? Object.values(legacySnap.val()).filter(x => !x.deleted) : [];
    const adjustments = adjustmentSnap?.exists() ? Object.values(adjustmentSnap.val()).filter(x => !x.deleted) : [];
    const payments = paymentSnap?.exists() ? Object.values(paymentSnap.val()).filter(x => !x.deleted) : [];
    const advances = advanceSnap?.exists() ? Object.values(advanceSnap.val()).filter(x => !x.deleted) : [];
    const monthPayroll = recordsForMonth(payroll, selectedMonth);
    const legacyDetails = exp.filter(x => x.source_sheet === 'ورقة2' || x.legacy_type);
    const cash = cashSnap?.exists() ? recordsForMonth(Object.values(cashSnap.val()).filter(x => !x.deleted), selectedMonth) : [];
    const payrollResult = getMonthlyPayrollCost({ payroll, adjustments, payments, legacyCosts, month: selectedMonth });
    const payrollPaidResult = getMonthlyPayrollPaid({ payroll, adjustments, payments, month: selectedMonth });
    const payrollDue = payrollResult.total;
    const payrollPaid = payrollPaidResult.total;
    const catCount = productCatSnap.exists() ? Object.keys(productCatSnap.val()).length : (catSnap.exists() ? Object.keys(catSnap.val()).length : 0);
    const prodCount = prodSnap.exists() ? Object.keys(prodSnap.val()).length : 0;
    const matCount = matSnap.exists() ? Object.keys(matSnap.val()).length : 0;

    const canSeeRevenue = ['super_admin', 'supervisor'].includes(s?.user?.role) || hasPermission(s, 'financial.view_revenue');
    const total = (x, fallback) => amountOf(x, fallback);
    const todayKey = localBusinessDate();
    const salesResult = getMonthlySales({ transactions: sal, legacySummaries, month: selectedMonth });
    const otherIncomeResult = getMonthlyOtherIncome({ records: otherIncome, legacySummaries, month: selectedMonth });
    const purchasesResult = getMonthlyPurchases({ transactions: pur, legacyDetails, legacySummaries, month: selectedMonth });
    const resolvedPurchaseRows = resolvedPurchases;
    const resolvedPurchaseTotal = resolvedPurchaseRows.reduce((n, row) => n + row.total, 0);
    const resolvedModernPurchaseTotal = resolvedPurchaseRows.filter((row) => row.purchase_source === 'purchases').reduce((n, row) => n + row.total, 0);
    const legacyPurchaseComponent = purchasesResult.total == null ? null : purchasesResult.total - resolvedModernPurchaseTotal;
    const purchaseTotal = legacyPurchaseComponent == null
      ? (resolvedPurchaseRows.length ? resolvedPurchaseTotal : null)
      : legacyPurchaseComponent + resolvedPurchaseTotal;
    const purchaseMetric = { ...purchasesResult, total: purchaseTotal, count: purchasesResult.count + resolvedPurchaseRows.filter((row) => row.purchase_source === 'purchase_invoices').length };
    const expensesResult = getMonthlyExpenses({ transactions: exp, legacyDetails, legacySummaries, month: selectedMonth });
    const cashResult = getMonthlyCashMovement({ movements: cash, month: selectedMonth });
    const advancesResult = getMonthlyLegacyWithdrawals({ payroll, advances, month: selectedMonth });
    const salesTotal = salesResult.total, expenseTotal = expensesResult.total;
    const salesBreakdown = getMonthlySalesBreakdown({ transactions: sal, legacySummaries, month: selectedMonth });
    // Purchases are procurement cash-flow data, not COGS. Until sale-level
    // inventory cost is linked and complete, profitability must remain blank.
    const netProfitBeforePayroll = null;
    const netProfitAfterPayroll = null;
    const immediateCashPurchases = getImmediateCashPurchasePaid(resolvedPurchases);
    const [selectedYear, selectedMonthNumber] = String(selectedMonth || currentMonth()).split('-').map(Number);
    const daysInSelectedMonth = Number.isFinite(selectedYear) && Number.isFinite(selectedMonthNumber)
      ? new Date(selectedYear, selectedMonthNumber, 0).getDate()
      : 0;
    const monthly = canSeeRevenue ? Array.from({ length: daysInSelectedMonth }, (_, index) => {
      const dayNumber = index + 1;
      const key = `${selectedYear}-${String(selectedMonthNumber).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
      const daySales = monthSal.filter((row) => String(row.date || '').slice(0, 10) === key);
      const dayPurchases = monthPur.filter((row) => String(row.date || '').slice(0, 10) === key);
      const dayExpenses = monthExp.filter((row) => String(row.date || '').slice(0, 10) === key);
      const dayOtherIncome = otherIncome.filter((row) => String(row.date || '').slice(0, 10) === key);
      const dayBreakdown = getMonthlySalesBreakdown({ transactions: daySales, legacySummaries: [], month: selectedMonth });
      return {
        day: String(dayNumber), date: key,
        revenue: daySales.reduce((total, row) => total + getSalesTransactionNet(row), 0),
        purchases: dayPurchases.reduce((total, row) => total + amountOf(row, 'total_price'), 0),
        expenses: dayExpenses.reduce((total, row) => total + amountOf(row, 'amount'), 0),
        otherIncome: dayOtherIncome.reduce((total, row) => total + amountOf(row, 'amount'), 0),
        salesCount: daySales.length, purchaseCount: dayPurchases.length,
        cashSales: dayBreakdown.cash, electronicSales: dayBreakdown.electronic,
        reviewCount: daySales.filter((row) => resolvePaymentMethod(row.payment_method) === 'unknown').length,
      };
    }) : [];
    const expenseTotals = {};
    (expensesResult.breakdown || []).forEach(x => { const label = x.category_name || x.category || 'أخرى'; expenseTotals[label] = (expenseTotals[label] || 0) + amountOf(x, 'amount'); });
    const expenseTotalForChart = Object.values(expenseTotals).reduce((a,b)=>a+b,0) || 1;
    const expenseByCategory = Object.entries(expenseTotals).sort((a,b)=>b[1]-a[1]).map(([label,value])=>({label,value,percent:Math.round(value/expenseTotalForChart*100)}));
    const recent = [...monthExp.map(x=>({...x,label:x.description||x.category_name,amount:amountOf(x,'amount')})),...monthPur.map(x=>({...x,label:`شراء ${x.material_name||x.item||x.item_name||'مادة'}`,amount:total(x,'total_price')})),...monthSal.map(x=>({...x,label:`بيع ${x.product_name||x.item||'منتج'}`,amount:getSalesTransactionNet(x)}))].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,5);
    return {
      productCategories: productCatSnap.exists() ? Object.values(productCatSnap.val()).filter(x => x.active !== false).sort((a,b) => Number(a.sort_order ?? a.sortOrder ?? 0) - Number(b.sort_order ?? b.sortOrder ?? 0)) : [],
      metrics: {
        todaySales: canSeeRevenue ? monthSal.filter(x=>getRecordDate(x)===todayKey).reduce((value, row) => value + getSalesTransactionNet(row), 0) : null, todayPurchases: canSeeRevenue ? sum(monthPur.filter(x=>getRecordDate(x)===todayKey), 'total_price') : null, todayExpenses: canSeeRevenue ? sum(monthExp.filter(x=>getRecordDate(x)===todayKey), 'amount') : null, todayNetProfit: canSeeRevenue ? monthSal.filter(x=>getRecordDate(x)===todayKey).reduce((value, row) => value + getSalesTransactionNet(row), 0)-sum(monthExp.filter(x=>getRecordDate(x)===todayKey), 'amount') : null,
        todaySalesCount: monthSal.filter(x=>getRecordDate(x)===todayKey).length,
        todayCashSales: canSeeRevenue ? getMonthlySalesBreakdown({ transactions: monthSal.filter(x=>getRecordDate(x)===todayKey), legacySummaries: [], month: selectedMonth }).cash : null,
        todayElectronicSales: canSeeRevenue ? getMonthlySalesBreakdown({ transactions: monthSal.filter(x=>getRecordDate(x)===todayKey), legacySummaries: [], month: selectedMonth }).electronic : null,
        todayReviewCount: monthSal.filter(x=>getRecordDate(x)===todayKey && resolvePaymentMethod(x.payment_method) === 'unknown').length,
        todayBestProduct: canSeeRevenue ? (() => { const grouped = {}; monthSal.filter(x=>getRecordDate(x)===todayKey).forEach(x => { const key = x.product_name || x.item || x.product_id || 'منتج'; const current = grouped[key] || { quantity: 0, revenue: 0 }; grouped[key] = { quantity: current.quantity + Number(x.quantity || 0), revenue: current.revenue + getSalesTransactionNet(x) }; }); return Object.entries(grouped).sort((a,b)=>b[1].quantity-a[1].quantity || b[1].revenue-a[1].revenue || a[0].localeCompare(b[0]))[0]?.[0] || null; })() : null,
        todayExpectedCash: canSeeRevenue ? cashResult.total : null,
        operationCount: monthSal.length + monthPur.length + monthExp.length,
        revenue: canSeeRevenue ? salesTotal : null, grossSales: canSeeRevenue ? salesResult.gross : null, discounts: canSeeRevenue ? salesResult.discount : null, cashSales: canSeeRevenue ? salesBreakdown.cash : null, electronicSales: canSeeRevenue ? salesBreakdown.electronic : null, otherNonCashSales: canSeeRevenue ? salesBreakdown.otherNonCash : null, unclassifiedSales: canSeeRevenue ? salesBreakdown.unclassified : null, otherIncome: canSeeRevenue ? otherIncomeResult.total : null, purchases: canSeeRevenue ? purchaseTotal : null, cashPaidPurchases: canSeeRevenue ? immediateCashPurchases : null, expenses: canSeeRevenue ? expenseTotal : null, operatingExpenses: canSeeRevenue ? expenseTotal : null, cogs: null, grossProfit: null, netProfitBeforePayroll: canSeeRevenue ? netProfitBeforePayroll : null, netProfitAfterPayroll: canSeeRevenue ? netProfitAfterPayroll : null, netProfit: null, profitabilityStatus: 'incomplete_missing_cogs',
        payrollDue, payrollPaid, payrollRemaining: payrollDue == null || payrollPaid == null ? null : Math.max(0, payrollDue - payrollPaid), payrollSource: payrollResult.source, employeeAdvances: advancesResult.total, employeeAdvancesSource: advancesResult.source, cashNet: cashResult.total,
        purchaseCount: monthPur.length, expenseCount: monthExp.length, categoryCount: catCount, productCount: prodCount, materialCount: matCount,
        purchaseComparison: canSeeRevenue ? (purchaseTotal && priorResolvedPurchases.length ? Math.round((purchaseTotal - priorResolvedPurchases.reduce((n, row) => n + row.total, 0)) / priorResolvedPurchases.reduce((n, row) => n + row.total, 0) * 100) : null) : null,
        expenseComparison: canSeeRevenue ? (expenseTotal && sum(priorExp, 'amount') ? Math.round((expenseTotal - sum(priorExp, 'amount')) / sum(priorExp, 'amount') * 100) : null) : null,
        selectedMonth,
        canSeeRevenue
      }, monthly, expenseByCategory: canSeeRevenue ? expenseByCategory : [], recent: canSeeRevenue ? recent : recent.map(({ amount, total, ...item }) => item),
      permissions: perms
    };
  },
  reportRange: async (range) => {
    await requirePermission('financial.view_profitability_reports');
    const [sales, purchases, purchaseInvoices, expenses, otherIncome, payrollPayments, materials, debtRows, debtPayments] = await Promise.all([
      api.list('sales').catch(() => []), api.list('purchases').catch(() => []), api.list('purchase_invoices').catch(() => []), api.list('expenses').catch(() => []),
      api.list('other_income').catch(() => []), api.list('payroll_payments').catch(() => []), api.list('materials').catch(() => []), api.listDebts('all').catch(() => []), api.list('debt_payments').catch(() => [])
    ]);
    const inRange = (rows) => range?.mode === 'custom' ? filterRecordsByDateRange(rows, range) : recordsForMonth(rows, range?.month || 'all');
    const salesRows = inRange(sales), purchaseRows = resolvePurchaseRows({ purchases, invoices: purchaseInvoices, month: range.mode === 'month' ? range.month : 'all' }).filter((row) => range.mode === 'custom' ? inRange([row]).length : true), expenseRows = inRange(expenses).filter((row) => !row.establishment_reclassified), operatingExpenseRows = expenseRows.filter((row) => !['fixed_asset', 'setup_cost'].includes(row.accounting_class)), incomeRows = inRange(otherIncome), paymentRows = inRange(payrollPayments);
    const salesTotal = salesRows.reduce((n, row) => n + getSalesTransactionNet(row), 0);
    const salesDiscount = salesRows.reduce((n, row) => n + Number(row.discount_amount ?? row.discount ?? 0), 0);
    const purchaseTotal = purchaseRows.reduce((n, row) => n + Number(row.total_after_discount ?? row.total_price ?? row.amount ?? 0), 0);
    const purchasePaid = purchaseRows.reduce((n, purchase) => { const linkedPayments = paymentRows.filter((row) => row.invoice_id && row.invoice_id === purchase.id); return n + (linkedPayments.length ? linkedPayments.reduce((total, row) => total + Number(row.amount || 0), 0) : Number(purchase.paid_amount ?? purchase.paid ?? 0)); }, 0);
    const expenseTotal = expenseRows.reduce((n, row) => n + Number(row.amount ?? row.total ?? 0), 0);
    const operatingExpenseTotal = operatingExpenseRows.reduce((n, row) => n + Number(row.amount ?? row.total ?? 0), 0);
    const otherIncomeTotal = incomeRows.reduce((n, row) => n + Number(row.amount || 0), 0);
    const payrollTotal = paymentRows.reduce((n, row) => n + Number(row.amount || 0), 0);
    const expensesByCategory = operatingExpenseRows.reduce((out, row) => { const key = row.category_name || row.category || 'أخرى'; out[key] = (out[key] || 0) + Number(row.amount ?? row.total ?? 0); return out; }, {});
    const endDate = range?.mode === 'custom' ? range.toDate : `${range?.month || currentMonth()}-31`;
    const startDate = range?.mode === 'custom' ? range.fromDate : `${range?.month || currentMonth()}-01`;
    const debtsAsOf = debtRows.filter((row) => String(row.debt_date || row.date || '').slice(0, 10) <= endDate).map((row) => {
      const linked = debtPayments.filter((payment) => payment.debt_id === row.id && !payment.deleted && String(payment.date || payment.created_at || '').slice(0, 10) <= endDate);
      if (row.source_type === 'purchase_invoice') return row;
      const paid = Number(row.initial_paid_amount ?? row.paid_amount ?? 0) + linked.reduce((total, payment) => total + Number(payment.amount || 0), 0);
      const remaining = Math.max(0, Number(row.original_amount || 0) - paid);
      return { ...row, paid_amount: paid, remaining_amount: remaining, status: remaining === 0 ? 'paid' : paid > 0 ? 'partial' : (row.due_date && row.due_date < endDate ? 'overdue' : 'unpaid') };
    });
    const debtSettlementRows = debtPayments.filter((row) => !row.deleted && String(row.date || row.created_at || '').slice(0, 10) >= startDate && String(row.date || row.created_at || '').slice(0, 10) <= endDate);
    const debtPayable = debtsAsOf.filter((row) => row.type === 'payable').reduce((n, row) => n + Number(row.remaining_amount || 0), 0);
    const debtReceivable = debtsAsOf.filter((row) => row.type === 'receivable').reduce((n, row) => n + Number(row.remaining_amount || 0), 0);
    const overduePayable = debtsAsOf.filter((row) => row.type === 'payable' && row.status === 'overdue').reduce((n, row) => n + Number(row.remaining_amount || 0), 0);
    const overdueReceivable = debtsAsOf.filter((row) => row.type === 'receivable' && row.status === 'overdue').reduce((n, row) => n + Number(row.remaining_amount || 0), 0);
    const debtSummary = { payable: debtPayable, receivable: debtReceivable, overduePayable, overdueReceivable, settledDuringRange: debtSettlementRows.reduce((n, row) => n + Number(row.amount || 0), 0) };
    return {
      range, rows: { sales: salesRows, purchases: purchaseRows, expenses: expenseRows, otherIncome: incomeRows, payroll: paymentRows, inventory: materials.filter((row) => !row.deleted), debts: debtsAsOf, debtPayments: debtSettlementRows },
      summary: { sales: salesTotal, discounts: salesDiscount, netSales: salesTotal, purchases: purchaseTotal, purchasePaid, purchaseRemaining: Math.max(0, purchaseTotal - purchasePaid), expenses: expenseTotal, operatingExpenses: operatingExpenseTotal, otherIncome: otherIncomeTotal, payrollPayments: payrollTotal, cogs: null, grossProfit: null, netProfit: null, netResult: null, profitabilityStatus: 'incomplete_missing_cogs', expenseBreakdown: expensesByCategory, debtsPayable: debtSummary.payable, debtsReceivable: debtSummary.receivable, overduePayable: debtSummary.overduePayable, overdueReceivable: debtSummary.overdueReceivable, debtSettledDuringRange: debtSummary.settledDuringRange }
    };
  },
  productCost: async (id) => ({ total: 0, items: [] }),

  backup: async () => {
    alert('النسخ الاحتياطي السحابي يتم تلقائياً بواسطة Firebase.');
    return null;
  },

  exportExcel: async (entity, range = null) => {
    await requirePermission('excel.export');
    const report = range ? await api.reportRange(range) : null;
    const label = range?.mode === 'custom' ? `${range.fromDate} إلى ${range.toDate}` : (range?.month || currentMonth());
    const rows = report?.rows || {};
    const simple = {
      sales: { title: 'تقرير المبيعات', headers: ['التاريخ','رقم العملية','طريقة الدفع','المبلغ','الخصم','الصافي','ملاحظات'], data: (rows.sales || []).map((r) => [r.date || '', r.operation_number || r.invoice_number || r.id || '', r.payment_method || '', Number(r.amount ?? r.total_before_discount ?? r.total_after_discount ?? 0), Number(r.discount_amount ?? r.discount ?? 0), Number(r.total_after_discount ?? r.net_amount ?? getSalesTransactionNet(r)), r.notes || '']) },
      purchases: { title: 'تقرير المشتريات', headers: ['التاريخ','رقم الفاتورة','التاجر / الشركة','الإجمالي','المدفوع','المتبقي','طريقة الدفع','ملاحظات'], data: (rows.purchases || []).map((r) => { const total = Number(r.total_after_discount ?? r.total_price ?? r.amount ?? 0); const paid = Number(r.paid_amount ?? r.paid ?? 0); return [r.date || '', r.invoice_number || r.id || '', r.supplier_name || r.supplier || r.company_name || '', total, paid, Math.max(0, total - paid), r.payment_method || '', r.notes || '']; }) },
      expenses: { title: 'تقرير المصروفات', headers: ['التاريخ','القسم','النوع','البيان','المبلغ','طريقة الدفع','ملاحظات'], data: (rows.expenses || []).map((r) => [r.date || '', r.category_name || r.category || 'أخرى', r.type || '', r.description || r.details || '', Number(r.amount ?? r.total ?? 0), r.payment_method || '', r.notes || '']) },
      otherIncome: { title: 'تقرير الإيرادات الأخرى', headers: ['التاريخ','البيان','المبلغ','طريقة الدفع','ملاحظات'], data: (rows.otherIncome || []).map((r) => [r.date || '', r.description || r.type || r.category || '', Number(r.amount || 0), r.payment_method || '', r.notes || '']) },
      payroll: { title: 'تقرير مدفوعات الرواتب', headers: ['التاريخ','الموظف','نوع العملية','المبلغ المدفوع','طريقة الدفع','ملاحظات'], data: (rows.payroll || []).map((r) => [r.date || r.payment_date || '', r.employee_name || r.employee || '', 'دفعة راتب', Number(r.amount || 0), r.payment_method || '', r.notes || '']) },
      inventory: { title: 'تقرير المخزون', headers: ['المادة','القسم','الوحدة','الكمية الحالية','تكلفة الوحدة','قيمة المخزون','الحد الأدنى','الحالة'], data: (rows.inventory || []).map((r) => { const qty = Number(r.quantity ?? r.current_stock ?? r.stock ?? 0); const cost = Number(r.average_cost ?? r.unit_cost ?? r.cost ?? 0); return [r.name_ar || r.name || r.item_name || '', r.category_name || r.category || '', r.base_unit || r.unit || '', qty, cost, qty * cost, Number(r.min_stock ?? r.minimum_stock ?? 0), qty <= Number(r.min_stock ?? r.minimum_stock ?? -1) ? 'منخفض' : 'جيد']; }) }
      ,debtsPayable: { title: 'الديون عليّ', headers: ['النوع','الجهة','الفئة','المبلغ الأصلي','المدفوع','المتبقي','تاريخ الدين','تاريخ الاستحقاق','الحالة','المصدر','ملاحظات'], data: (rows.debts || []).filter((r) => r.type === 'payable').map((r) => [r.type === 'receivable' ? 'إليّ' : 'عليّ', r.party_name || '', r.category || '', Number(r.original_amount || 0), Number(r.paid_amount || 0), Number(r.remaining_amount || 0), r.debt_date || r.date || '', r.due_date || '', r.status || '', r.source_type || 'يدوي', r.notes || '']) },
      debtsReceivable: { title: 'الديون إليّ', headers: ['النوع','الجهة','الفئة','المبلغ الأصلي','المدفوع','المتبقي','تاريخ الدين','تاريخ الاستحقاق','الحالة','المصدر','ملاحظات'], data: (rows.debts || []).filter((r) => r.type === 'receivable').map((r) => [r.type === 'receivable' ? 'إليّ' : 'عليّ', r.party_name || '', r.category || '', Number(r.original_amount || 0), Number(r.paid_amount || 0), Number(r.remaining_amount || 0), r.debt_date || r.date || '', r.due_date || '', r.status || '', r.source_type || 'يدوي', r.notes || '']) },
      debtPayments: { title: 'تسويات الديون', headers: ['التاريخ','الجهة','نوع الدين','المبلغ','طريقة الدفع','الحساب النقدي','الملاحظات'], data: (rows.debtPayments || []).map((r) => { const debt = (rows.debts || []).find((d) => d.id === r.debt_id); return [r.date || '', debt?.party_name || '', r.type === 'receivable' ? 'إليّ' : 'عليّ', Number(r.amount || 0), r.payment_method || '', r.cash_account_id || '', r.notes || '']; }) }
    };
    const makeSheet = (spec) => { const ws = XLSX.utils.aoa_to_sheet([['101 COFFEE FINANCE'], [`اسم التقرير: ${spec.title}`], [`الفترة: ${label}`], [], spec.headers, ...spec.data]); ws['!cols'] = spec.headers.map((h, i) => ({ wch: Math.min(28, Math.max(String(h).length + 2, ...spec.data.map((r) => String(r[i] ?? '').length + 2), 10)) })); return ws; };
    const wb = XLSX.utils.book_new();
    const addSimple = (key, sheetName) => XLSX.utils.book_append_sheet(wb, makeSheet(simple[key]), sheetName);
    if (entity === 'all') { const summary = report?.summary || {}; const summarySpec = { title: 'تقرير الفترة الكامل', headers: ['البند','المبلغ'], data: [['الفترة', label], ['الوارد الكلي', summary.netSales || 0], ['الإيرادات الأخرى', summary.otherIncome || 0], ['المشتريات', summary.purchases || 0], ['المصروفات', summary.expenses || 0], ['مدفوعات الرواتب', summary.payrollPayments || 0], ['إجمالي الديون عليّ', summary.debtsPayable || 0], ['إجمالي الديون إليّ', summary.debtsReceivable || 0], ['المسدد خلال الفترة', summary.debtSettledDuringRange || 0], ['صافي النتيجة', summary.netResult || 0]] }; XLSX.utils.book_append_sheet(wb, makeSheet(summarySpec), 'الملخص'); addSimple('sales', 'المبيعات'); addSimple('purchases', 'المشتريات'); addSimple('expenses', 'المصروفات'); addSimple('otherIncome', 'الإيرادات الأخرى'); addSimple('payroll', 'الرواتب'); addSimple('inventory', 'المخزون'); addSimple('debtsPayable', 'الديون عليّ'); addSimple('debtsReceivable', 'الديون إليّ'); addSimple('debtPayments', 'تسويات الديون'); } else if (entity === 'debts') { addSimple('debtsPayable', 'الديون عليّ'); addSimple('debtsReceivable', 'الديون إليّ'); addSimple('debtPayments', 'تسويات الديون'); } else if (entity === 'debtPayments') addSimple('debtPayments', 'تسويات الديون'); else if (simple[entity]) addSimple(entity, entity === 'inventory' ? 'المخزون' : entity);
    else { const items = await api.list(entity); const ws = XLSX.utils.json_to_sheet(items.length ? items : [{ message: 'لا توجد بيانات' }]); XLSX.utils.book_append_sheet(wb, ws, entity.slice(0, 31)); }
    const blob = new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `101-COFFEE-${entity === 'all' ? 'Full-Report' : entity}-${range?.mode === 'custom' ? `${range.fromDate}-to-${range.toDate}` : label}.xlsx`;
    a.click();
    const exportedRows = entity === 'all'
      ? Object.values(report?.rows || {}).reduce((total, rows) => total + (Array.isArray(rows) ? rows.length : 0), 0)
      : (simple[entity]?.data?.length ?? 0);
    await api.logAudit('EXPORT', entity, entity, { rows: exportedRows });
    return entity;
  }
};

async function resolveSession(user) {
  const existing = await fetchUserProfile(user.uid);
  if (!existing) {
    let authorized = null;
    try {
      authorized = await api.get(`authorized_users/${normalizedEmailKey(user.email)}`);
    } catch (error) {
      console.error('SESSION_FAILED', { code: error.code || 'PROFILE_LOOKUP_FAILED' });
      if (error.code !== 'PERMISSION_DENIED' && error.code !== 'permission-denied') throw error;
    }
    if (!authorized) { await signOut(auth); currentUserProfile = null; throw new Error('هذا الحساب غير مخول لاستخدام النظام.'); }
    if (authorized.active === false || authorized.status === 'disabled') { await signOut(auth); currentUserProfile = null; throw new Error('هذا الحساب موقوف.'); }
    const permissions = permissionsFromFirebase(authorized.permissions || {});
    currentUserProfile = { id: user.uid, name: authorized.name || user.displayName || '', email: user.email, role: authorized.role || 'employee', permissions, active: true };
    await set(ref(db, `users/${user.uid}`), { ...currentUserProfile, permissions: permissionsToRules(permissions), updated_at: new Date().toISOString() });
  } else {
    currentUserProfile = existing;
  }
  if (currentUserProfile.active === false || currentUserProfile.status === 'disabled') { await signOut(auth); currentUserProfile = null; throw new Error('هذا الحساب موقوف.'); }
  let perms = [];
  if (currentUserProfile.role === 'super_admin') perms = [...allPermissionKeys];
  else if (currentUserProfile.role === 'manager') perms = [...allPermissionKeys].filter(p => !['system.reset', 'users.delete', 'audit.delete', 'monthly_periods.reopen'].includes(p));
  else if (currentUserProfile.permissions && Object.keys(currentUserProfile.permissions).length > 0) perms = Object.keys(permissionsFromFirebase(currentUserProfile.permissions));
  else if (currentUserProfile.role === 'supervisor') perms = ['purchases.view', 'purchases.create', 'expenses.view', 'expenses.create', 'sales.view', 'inventory.view', 'inventory.count', 'dashboard.view', 'financial.view_revenue', 'financial.view_payroll_cost', 'other_income.view'];
  else if (currentUserProfile.role === 'cashier') perms = [...cashierDefaultPermissionKeys];
  else if (currentUserProfile.role === 'employee') perms = ['purchases.create', 'expenses.create', 'sales.create'];
  else if (currentUserProfile.role === 'viewer') perms = ['dashboard.view', 'reports.view'];
  if (perms.includes('expenses.create')) perms.push('pos.view');
  const session = { user: currentUserProfile, permissions: perms };
  return session;
}
