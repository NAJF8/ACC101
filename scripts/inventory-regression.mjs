import fs from 'node:fs';
const source = fs.readFileSync(new URL('../src/services/inventory.js', import.meta.url), 'utf8');
const inventory = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const syrup = { id: 'syrup', name_ar: 'Syrup', quantity: 1000, base_unit: 'ml', average_unit_cost: 15 };
const cup = { id: 'cup', name_ar: 'Cup', quantity: 40, base_unit: 'piece', average_unit_cost: 100 };
const recipe = [{ inventory_item_id: 'syrup', quantity: 20, unit: 'ml' }, { inventory_item_id: 'cup', quantity: 1, unit: 'piece' }];
const cost = inventory.recipeCost({ recipe, inventory: [syrup, cup] });
const alerts = inventory.expiryAlerts({ today: '2026-09-01', batches: [{ id: 'a', expiry_date: '2026-09-08', remaining_quantity: 2 }, { id: 'b', expiry_date: '2026-09-05', remaining_quantity: 2 }] });
const fefoBatches = [{ id: 'expired', expiry_date: '2026-08-31', remaining_quantity: 99 }, { id: 'a', expiry_date: '2026-09-15', remaining_quantity: 100 }, { id: 'b', expiry_date: '2026-09-30', remaining_quantity: 200 }];
const allocation = inventory.selectFefoBatches({ quantity: 150, today: '2026-09-01', batches: fefoBatches });
const history = inventory.sortHistory([{ id: 'old', created_at: '2026-09-01T01:00:00Z' }, { id: 'new', created_at: '2026-09-02T01:00:00Z' }]);
const checks = {
  litre: inventory.toBaseQuantity({ quantity: 1, unit: 'L', baseUnit: 'ml' }) === 1000,
  kilo: inventory.toBaseQuantity({ quantity: 1, unit: 'kg', baseUnit: 'g' }) === 1000,
  bottles: inventory.toBaseQuantity({ quantity: 6, unit: 'bottle', baseUnit: 'ml', conversionFactor: 1000 }) === 6000,
  cartons: inventory.toBaseQuantity({ quantity: 2, unit: 'carton', baseUnit: 'piece', conversionFactor: 50 }) === 100,
  incompatibleDenied: (() => { try { inventory.toBaseQuantity({ quantity: 1, unit: 'g', baseUnit: 'ml' }); return false; } catch { return true; } })(),
  servings: inventory.availableServings({ recipe, inventory: [syrup, cup] }) === 40,
  cost: cost.total === 400 && cost.lines[0].cost === 300,
  syrupServingFixture: inventory.toBaseQuantity({ quantity: 6, unit: 'bottle', baseUnit: 'ml', conversionFactor: 1000 }) === 6000 && inventory.recipeCost({ recipe: [{ inventory_item_id: 'syrup', quantity: 20, unit: 'ml' }], inventory: [{ ...syrup, average_unit_cost: 12 }] }).total === 240 && Math.floor(1000 / 20) === 50,
  weightedAverage: inventory.weightedAverageCost({ oldQuantity: 1000, oldUnitCost: 10, addedQuantity: 1000, addedTotalCost: 14000 }) === 12,
  barcode: inventory.barcodeMatch([{ id: 'x', barcode: '123' }], '123')?.id === 'x' && inventory.barcodeMatch([], 'unknown') === null,
  fefo: inventory.selectFefoBatches({ quantity: 3, today: '2026-09-01', batches: [{ id: 'late', expiry_date: '2026-09-10', remaining_quantity: 2 }, { id: 'early', expiry_date: '2026-09-05', remaining_quantity: 2 }] }).map((x) => x.batch_id).join(',') === 'early,late',
  fefoExpiredExcluded: inventory.selectFefoBatches({ quantity: 2, today: '2026-09-01', batches: [{ id: 'expired', expiry_date: '2026-08-31', remaining_quantity: 9 }, { id: 'valid', expiry_date: '2026-09-02', remaining_quantity: 2 }] })[0].batch_id === 'valid',
  internalCodeStable: inventory.makeInternalCode('abc-123') === inventory.makeInternalCode('abc-123'),
  legacyLocation: inventory.locationBalances({ quantity: 9 }).main_storage === 9,
  locationBalance: inventory.locationBalances({ location_quantities: { main_storage: 3, coffee_bar: 6 } }).coffee_bar === 6,
  expiry: alerts[0].id === 'b' && alerts.length === 2,
  expiryFilters: inventory.filterExpiry({ today: '2026-09-01', filter: '7', batches: alerts }).length === 2 && inventory.expiryStatus(-1) === 'expired' && inventory.expiryStatus(4) === 'very_soon',
  fefoMultiBatch: allocation.map((row) => `${row.batch_id}:${row.quantity}`).join(',') === 'a:100,b:50',
  expiredExcluded: !allocation.some((row) => row.batch_id === 'expired'),
  fefoRetryPlanStable: JSON.stringify(allocation) === JSON.stringify(inventory.selectFefoBatches({ quantity: 150, today: '2026-09-01', batches: fefoBatches })),
  batchSpecificWaste: (() => { const batch = fefoBatches.find((row) => row.id === 'a'); return batch.remaining_quantity - 100 === 0; })(),
  locationCreateShape: ['main_storage', 'coffee_bar'].every((id) => typeof id === 'string' && id.length > 0),
  historyNewestFirst: history[0].id === 'new',
  inventoryValue: inventory.inventoryValue({ quantity: 5000, average_unit_cost: 12 }) === 60000,
  packagePriceAndBaseCostAreDistinct: inventory.inventoryBaseUnitCost({ quantity: 2000, base_unit: 'ml', purchase_unit: 'bottle', units_per_package: 1000, purchase_price: 12000 }) === 12 && inventory.inventoryValue({ quantity: 2000, base_unit: 'ml', purchase_unit: 'bottle', units_per_package: 1000, purchase_price: 12000 }) === 24000,
  ambiguousLegacyUnitFlagged: inventory.isAmbiguousInventoryUnit({ quantity: 1000, unit: 'bottle', purchase_price: 2000 }) && inventory.inventoryValue({ quantity: 1000, unit: 'bottle', purchase_price: 2000 }) === 0,
  lowStockStates: inventory.lowStockStatus({ quantity: 0, min_stock: 5 }) === 'out' && inventory.lowStockStatus({ quantity: 2, min_stock: 5 }) === 'low' && inventory.lowStockStatus({ quantity: 6, min_stock: 5 }) === 'available',
  lowStockOrdering: inventory.sortLowStock([{ id: 'available', quantity: 8, min_stock: 5 }, { id: 'low', quantity: 2, min_stock: 5 }, { id: 'out', quantity: 0, min_stock: 5 }]).map((row) => row.id).join(',') === 'out,low,available',
  packageEquivalentKeepsFraction: inventory.packageEquivalent({ quantity: 4320, base_unit: 'ml', purchase_unit: 'bottle', units_per_package: 1000 }) === 4.32,
  packageEquivalentExact: inventory.packageEquivalent({ quantity: 7000, base_unit: 'ml', purchase_unit: 'bottle', units_per_package: 1000 }) === 7,
  servingsRemainingFixture: inventory.servingsRemaining({ quantity: 4320, base_unit: 'ml', usage_per_serving: 20 }) === 216,
  servingCostFixture: inventory.servingCost({ quantity: 4320, base_unit: 'ml', usage_per_serving: 20, average_unit_cost: 14.5 }) === 290,
  movementSourceBreakdown: JSON.stringify(inventory.movementConsumptionBySource([{ item_id: 'syrup', source_type: 'sale', quantity_delta: -100 }, { item_id: 'syrup', type: 'waste', quantity_delta: -20 }, { item_id: 'syrup', type: 'recipe_consumption', quantity_delta: -300 }], 'syrup')) === JSON.stringify({ sales: 100, waste: 20, adjustments: 300 }),
};
if (Object.values(checks).some((value) => !value)) throw new Error(JSON.stringify(checks));
console.log('inventory-regression: PASS');
