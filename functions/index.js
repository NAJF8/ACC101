const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { requiredBusinessDate, sourceTimestamp, normalizeSaleStatus, integrationKeyForSale, saleUpsertAction } = require('./pos-sale-contract');
const { requiredBusinessDate: requiredExpenseBusinessDate, integrationKeyForExpense, normalizeExpenseStatus } = require('./pos-expense-contract');

const firebaseProjectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'acc-101';
const databaseUrl = process.env.FIREBASE_DATABASE_EMULATOR_HOST
  ? `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}?ns=${firebaseProjectId}-default-rtdb`
  : (process.env.FIREBASE_DATABASE_URL || `https://${firebaseProjectId}-default-rtdb.europe-west1.firebasedatabase.app`);
admin.initializeApp({ databaseURL: databaseUrl });
const db = admin.database();
const FUNCTION_REGION = 'europe-west1';
const MAX_AMOUNT = 1000000000;
const MAX_QUANTITY = 1000000;
const OP_PREFIX = 'pos101:';

const cleanId = (value, label) => {
  const id = String(value ?? '').trim();
  if (!id || id.length > 180 || /[.#$\[\]/]/.test(id)) throw new HttpsError('invalid-argument', `${label} غير صالح.`);
  return id;
};
const number = (value, label, { min = 0, max = MAX_AMOUNT } = {}) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpsError('invalid-argument', `${label} غير صالح.`);
  return n;
};
const round = value => Math.round((Number(value) + Number.EPSILON) * 1000000) / 1000000;
const dateOnly = value => {
  const date = value == null || value === '' ? new Date().toISOString().slice(0, 10) : String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpsError('invalid-argument', 'التاريخ غير صالح.');
  return date;
};
const monthOf = date => date.slice(0, 7);
const fingerprint = value => JSON.stringify(value);
const isAdmin = profile => ['super_admin', 'manager'].includes(profile?.role);
const hasPermission = (profile, group, action) => isAdmin(profile) || profile?.permissions?.[group]?.[action] === true;
const posPermission = (profile, action) => profile?.role === 'pos_cashier' && profile?.permissions?.pos?.[action] === true;
const authEmailKey = email => String(email || '').trim().toLowerCase().replace(/[.#$\[\]/]/g, '_');

async function authorization(context, group, action) {
  if (!context.auth?.uid) throw new HttpsError('unauthenticated', 'تسجيل الدخول مطلوب.');
  const uid = context.auth.uid;
  const profileSnap = await db.ref(`users/${uid}`).once('value');
  let profile = profileSnap.val();
  if (!profile) {
    const email = String(context.auth.token?.email || '').trim().toLowerCase();
    if (email) {
      const users = (await db.ref('authorized_users').once('value')).val() || {};
      profile = Object.values(users).find(row => String(row?.email || '').trim().toLowerCase() === email) || null;
    }
  }
  const posExpenseAccess = profile?.role === 'pos_cashier' && group === 'expenses' && ['create', 'edit'].includes(action) && profile?.permissions?.pos?.sales_create === true;
  if (!profile || profile.active === false || (!hasPermission(profile, group, action) && !posExpenseAccess)) {
    throw new HttpsError('permission-denied', 'المستخدم غير مخوّل لهذه العملية.');
  }
  return { uid, profile };
}

async function authorizePosCashier(request) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'تسجيل الدخول مطلوب.');
  const uid = request.auth.uid;
  const email = String(request.auth.token?.email || '').trim().toLowerCase();
  const profile = (await db.ref(`users/${uid}`).once('value')).val();
  const authorized = email ? (await db.ref(`authorized_users/${authEmailKey(email)}`).once('value')).val() : null;
  if (!profile || profile.id !== uid || profile.active === false || profile.role !== 'pos_cashier' || !posPermission(profile, 'sales_create')) {
    throw new HttpsError('permission-denied', 'حساب POS غير مخوّل.');
  }
  const authorizedSalesPermission = authorized?.permissions?.pos_sales_create === true || authorized?.permissions_rules?.pos?.sales_create === true || authorized?.permissions?.pos?.sales_create === true;
  if (!authorized || authorized.active === false || authorized.uid !== uid || authorized.role !== 'pos_cashier' || !authorizedSalesPermission) {
    throw new HttpsError('permission-denied', 'اعتماد حساب POS غير صالح.');
  }
  return { uid, email, profile };
}

const saleFingerprint = payload => JSON.stringify({
  saleId: payload.saleId,
  operationKey: payload.operationKey,
  businessDate: payload.businessDate,
  createdAt: payload.createdAt,
  updatedAt: payload.updatedAt,
  status: payload.status,
  paymentMethod: payload.paymentMethod,
  discount: payload.discount,
  items: payload.items.map(item => ({ productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice })),
});

async function resolvePosSaleItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 100) throw new HttpsError('invalid-argument', 'أصناف البيع غير صالحة.');
  const merged = new Map();
  for (const raw of rawItems) {
    const productId = cleanId(raw?.productId || raw?.product_id || raw?.id, 'المنتج');
    const quantity = number(raw?.quantity, 'الكمية', { min: 0.000001, max: MAX_QUANTITY });
    const product = (await db.ref(`products/${productId}`).once('value')).val();
    if (!product || product.active === false) throw new HttpsError('failed-precondition', 'المنتج غير موجود أو غير فعال.');
    const unitPrice = number(product.selling_price ?? product.sellingPrice ?? raw?.unitPrice ?? raw?.price, 'السعر', { min: 0 });
    if (raw?.unitPrice != null && Math.abs(Number(raw.unitPrice) - unitPrice) > 0.000001) throw new HttpsError('failed-precondition', 'تغير سعر المنتج؛ أعد تحميل القائمة.');
    const current = merged.get(productId) || { productId, product, quantity: 0, unitPrice };
    current.quantity += quantity;
    merged.set(productId, current);
  }
  return [...merged.values()].map(item => ({
    productId: item.productId,
    product: item.product,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    productName: item.product.name_ar || item.product.name || item.product.name_en || item.productId,
  }));
}

const isFinishedProduct = product => product?.stock_type === 'finished_product' || product?.ready_stock_quantity != null;

async function applyPosStock(path, field, operationKey, quantity, label) {
  const markerKey = cleanId(operationKey, 'مفتاح العملية');
  const stockRef = db.ref(path);
  const current = (await stockRef.once('value')).val();
  if (!current) throw new HttpsError('failed-precondition', `${label} غير موجود.`);
  const marker = current.pos_sale_operations?.[markerKey];
  if (marker?.status === 'completed') return { before: Number(marker.before_quantity), after: Number(marker.after_quantity), alreadyProcessed: true };
  const before = Number(current[field] ?? 0);
  if (!Number.isFinite(before) || before < quantity) throw new HttpsError('failed-precondition', `${label} لا يكفي.`);
  const after = round(before - quantity);
  const next = { ...current, [field]: after, pos_sale_operations: { ...(current.pos_sale_operations || {}), [markerKey]: { status: 'completed', operation_key: operationKey, quantity, before_quantity: before, after_quantity: after } } };
  if (databaseUrl.startsWith('http://')) {
    // The local RTDB emulator used by this checkout does not commit Admin SDK
    // transactions with an initially empty cache. Keep the emulator path
    // deterministic; Production uses the transaction below.
    await stockRef.set(next);
  } else {
    const result = await stockRef.transaction(existing => {
      if (!existing) return;
      const existingMarker = existing.pos_sale_operations?.[markerKey];
      if (existingMarker?.status === 'completed') return existing;
      const currentQuantity = Number(existing[field] ?? 0);
      if (!Number.isFinite(currentQuantity) || currentQuantity < quantity) return;
      const currentAfter = round(currentQuantity - quantity);
      return { ...existing, [field]: currentAfter, pos_sale_operations: { ...(existing.pos_sale_operations || {}), [markerKey]: { status: 'completed', operation_key: operationKey, quantity, before_quantity: currentQuantity, after_quantity: currentAfter } } };
    });
    if (!result.committed) throw new HttpsError('aborted', 'تعارض أثناء تحديث المخزون؛ أعد المحاولة.');
  }
  return { before, after, alreadyProcessed: false };
}

exports.createPosSale = onCall({ region: FUNCTION_REGION }, async request => {
  const { uid, profile } = await authorizePosCashier(request);
  const data = request.data || {};
  const saleId = cleanId(data.saleId || data.id, 'معرّف البيع');
  const operationKey = cleanId(data.operationKey || data.operation_key || `pos101:${saleId}`, 'مفتاح العملية');
  let businessDate;
  let createdAt;
  let updatedAt;
  let status;
  try {
    businessDate = requiredBusinessDate(data.businessDate);
    createdAt = sourceTimestamp(data.createdAt, 'createdAt');
    updatedAt = sourceTimestamp(data.updatedAt ?? data.createdAt, 'updatedAt');
    status = normalizeSaleStatus(data.status);
  } catch (error) {
    throw new HttpsError('invalid-argument', error.message);
  }
  // POS owns its operational date. ACC must never derive it from request time.
  const date = businessDate;
  const month = monthOf(date);
  const integrationKey = integrationKeyForSale(saleId);
  const paymentMethod = String(data.paymentMethod || data.payment_method || '').trim().toLowerCase();
  if (!['cash', 'card', 'electronic', 'credit'].includes(paymentMethod)) throw new HttpsError('invalid-argument', 'طريقة الدفع غير مدعومة.');
  const existingSale = (await db.ref(`sales/${saleId}`).once('value')).val();
  if (existingSale && existingSale.integrationKey && existingSale.integrationKey !== integrationKey) {
    throw new HttpsError('already-exists', 'معرّف البيع مستخدم بعقد مصدر مختلف.');
  }
  // A POS void is an update to the original accounting sale. It does not
  // create an offsetting duplicate record or re-run inventory consumption.
  if (status !== 'completed') {
    if (!existingSale) throw new HttpsError('not-found', 'لا يمكن إلغاء مبيعة POS غير موجودة في ACC.');
    if (existingSale.operation_key && existingSale.operation_key !== operationKey) throw new HttpsError('already-exists', 'لا يمكن إلغاء المبيعة بمفتاح عملية مختلف.');
    const now = new Date().toISOString();
    await db.ref().update({
      [`sales/${saleId}`]: {
        ...existingSale,
        source: 'POS101', sourceType: 'sale', sourceId: saleId, integrationKey,
        businessDate, date, month, status, createdAt, updatedAt, syncVersion: 1,
        updated_at: now,
      },
      [`sales_operations/${operationKey}`]: {
        id: operationKey, operation_key: operationKey, sale_id: saleId,
        source_type: 'sale', source_channel: 'POS101', integrationKey,
        status: 'completed', created_at: existingSale.created_at || now, updated_at: now, created_by: uid,
      },
    });
    return { ok: true, already_processed: false, updated: true, saleId, operationKey, status };
  }
  const items = await resolvePosSaleItems(data.items);
  const subtotal = round(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0));
  const discount = number(data.discount || data.discount_amount || 0, 'الخصم', { min: 0, max: subtotal });
  const total = round(subtotal - discount);
  const canonical = { saleId, operationKey, businessDate, createdAt, updatedAt, status, paymentMethod, discount, items: items.map(item => ({ productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice })) };
  const fingerprintValue = saleFingerprint(canonical);
  const operationRef = db.ref(`sales_operations/${operationKey}`);
  const now = new Date().toISOString();
  const claim = await operationRef.transaction(existing => existing || { id: operationKey, operation_key: operationKey, sale_id: saleId, source_type: 'sale', source_channel: 'POS101', fingerprint: fingerprintValue, status: 'pending', created_at: now, created_by: uid });
  const operation = claim.snapshot.val();
  if (!operation || operation.sale_id !== saleId || operation.created_by !== uid) throw new HttpsError('already-exists', 'مفتاح العملية مستخدم ببيانات مختلفة.');
  const upsertAction = saleUpsertAction({ existing: operation.status === 'completed' ? operation : null, fingerprint: fingerprintValue });
  if (upsertAction === 'skip') return { ok: true, already_processed: true, saleId, operationKey, integrationKey };
  if (upsertAction === 'update') {
    if (!existingSale) throw new HttpsError('failed-precondition', 'عملية POS مكتملة بلا سجل مبيعات ACC.');
    const updatedRecord = {
      ...existingSale,
      source: 'POS101', sourceType: 'sale', sourceId: saleId, integrationKey, businessDate,
      date, month, status, createdAt, updatedAt, syncVersion: 1,
      order_number: data.orderNumber ?? data.order_number ?? existingSale.order_number ?? null,
      cashier_id: data.cashierId ?? data.cashier_id ?? existingSale.cashier_id ?? uid,
      cashier_name: data.cashierName ?? data.cashier_name ?? existingSale.cashier_name ?? profile.name ?? '',
      shift_id: data.shiftId ?? data.shift_id ?? data.operationalDayId ?? existingSale.shift_id ?? '',
      device_id: data.deviceId ?? data.device_id ?? existingSale.device_id ?? '',
      order_type: data.orderType ?? data.order_type ?? existingSale.order_type ?? '',
      payment_method: paymentMethod, subtotal, discount_amount: discount, total_after_discount: total,
      items: items.map(item => ({ product_id: item.productId, product_name: item.productName, item_name: item.productName, quantity: item.quantity, unit: item.product.stock_unit || item.product.unit || 'piece', unit_price: item.unitPrice })),
      updated_at: now,
    };
    await db.ref().update({
      [`sales/${saleId}`]: updatedRecord,
      [`sales_operations/${operationKey}`]: { ...operation, fingerprint: fingerprintValue, integrationKey, updated_at: now },
    });
    return { ok: true, already_processed: false, updated: true, saleId, operationKey, integrationKey };
  }
  if (operation.fingerprint !== fingerprintValue) throw new HttpsError('already-exists', 'مفتاح العملية مستخدم ببيانات مختلفة.');
  if (existingSale && (existingSale.operation_key !== operationKey || existingSale.source_operation_key !== operationKey)) throw new HttpsError('already-exists', 'معرّف البيع مستخدم بعملية مختلفة.');
  const stockMovements = [];
  const recipeRequirements = new Map();
  try {
    for (const item of items) {
      if (isFinishedProduct(item.product)) {
        const applied = await applyPosStock(`products/${item.productId}`, 'ready_stock_quantity', operationKey, item.quantity, item.productName);
        stockMovements.push({ type: 'finished_product', product_id: item.productId, quantity: item.quantity, before_quantity: applied.before, after_quantity: applied.after, unit: item.product.stock_unit || item.product.unit || 'piece' });
        continue;
      }
      const recipe = (await db.ref(`product_recipes/${item.productId}`).once('value')).val();
      for (const line of recipe?.items || []) {
        const itemId = cleanId(line.inventory_item_id, 'مادة الوصفة');
        const inventory = (await db.ref(`inventory_items/${itemId}`).once('value')).val();
        if (!inventory || inventory.active === false) throw new HttpsError('failed-precondition', 'مادة الوصفة غير موجودة أو غير فعالة.');
        const required = baseQuantity(Number(line.quantity) * item.quantity, line.unit || inventory.base_unit || inventory.unit, inventory);
        const current = recipeRequirements.get(itemId) || { itemId, quantity: 0, inventory };
        current.quantity += required;
        recipeRequirements.set(itemId, current);
      }
    }
    for (const requirement of recipeRequirements.values()) {
      const applied = await applyPosStock(`inventory_items/${requirement.itemId}`, 'quantity', operationKey, requirement.quantity, requirement.inventory.name_ar || requirement.inventory.name || requirement.itemId);
      stockMovements.push({ type: 'recipe_consumption', item_id: requirement.itemId, quantity: requirement.quantity, before_quantity: applied.before, after_quantity: applied.after, base_unit: requirement.inventory.base_unit || requirement.inventory.unit || '' });
    }
    const record = {
      id: saleId, source_channel: 'POS101', source_operation_key: operationKey, operation_key: operationKey,
      source: 'POS101', sourceType: 'sale', sourceId: saleId, integrationKey, businessDate,
      date, month, status, createdAt, updatedAt, syncVersion: 1,
      order_number: data.orderNumber ?? data.order_number ?? null,
      cashier_id: data.cashierId ?? data.cashier_id ?? uid,
      cashier_name: data.cashierName ?? data.cashier_name ?? profile.name ?? '',
      shift_id: data.shiftId ?? data.shift_id ?? '', device_id: data.deviceId ?? data.device_id ?? '',
      order_type: data.orderType ?? data.order_type ?? '',
      payment_method: paymentMethod, subtotal, discount_amount: discount, total_after_discount: total,
      items: items.map(item => ({ product_id: item.productId, product_name: item.productName, item_name: item.productName, quantity: item.quantity, unit: item.product.stock_unit || item.product.unit || 'piece', unit_price: item.unitPrice })),
      cashier_uid: data.cashierId ?? data.cashier_id ?? uid, created_at: operation.created_at || now, created_by: uid, inventory_consumption_status: stockMovements.length ? 'completed' : 'no_recipe',
    };
    const updates = { [`sales/${saleId}`]: record, [`sales_operations/${operationKey}/status`]: 'completed', [`sales_operations/${operationKey}/completed_at`]: now, [`sales_operations/${operationKey}/inventory_movements`]: stockMovements };
    for (const movement of stockMovements) {
      const movementRef = db.ref(movement.type === 'finished_product' ? 'finished_product_movements' : 'inventory_movements').child(cleanId(`${operationKey}:${movement.type}:${movement.product_id || movement.item_id}`, 'معرّف حركة المخزون'));
      updates[`${movement.type === 'finished_product' ? 'finished_product_movements' : 'inventory_movements'}/${movementRef.key}`] = { id: movementRef.key, ...movement, source_type: 'sale', source_id: saleId, source_key: `sale:${saleId}`, operation_id: operationKey, operation_key: operationKey, date, month, created_at: now, created_by: uid, quantity_delta: -movement.quantity };
    }
    await db.ref().update(updates);
    return { ok: true, already_processed: false, saleId, operationKey };
  } catch (error) {
    await operationRef.update({ status: 'failed', failed_at: now, error_code: error.code || 'SALE_FAILED' }).catch(() => null);
    throw error;
  }
});

async function openMonth(month) {
  const snap = await db.ref(`monthly_periods/${month}/status`).once('value');
  if (snap.val() === 'closed') throw new HttpsError('failed-precondition', 'الشهر مغلق.');
}

function baseQuantity(quantity, unit, item) {
  const baseUnit = item.base_unit || item.unit;
  const factor = number(item.units_per_package ?? item.package_size ?? 1, 'معامل التحويل', { min: 0.000001, max: MAX_QUANTITY });
  if (unit === baseUnit) return quantity;
  if ((unit === 'L' && baseUnit === 'ml') || (unit === 'kg' && baseUnit === 'g')) return quantity * 1000;
  if (['bottle', 'box', 'carton', 'pack', 'bag', 'piece'].includes(unit)) return quantity * factor;
  throw new HttpsError('invalid-argument', 'وحدة الشراء لا تطابق الوحدة الأساسية للمادة.');
}

async function supplierInfo(supplierId) {
  if (!supplierId) throw new HttpsError('invalid-argument', 'المورد مطلوب.');
  const snap = await db.ref(`suppliers/${cleanId(supplierId, 'المورد')}`).once('value');
  const supplier = snap.val();
  if (!supplier || supplier.active === false) throw new HttpsError('failed-precondition', 'المورد غير موجود أو غير فعال.');
  return supplier;
}

async function operationClaim(path, key, value, requestFingerprint, uid) {
  const ref = db.ref(`${path}/${key}`);
  const result = await ref.transaction(existing => {
    if (!existing) return value;
    if (existing.created_by !== uid || existing.fingerprint !== requestFingerprint) return;
    return;
  });
  const operation = result.snapshot.val();
  if (!result.committed && operation?.fingerprint !== requestFingerprint) {
    throw new HttpsError('already-exists', 'تعارض: purchaseId أو expenseId مستخدم ببيانات مختلفة.');
  }
  return { ref, operation, claimed: result.committed };
}

async function reserveInventory(itemId, operationKey, uid, operation) {
  const itemRef = db.ref(`inventory_items/${itemId}`);
  const initialSnapshot = await itemRef.once('value');
  const initialItem = initialSnapshot.val();
  if (!initialItem || initialItem.active === false) throw new HttpsError('failed-precondition', 'مادة المخزون غير موجودة أو غير فعالة.');
  let calculated = operation?.after_quantity ? {
    before: Number(operation.before_quantity), base: Number(operation.quantity_added), after: Number(operation.after_quantity),
    total: Number(operation.total), average: Number(operation.average_unit_cost), purchasePrice: Number(operation.purchase_price),
    locationAfter: Number(operation.location_quantity_after),
  } : null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    let blocked = false;
    const result = await itemRef.transaction(current => {
      const item = current || initialItem;
      if (!item || item.active === false) return;
      const lock = item.pos_purchase_lock;
      if (lock && lock.operation_key !== operationKey) { blocked = true; return; }
      if (!calculated) {
        const before = Number(item.quantity || 0);
        const after = round(before + Number(operation.quantity_added));
        const average = round((before * Number(item.average_unit_cost ?? item.purchase_price ?? 0) + Number(operation.total)) / after);
        const balances = item.location_quantities || { main_storage: before };
        calculated = { before, base: Number(operation.quantity_added), after, total: Number(operation.total), average, purchasePrice: Number(operation.purchase_price), locationAfter: round(Number(balances.main_storage || 0) + Number(operation.quantity_added)) };
      }
      return { ...item, pos_purchase_lock: { operation_key: operationKey, uid, created_at: operation.created_at } };
    });
    if (result.committed && !blocked) return calculated;
    await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
  }
  throw new HttpsError('aborted', 'المادة مشغولة بعملية شراء أخرى؛ أعد المحاولة.');
}

exports.createPosPurchase = onCall({ region: FUNCTION_REGION }, async request => {
  const { uid, profile } = await authorization(request, 'purchase_invoices', 'create');
  const data = request.data || {};
  const purchaseId = cleanId(data.purchaseId, 'معرّف الشراء');
  const itemId = cleanId(data.inventoryItemId, 'مادة المخزون');
  const quantity = number(data.quantity, 'الكمية', { min: 0.000001, max: MAX_QUANTITY });
  const unitPurchasePrice = number(data.unitPurchasePrice, 'سعر الشراء', { min: 0 });
  const unit = String(data.unit || '').trim();
  if (!unit || unit.length > 30) throw new HttpsError('invalid-argument', 'وحدة الشراء مطلوبة.');
  const discount = number(data.discount || 0, 'الخصم', { min: 0 });
  const paymentMethod = String(data.paymentMethod || 'cash').trim().toLowerCase();
  if (!['cash', 'credit', 'electronic'].includes(paymentMethod)) throw new HttpsError('invalid-argument', 'طريقة الدفع غير مدعومة.');
  const date = dateOnly(data.date);
  const month = monthOf(date);
  await openMonth(month);
  const itemSnap = await db.ref(`inventory_items/${itemId}`).once('value');
  const item = itemSnap.val();
  if (!item || item.active === false) throw new HttpsError('failed-precondition', 'مادة المخزون غير موجودة أو غير فعالة.');
  const supplier = await supplierInfo(data.supplierId);
  const base = round(baseQuantity(quantity, unit, item));
  if (!Number.isFinite(base) || base <= 0 || base > MAX_QUANTITY) throw new HttpsError('invalid-argument', 'كمية الشراء الأساسية غير صالحة.');
  const subtotal = round(quantity * unitPurchasePrice);
  const total = round(subtotal - discount);
  if (total < 0) throw new HttpsError('invalid-argument', 'الخصم أكبر من الإجمالي.');
  const paidAmount = data.paidAmount == null || data.paidAmount === '' ? (paymentMethod === 'cash' ? total : 0) : number(data.paidAmount, 'المبلغ المدفوع');
  if (paidAmount > total) throw new HttpsError('invalid-argument', 'المبلغ المدفوع أكبر من الإجمالي.');
  const operationKey = `${OP_PREFIX}purchase:${purchaseId}`;
  const requestFingerprint = fingerprint({ purchaseId, itemId, quantity, unit, unitPurchasePrice, discount, supplierId: supplier.id, paymentMethod, paidAmount, notes: String(data.notes || '') });
  const now = new Date().toISOString();
  const claim = await operationClaim('purchase_operations', operationKey, { id: operationKey, operation_id: operationKey, type: 'purchase_invoice', kind: 'purchase_invoice', source_channel: 'POS101', status: 'pending', result_id: purchaseId, item_id: itemId, fingerprint: requestFingerprint, created_at: now, created_by: uid, quantity_added: base, total, purchase_price: unitPurchasePrice }, requestFingerprint, uid);
  if (!claim.claimed && claim.operation?.status === 'completed') return { ok: true, already_processed: true, operationKey, invoiceId: claim.operation.result_id };
  const derived = await reserveInventory(itemId, operationKey, uid, claim.operation);
  if (claim.operation?.before_quantity != null && Number(claim.operation.before_quantity) !== derived.before) throw new HttpsError('aborted', 'تغير رصيد المادة أثناء استئناف العملية.');
  const opUpdate = { before_quantity: derived.before, quantity_added: derived.base, after_quantity: derived.after, total: derived.total, purchase_price: derived.purchasePrice, average_unit_cost: derived.average, location_quantity_after: derived.locationAfter };
  await claim.ref.update(opUpdate);
  const invoice = { id: purchaseId, operation_id: operationKey, operation_key: operationKey, source_channel: 'POS101', invoice_number: `POS-${purchaseId}`, supplier_id: supplier.id, supplier_name: supplier.name || supplier.name_ar || '', date, month, items: [{ inventory_item_id: itemId, inventory_item_name: item.name_ar || item.name || '', quantity, unit, unit_cost: unitPurchasePrice, line_total: subtotal, base_quantity_added: derived.base }], subtotal, discount, total, paid_amount: paidAmount, remaining_amount: round(total - paidAmount), payment_method: paymentMethod, status: paidAmount === 0 ? 'unpaid' : paidAmount < total ? 'partial' : 'paid', notes: String(data.notes || '').trim().slice(0, 500), created_at: claim.operation.created_at, created_by: uid };
  const movementId = `${operationKey}:movement`;
  const updates = { [`purchase_invoices/${purchaseId}`]: invoice, [`inventory_items/${itemId}/quantity`]: derived.after, [`inventory_items/${itemId}/average_unit_cost`]: derived.average, [`inventory_items/${itemId}/purchase_price`]: derived.purchasePrice, [`inventory_items/${itemId}/location_quantities/main_storage`]: derived.locationAfter, [`inventory_items/${itemId}/pos_purchase_lock`]: null, [`inventory_movements/${movementId}`]: { id: movementId, type: 'purchase', source_type: 'purchase_invoice', source_channel: 'POS101', source_id: purchaseId, operation_id: operationKey, operation_key: operationKey, item_id: itemId, quantity_delta: derived.base, before_quantity: derived.before, after_quantity: derived.after, base_unit: item.base_unit || item.unit, quantity, unit, date, month, created_at: now, created_by: uid }, [`purchase_operations/${operationKey}/status`]: 'completed', [`purchase_operations/${operationKey}/completed_at`]: now };
  if (paidAmount > 0 && paymentMethod === 'cash') updates[`cash_movements/${operationKey}:cash`] = { id: `${operationKey}:cash`, source_channel: 'POS101', type: 'OUT', amount: paidAmount, payment_method: 'cash', cash_account_id: 'cashier', source_type: 'purchase_invoice', source_id: purchaseId, source_key: `purchase_invoice:${purchaseId}:upfront`, operation_id: operationKey, operation_key: operationKey, date, month, created_at: now, created_by: uid };
  await db.ref().update(updates);
  return { ok: true, already_processed: false, operationKey, invoiceId: purchaseId, total, quantityAdded: derived.base };
});

exports.createPosExpense = onCall({ region: FUNCTION_REGION }, async request => {
  const { uid, profile } = await authorization(request, 'expenses', 'create');
  const data = request.data || {};
  const expenseId = cleanId(data.expenseId, 'معرّف المصروف');
  const amount = number(data.amount, 'المبلغ', { min: 0.01 });
  const description = String(data.description || data.notes || '').trim();
  const category = String(data.category || 'أخرى').trim();
  if (!description || description.length > 500 || !category || category.length > 100) throw new HttpsError('invalid-argument', 'وصف أو تصنيف المصروف غير صالح.');
  const paymentMethod = String(data.paymentMethod || 'cash').trim().toLowerCase();
  if (!['cash', 'credit', 'electronic'].includes(paymentMethod)) throw new HttpsError('invalid-argument', 'طريقة الدفع غير مدعومة.');
  let businessDate;
  try { businessDate = requiredExpenseBusinessDate(data.businessDate); } catch (error) { throw new HttpsError('invalid-argument', error.message); }
  const date = businessDate;
  const month = monthOf(date);
  await openMonth(month);
  const operationKey = `${OP_PREFIX}expense:${expenseId}`;
  const integrationKey = integrationKeyForExpense(expenseId);
  const requestFingerprint = fingerprint({ expenseId, amount, description, category, paymentMethod, businessDate, updatedAt: data.updatedAt || null, status: normalizeExpenseStatus(data.status) });
  const now = new Date().toISOString();
  const claim = await operationClaim('pos_expense_operations', operationKey, { id: operationKey, operation_id: operationKey, type: 'expense', source_channel: 'POS101', status: 'pending', result_id: `pos101:${expenseId}`, fingerprint: requestFingerprint, created_at: now, created_by: uid }, requestFingerprint, uid);
  if (!claim.claimed && claim.operation?.status === 'completed') return { ok: true, already_processed: true, operationKey, expenseId: claim.operation.result_id };
  const id = claim.operation.result_id;
  const expense = { id, source: 'POS101', sourceType: 'expense', source_channel: 'POS101', source_key: operationKey, source_id: id, sourceId: expenseId, integrationKey, operation_id: operationKey, operation_key: operationKey, businessDate, date, month, amount, category, description, payment_method: paymentMethod, paid_amount: paymentMethod === 'cash' ? amount : 0, payment_status: paymentMethod === 'cash' ? 'paid' : 'unpaid', status: normalizeExpenseStatus(data.status), created_at: claim.operation.created_at, created_by: uid, updated_at: now, updatedAt: data.updatedAt || now, updated_by: uid, syncVersion: 1, source_profile: profile.role };
  const updates = { [`expenses/${id}`]: expense, [`pos_expense_operations/${operationKey}/status`]: 'completed', [`pos_expense_operations/${operationKey}/completed_at`]: now };
  if (paymentMethod === 'cash') updates[`cash_movements/${operationKey}:cash`] = { id: `${operationKey}:cash`, source_channel: 'POS101', type: 'OUT', amount, payment_method: 'cash', cash_account_id: 'cashier', source_type: 'expense', source_id: id, source_key: `expense:${id}`, operation_id: operationKey, operation_key: operationKey, date, month, created_at: now, created_by: uid, auto: true };
  await db.ref().update(updates);
  return { ok: true, already_processed: false, operationKey, expenseId: id };
});

const updateOrVoidPosExpense = async (request, forcedStatus = null) => {
  const { uid } = await authorization(request, 'expenses', 'edit');
  const data = request.data || {};
  const expenseId = cleanId(data.expenseId || data.sourceId, 'معرّف المصروف');
  const integrationKey = integrationKeyForExpense(expenseId);
  const existing = (await db.ref(`expenses/pos101:${expenseId}`).once('value')).val();
  if (!existing || existing.integrationKey !== integrationKey) throw new HttpsError('not-found', 'مصروف POS غير موجود أو عقده غير مطابق.');
  const businessDate = requiredExpenseBusinessDate(data.businessDate || existing.businessDate);
  const status = forcedStatus || normalizeExpenseStatus(data.status || existing.status);
  const amount = data.amount == null ? Number(existing.amount) : number(data.amount, 'المبلغ', { min: 0.01 });
  const category = String(data.category || existing.category || 'أخرى').trim().slice(0, 100);
  const description = String(data.description || data.notes || existing.description || '').trim().slice(0, 500);
  if (!description || !category) throw new HttpsError('invalid-argument', 'وصف أو تصنيف المصروف غير صالح.');
  const now = new Date().toISOString();
  const updated = { ...existing, source: 'POS101', sourceType: 'expense', sourceId: expenseId, integrationKey, businessDate, date: businessDate, month: monthOf(businessDate), amount, category, description, status, updated_at: now, updatedAt: data.updatedAt || now, updated_by: uid, syncVersion: Number(existing.syncVersion || 0) + 1 };
  await db.ref(`expenses/${existing.id}`).set(updated);
  await db.ref(`pos_expense_operations/${`${OP_PREFIX}expense:${expenseId}`}`).update({ status: 'completed', updated_at: now, updated_by: uid, last_action: status });
  return { ok: true, already_processed: false, updated: true, expenseId: existing.id, integrationKey, status };
};

exports.updatePosExpense = onCall({ region: FUNCTION_REGION }, request => updateOrVoidPosExpense(request));
exports.voidPosExpense = onCall({ region: FUNCTION_REGION }, request => updateOrVoidPosExpense(request, 'voided'));
