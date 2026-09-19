export const inventoryQuantity = (item = {}) => {
  const raw = Number(item.quantity ?? item.current_stock ?? item.stock ?? item.initial_stock ?? 0);
  const baseUnit = item?.base_unit || item?.unit;
  const purchaseUnit = item?.purchase_unit || item?.unit;
  const packageSize = Number(item?.units_per_package ?? item?.package_size ?? 0);
  
  const isVol = baseUnit === 'ml' && purchaseUnit === 'L';
  const isMass = baseUnit === 'g' && purchaseUnit === 'kg';
  if ((isVol || isMass) && packageSize <= 1) {
    return raw * 1000;
  }
  return raw;
};
const MASS = new Set(['g', 'kg']);
const VOLUME = new Set(['ml', 'L']);
const COUNT = new Set(['piece']);
export const BASE_UNITS = ['ml', 'L', 'g', 'kg', 'piece'];
export const PACKAGE_UNITS = ['bottle', 'box', 'carton', 'pack', 'bag', 'piece'];

export const unitFamily = (unit) => MASS.has(unit) ? 'mass' : VOLUME.has(unit) ? 'volume' : COUNT.has(unit) ? 'count' : null;
export const toBaseQuantity = ({ quantity, unit, baseUnit, conversionFactor = 1 }) => {
  const qty = Number(quantity), factor = Number(conversionFactor);
  if (!Number.isFinite(qty) || qty < 0 || !Number.isFinite(factor) || factor <= 0) throw new Error('كمية أو معامل تحويل غير صالح.');
  if (unit === baseUnit) return qty;
  if ((unit === 'L' && baseUnit === 'ml') || (unit === 'kg' && baseUnit === 'g')) return qty * 1000;
  if (PACKAGE_UNITS.includes(unit)) return qty * factor;
  if (unitFamily(unit) !== unitFamily(baseUnit)) throw new Error(`لا يمكن تحويل ${unit} إلى ${baseUnit}.`);
  throw new Error(`يلزم معامل تحويل صريح من ${unit} إلى ${baseUnit}.`);
};

export const weightedAverageCost = ({ oldQuantity = 0, oldUnitCost = 0, addedQuantity = 0, addedTotalCost = 0 }) => {
  const before = Number(oldQuantity), oldCost = Number(oldUnitCost), added = Number(addedQuantity), addedCost = Number(addedTotalCost);
  if ([before, oldCost, added, addedCost].some((value) => !Number.isFinite(value) || value < 0) || before + added <= 0) throw new Error('مدخلات متوسط التكلفة غير صالحة.');
  return (before * oldCost + addedCost) / (before + added);
};

export const recipeCost = ({ recipe = [], inventory = [], products = [] }) => {
  const byId = new Map(inventory.map((item) => [item.id, item]));
  const lines = recipe.map((line) => {
    const item = byId.get(line.inventory_item_id); if (!item) throw new Error('مادة الوصفة غير موجودة.');
    const quantity = toBaseQuantity({ quantity: line.quantity, unit: line.unit || item.base_unit, baseUnit: item.base_unit || item.unit, conversionFactor: line.conversion_factor || 1 });
    const unitCost = inventoryBaseUnitCost(item) ?? 0;
    return { ...line, item_name: item.name_ar || item.name, base_quantity: quantity, unit_cost: unitCost, cost: quantity * unitCost };
  });
  return { lines, total: lines.reduce((sum, line) => sum + line.cost, 0) };
};

export const availableServings = ({ recipe = [], inventory = [] }) => {
  const byId = new Map(inventory.map((item) => [item.id, item]));
  if (!recipe.length) return null;
  const servings = recipe.map((line) => {
    const item = byId.get(line.inventory_item_id); if (!item) return 0;
    const required = toBaseQuantity({ quantity: line.quantity, unit: line.unit || item.base_unit, baseUnit: item.base_unit || item.unit, conversionFactor: line.conversion_factor || 1 });
    return required > 0 ? Math.floor(inventoryQuantity(item) / required) : 0;
  });
  return Math.min(...servings);
};

export const selectFefoBatches = ({ batches = [], quantity, today = new Date().toISOString().slice(0, 10) }) => {
  let remaining = Number(quantity); if (!Number.isFinite(remaining) || remaining <= 0) throw new Error('كمية الصرف غير صالحة.');
  const choices = [];
  for (const batch of batches.filter((row) => !row.deleted && Number(row.remaining_quantity) > 0 && (!row.expiry_date || row.expiry_date >= today)).sort((a, b) => String(a.expiry_date || '9999').localeCompare(String(b.expiry_date || '9999')))) {
    const take = Math.min(remaining, Number(batch.remaining_quantity)); choices.push({ batch_id: batch.id, quantity: take }); remaining -= take; if (!remaining) break;
  }
  if (remaining > 0) throw new Error('كمية الدفعات المتاحة لا تكفي.'); return choices;
};

export const expiryAlerts = ({ batches = [], today = new Date().toISOString().slice(0, 10) }) => batches.filter((batch) => batch.expiry_date && Number(batch.remaining_quantity) > 0).map((batch) => ({ ...batch, days: Math.ceil((new Date(`${batch.expiry_date}T12:00:00`) - new Date(`${today}T12:00:00`)) / 86400000) })).filter((batch) => batch.days <= 30).sort((a, b) => a.days - b.days);
export const expiryStatus = (days) => days < 0 ? 'expired' : days <= 7 ? 'very_soon' : days <= 30 ? 'soon' : 'healthy';
export const filterExpiry = ({ batches = [], filter = 'all', today }) => expiryAlerts({ batches, today }).filter((batch) => filter === 'all' || (filter === 'expired' && batch.days < 0) || (filter === '7' && batch.days >= 0 && batch.days <= 7) || (filter === '14' && batch.days >= 0 && batch.days <= 14) || (filter === '30' && batch.days >= 0 && batch.days <= 30));
export const inventoryBaseUnitCost = (item) => {
  const purchase = Number(item?.purchase_price ?? item?.last_purchase_price);
  const packageSize = Number(item?.units_per_package ?? item?.package_size ?? 0);
  const baseUnit = item?.base_unit || item?.unit;
  const purchaseUnit = item?.purchase_unit || item?.unit;

  // Legacy data robustness: if the user hasn't explicitly set package_size for L/kg -> ml/g, we infer it.
  const isVol = baseUnit === 'ml' && purchaseUnit === 'L';
  const isMass = baseUnit === 'g' && purchaseUnit === 'kg';
  const inferredPackageSize = (isVol || isMass) && packageSize <= 1 ? 1000 : packageSize;

  const average = Number(item?.average_unit_cost);
  if (Number.isFinite(average) && average >= 0) {
    // If the database has an absurdly high average_unit_cost because of the previous bug (e.g. average = 10000 but it should be 10)
    // we detect if average == purchase and it's a volumetric/mass conversion where it SHOULD have been divided by 1000.
    if ((isVol || isMass) && average === purchase && inferredPackageSize === 1000) {
      return average / 1000;
    }
    return average;
  }

  if (!Number.isFinite(purchase) || purchase < 0) return null;
  if (PACKAGE_UNITS.includes(item?.unit) && (!item?.base_unit || !inferredPackageSize)) return null;
  if (inferredPackageSize > 1 && baseUnit && purchaseUnit !== baseUnit) return purchase / inferredPackageSize;
  if (baseUnit && purchaseUnit === baseUnit) return purchase;
  return null;
};
export const inventoryValue = (item) => {
  const unitCost = inventoryBaseUnitCost(item);
  return unitCost == null ? 0 : roundInventory(Number(item?.quantity || 0) * unitCost);
};
export const packageSize = (item) => {
  const value = Number(item?.units_per_package ?? item?.package_size ?? 0);
  return Number.isFinite(value) && value > 0 ? value : null;
};
export const packageEquivalent = (item) => {
  const size = packageSize(item);
  if (!size || isAmbiguousInventoryUnit(item)) return null;
  return roundInventory(Number(item?.quantity ?? item?.current_stock ?? item?.stock ?? 0) / size);
};
export const servingsRemaining = (item) => {
  const usage = Number(item?.usage_per_serving ?? item?.quantity_per_serving ?? 0);
  if (!Number.isFinite(usage) || usage <= 0) return null;
  return Math.floor(Number(item?.quantity ?? item?.current_stock ?? item?.stock ?? 0) / usage);
};
export const servingCost = (item) => {
  const usage = Number(item?.usage_per_serving ?? item?.quantity_per_serving ?? 0);
  const cost = inventoryBaseUnitCost(item);
  return usage > 0 && cost != null ? roundInventory(usage * cost) : null;
};
export const movementConsumption = (movements = [], itemId) => movements
  .filter((move) => move?.item_id === itemId && Number(move?.quantity_delta) < 0)
  .reduce((sum, move) => sum + Math.abs(Number(move.quantity_delta || 0)), 0);
export const movementConsumptionBySource = (movements = [], itemId) => {
  const result = {};
  movements.filter((move) => move?.item_id === itemId && Number(move?.quantity_delta) < 0)
    .forEach((move) => { const key = move.source_type === 'sale' ? 'sales' : move.type === 'waste' ? 'waste' : 'adjustments'; result[key] = roundInventory((result[key] || 0) + Math.abs(Number(move.quantity_delta || 0))); });
  return result;
};

const recordDate = (row = {}) => String(row.date || row.created_at || row.createdAt || '').slice(0, 10);
const saleQuantity = (row = {}) => Number(row.quantity ?? row.qty ?? row.units ?? 0) || 0;
const saleRevenue = (row = {}) => Number(row.total_after_discount ?? row.total ?? row.amount ?? (saleQuantity(row) * Number(row.unit_price ?? row.unitPrice ?? 0))) || 0;
const recipeRows = (recipes = []) => recipes instanceof Map ? recipes : new Map(recipes.map((row) => [row.id || row.product_id, row]));

// Sales analytics use one central snapshot. Existing recipe-consumption movements are
// authoritative; reconstruction is only used for sales with no recorded movement.
export const buildInventorySalesAnalytics = ({ items = [], movements = [], sales = [], recipes = [], products = [], range = {}, today = new Date().toISOString().slice(0, 10), lookbackDays = 30 } = {}) => {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const recipeByProduct = recipeRows(recipes);
  const productById = new Map(products.map((product) => [product.id, product]));
  const salesInRange = sales.filter((sale) => !sale.deleted && (!range || !range.mode || (range.mode === 'custom' ? recordDate(sale) >= range.fromDate && recordDate(sale) <= range.toDate : !range.month || range.month === 'all' || (recordDate(sale) || String(sale.month || '')).slice(0, 7) === range.month)));
  const saleById = new Map(sales.map((sale) => [sale.id, sale]));
  const movementBySale = new Map();
  movements.filter((move) => move.source_type === 'sale' && Number(move.quantity_delta) < 0).forEach((move) => {
    const sale = saleById.get(move.source_id);
    const key = move.source_id || move.source_key;
    if (!key) return;
    const row = movementBySale.get(key) || { movements: [], sale };
    row.movements.push(move);
    movementBySale.set(key, row);
  });
  const materials = new Map();
  const productsAnalytics = new Map();
  const addMaterial = (itemId, productId, units, quantity, source) => {
    if (!itemById.has(itemId) || quantity <= 0) return;
    const material = materials.get(itemId) || { item_id: itemId, consumption: 0, linked_units: 0, products: new Map() };
    material.consumption = roundInventory(material.consumption + quantity);
    material.linked_units += units;
    const product = material.products.get(productId) || { product_id: productId, units: 0, consumption: 0 };
    product.units += units; product.consumption = roundInventory(product.consumption + quantity); product.source = source;
    material.products.set(productId, product); materials.set(itemId, material);
  };
  salesInRange.forEach((sale) => {
    const units = saleQuantity(sale), productId = sale.product_id;
    if (!productId || units <= 0) return;
    const recipe = recipeByProduct.get(productId);
    const recorded = movementBySale.get(sale.id) || movementBySale.get(sale.operation_key) || movementBySale.get(`sale:${sale.id}`);
    const product = productsAnalytics.get(productId) || { product_id: productId, product_name: sale.product_name || productById.get(productId)?.name_ar || productId, units: 0, revenue: 0, material_cost: 0 };
    product.units += units; product.revenue = roundInventory(product.revenue + saleRevenue(sale));
    if (recorded?.movements?.length) {
      recorded.movements.forEach((move) => {
        const moveProductId = move.product_id || productId;
        const quantity = Math.abs(Number(move.quantity_delta || 0));
        addMaterial(move.item_id, moveProductId, units, quantity, 'movement');
        product.material_cost = roundInventory(product.material_cost + quantity * Number(itemById.get(move.item_id)?.average_unit_cost ?? itemById.get(move.item_id)?.purchase_price ?? 0));
      });
    }
    productsAnalytics.set(productId, product);
  });
  // Coverage may have valid historical movements even when their sale documents
  // are outside the selected period or have already been archived.
  movements.filter((move) => move.source_type === 'sale' && Number(move.quantity_delta) < 0 && itemById.has(move.item_id)).forEach((move) => {
    if (!materials.has(move.item_id)) materials.set(move.item_id, { item_id: move.item_id, consumption: 0, linked_units: 0, products: new Map() });
  });
  const lookbackStart = new Date(`${today}T12:00:00`); lookbackStart.setDate(lookbackStart.getDate() - lookbackDays + 1);
  const validDays = new Set(); const lookbackConsumption = new Map();
  movements.filter((move) => move.source_type === 'sale' && Number(move.quantity_delta) < 0).forEach((move) => {
    const date = recordDate(move), when = new Date(`${date}T12:00:00`);
    if (!date || Number.isNaN(when.getTime()) || when < lookbackStart || when > new Date(`${today}T12:00:00`)) return;
    const quantity = Math.abs(Number(move.quantity_delta || 0));
    validDays.add(date); lookbackConsumption.set(move.item_id, (lookbackConsumption.get(move.item_id) || 0) + quantity);
  });
  materials.forEach((material, itemId) => {
    material.products = [...material.products.values()].map((row) => { const product = productsAnalytics.get(row.product_id) || {}; return { ...row, product_name: product.product_name || row.product_id, revenue: product.revenue || 0, material_cost: product.material_cost || 0, difference: product.difference || 0, percentage: material.consumption ? row.consumption / material.consumption * 100 : 0 }; });
    const daily = validDays.size ? roundInventory((lookbackConsumption.get(itemId) || 0) / validDays.size) : null;
    material.average_daily_consumption = daily;
    material.coverage_days = daily > 0 ? roundInventory(Number(itemById.get(itemId)?.quantity || 0) / daily) : null;
  });
  return { materials: [...materials.values()], products: [...productsAnalytics.values()].map((row) => ({ ...row, difference: roundInventory(row.revenue - row.material_cost) })), valid_lookback_days: validDays.size, lookback_days: lookbackDays };
};
export const isAmbiguousInventoryUnit = (item) => {
  const unit = item?.base_unit || item?.unit;
  return PACKAGE_UNITS.includes(item?.unit) && (!item?.base_unit || !Number(item?.units_per_package ?? item?.package_size));
};
export const lowStockStatus = (item) => { const qty = Number(item?.quantity || 0), minimum = Number(item?.min_stock || 0); return qty <= 0 ? 'out' : qty <= minimum ? 'low' : 'available'; };
export const sortLowStock = (items = []) => [...items].sort((a, b) => ({ out: 0, low: 1, available: 2 }[lowStockStatus(a)] - { out: 0, low: 1, available: 2 }[lowStockStatus(b)]));
export const sortHistory = (movements = []) => [...movements].sort((a, b) => String(b.created_at || b.date || '').localeCompare(String(a.created_at || a.date || '')));

export const normalizeBarcode = (value) => String(value ?? '').trim();
export const makeInternalCode = (itemId) => `101-MAT-${String(itemId).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(-12)}`;
export const barcodeMatch = (items, code) => {
  const normalized = normalizeBarcode(code);
  if (!normalized) return null;
  return items.find((item) => [item.barcode, item.internal_barcode].some((value) => normalizeBarcode(value) === normalized)) || null;
};

export const DEFAULT_LOCATION_ID = 'main_storage';
export const locationBalances = (item) => {
  const stored = item?.location_quantities;
  if (stored && typeof stored === 'object') return { ...stored };
  return { [DEFAULT_LOCATION_ID]: Number(item?.quantity ?? item?.current_stock ?? item?.stock ?? 0) };
};
export const locationQuantity = (item, locationId = DEFAULT_LOCATION_ID) => Number(locationBalances(item)[locationId] || 0);
export const roundInventory = (value) => Math.round((Number(value) + Number.EPSILON) * 1000000) / 1000000;
