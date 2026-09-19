import { lowStockStatus } from './inventory.js';
import { getRecordMonth, resolvePaymentMethod } from './financial.js';

const stamp = (row = {}) => row.updated_at || row.created_at || row.closed_at || row.reopened_at || row.date || '';
const materialName = (row = {}) => row.name_ar || row.name || row.id || 'مادة مخزون';
const productName = (row = {}) => row.name_ar || row.nameAr || row.name || row.id || 'منتج';

// These alerts are deliberately derived from canonical RTDB records.  They are
// not written back during a listener refresh, so reconnecting cannot create
// duplicated notification records.
export const buildSystemNotifications = ({ inventory = [], products = [], recipes = [], sales = [], operations = [], periods = [], month = '' } = {}) => {
  const recipeIds = new Set(recipes.filter((recipe) => recipe?.items?.length).map((recipe) => String(recipe.product_id || recipe.id)));
  const result = [];
  inventory.filter((item) => item.active !== false).forEach((item) => {
    const state = lowStockStatus(item);
    if (state === 'available') return;
    const quantity = Number(item.quantity || 0);
    const unit = item.base_unit || item.unit || '';
    const consumers = recipes.flatMap((recipe) => (recipe.items || []).filter((line) => String(line.inventory_item_id) === String(item.id)).map((line) => ({ recipe, line })));
    const onlyConsumer = consumers.length === 1 ? consumers[0] : null;
    const servings = onlyConsumer && Number(onlyConsumer.line.quantity) > 0 ? Math.floor(quantity / Number(onlyConsumer.line.quantity)) : null;
    result.push({
      id: `${state}:inventory:${item.id}`,
      type: state,
      severity: state === 'out' ? 'urgent' : 'followup',
      title: state === 'out' ? `${materialName(item)} نفدت من المخزون` : `${materialName(item)} قرب على النفاد`,
      message: state === 'out' ? 'لا توجد كمية متاحة.' : `${`المتبقي ${quantity.toLocaleString('en-US')} ${unit}`.trim()}${servings != null ? ` — يكفي تقريبًا لـ ${servings} حصة` : ''}`,
      target: { page: 'inventory', materialId: item.id },
      timestamp: stamp(item),
    });
  });
  products.filter((product) => product.active !== false && !recipeIds.has(String(product.id))).forEach((product) => {
    result.push({ id: `missing_recipe:product:${product.id}`, type: 'missing_recipe', severity: 'followup', title: `المنتج ${productName(product)} لا يحتوي على وصفة`, message: 'افتح الوصفة وحدد المواد والكميات قبل البيع.', target: { page: 'products', productId: product.id }, timestamp: stamp(product) });
  });
  sales.filter((sale) => !sale.deleted && (!month || getRecordMonth(sale) === month) && resolvePaymentMethod(sale.payment_method) === 'unknown').forEach((sale) => {
    result.push({ id: `review_sale:${sale.id}`, type: 'review_sale', severity: 'urgent', title: 'عملية بيع تحتاج مراجعة', message: 'طريقة الدفع غير محددة لهذه العملية.', target: { page: 'payment_review', saleId: sale.id }, timestamp: stamp(sale) });
  });
  operations.filter((operation) => ['pending', 'recovery_required', 'manual_recovery'].includes(operation.status)).forEach((operation) => {
    result.push({ id: `inventory_operation:${operation.id}`, type: 'inventory_operation', severity: 'urgent', title: 'عملية مخزون تحتاج متابعة', message: `الحالة: ${operation.status}`, target: { page: 'inventory', operationId: operation.id }, timestamp: stamp(operation) });
  });
  periods.filter((period) => period?.month && (!month || period.month === month) && ['closed', 'open'].includes(period.status) && (period.closed_at || period.reopened_at || period.opened_at)).forEach((period) => {
    const closed = period.status === 'closed';
    const type = closed ? 'month_closed' : period.reopened_at ? 'month_reopened' : 'month_opened';
    result.push({ id: `${type}:${period.month}:${stamp(period)}`, type, severity: 'info', title: closed ? `تم إغلاق شهر ${period.month}` : type === 'month_reopened' ? `تمت إعادة فتح شهر ${period.month}` : `تم فتح شهر ${period.month} للعمليات الجديدة`, message: closed ? 'انتقلت العمليات الجديدة إلى الشهر التالي المفتوح.' : type === 'month_reopened' ? 'أصبح الشهر متاحاً مجدداً للمستخدم المخول.' : 'الفترة الجديدة مفتوحة بعد ترحيل الرصيد.', target: { page: 'dashboard', month: period.month }, timestamp: stamp(period) });
  });
  return result.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)) || a.id.localeCompare(b.id));
};
