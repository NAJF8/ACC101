import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/services/inventory.js', import.meta.url), 'utf8');
const inventory = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const syrup = { id: 'syrup', name_ar: 'Mojito Syrup', quantity: 4000, base_unit: 'ml', average_unit_cost: 10 };
const recipes = [
  { id: 'classic', product_id: 'classic', items: [{ inventory_item_id: 'syrup', quantity: 20, unit: 'ml' }] },
  { id: 'blue', product_id: 'blue', items: [{ inventory_item_id: 'syrup', quantity: 15, unit: 'ml' }] },
];
const sales = [
  { id: 's1', product_id: 'classic', product_name: 'Classic Mojito', quantity: 50, unit_price: 5000, date: '2026-09-10' },
  { id: 's2', product_id: 'blue', product_name: 'Blue Mojito', quantity: 20, unit_price: 5000, date: '2026-09-10' },
];
const result = inventory.buildInventorySalesAnalytics({ items: [syrup], sales, recipes, range: { mode: 'month', month: '2026-09' }, today: '2026-09-12' });
assert.equal(result.materials.length, 0, 'missing movements must not fabricate historical consumption');
assert.equal(result.products.find((row) => row.product_id === 'classic').revenue, 250000);
assert.equal(result.products.find((row) => row.product_id === 'classic').material_cost, 0);
assert.equal(result.products.find((row) => row.product_id === 'classic').difference, 250000);
const recorded = inventory.buildInventorySalesAnalytics({ items: [syrup], movements: [{ item_id: 'syrup', source_type: 'sale', source_id: 's1', product_id: 'classic', quantity_delta: -900, date: '2026-09-10' }], sales: [sales[0]], recipes, range: { mode: 'month', month: '2026-09' } });
assert.equal(recorded.materials[0].consumption, 900, 'recorded movement must win over recipe reconstruction');

const historical = [
  { id: 'm1', item_id: 'syrup', source_type: 'sale', source_id: 's1', product_id: 'classic', quantity_delta: -400, date: '2026-09-09' },
  { id: 'm2', item_id: 'syrup', source_type: 'sale', source_id: 's2', product_id: 'blue', quantity_delta: -600, date: '2026-09-10' },
  { id: 'm3', item_id: 'syrup', source_type: 'sale', source_id: 's3', product_id: 'classic', quantity_delta: -500, date: '2026-09-11' },
  { id: 'm4', item_id: 'syrup', source_type: 'sale', source_id: 's4', product_id: 'classic', quantity_delta: -500, date: '2026-09-12' },
];
const coverage = inventory.buildInventorySalesAnalytics({ items: [syrup], movements: historical, sales: [], recipes, today: '2026-09-12' });
assert.equal(coverage.materials[0].average_daily_consumption, 500);
assert.equal(coverage.materials[0].coverage_days, 8);
const insufficient = inventory.buildInventorySalesAnalytics({ items: [syrup], today: '2026-09-12' });
assert.equal(insufficient.materials.length, 0);
assert.equal(source.includes("source: 'reconstructed'"), false);
console.log('inventory-analytics-regression: PASS');
