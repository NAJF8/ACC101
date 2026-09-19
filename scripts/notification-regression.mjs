import assert from 'node:assert/strict';
import { buildSystemNotifications } from '../src/services/notifications.js';

const alerts = buildSystemNotifications({
  month: '2026-09',
  inventory: [{ id: 'syrup', name_ar: 'سيروب الفراولة', quantity: 440, min_stock: 500, base_unit: 'ml' }, { id: 'cups', name_ar: 'أكواب 12oz', quantity: 0, min_stock: 10, base_unit: 'piece' }],
  products: [{ id: 'mojito', name_ar: 'موهيتو' }, { id: 'coffee', name_ar: 'قهوة' }],
  recipes: [{ id: 'mojito', product_id: 'mojito', items: [{ inventory_item_id: 'syrup', quantity: 20, unit: 'ml' }] }],
  sales: [{ id: 'review', month: '2026-09', date: '2026-09-10', payment_method: '' }],
  operations: [{ id: 'stuck', status: 'recovery_required' }],
  periods: [{ month: '2026-09', status: 'closed', closed_at: '2026-09-30T20:00:00.000Z' }],
});
assert.equal(new Set(alerts.map((item) => item.id)).size, alerts.length);
assert(alerts.some((item) => item.type === 'low' && item.message.includes('22 حصة')));
assert(alerts.some((item) => item.type === 'out'));
assert(alerts.some((item) => item.type === 'missing_recipe' && item.target.productId === 'coffee'));
assert(alerts.some((item) => item.type === 'review_sale'));
assert(alerts.some((item) => item.type === 'inventory_operation'));
assert(alerts.some((item) => item.type === 'month_closed'));
console.log('NOTIFICATION_REGRESSION_PASS');
