import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-finished-product-'));
const snapshot = {
  products: {
    'excel-prod-42': { id: 'excel-prod-42', name_ar: 'براوني', ready_stock_quantity: 0 },
    'excel-prod-49': { id: 'excel-prod-49', name_ar: 'مافن', ready_stock_quantity: 2 },
    'excel-prod-53': { id: 'excel-prod-53', name_ar: 'ساندويش', name_en: 'Sandwich', category_id: 'sandwiches', active: true, selling_price: 0, ready_stock_quantity: 0 },
  },
  expenses: {
    b1: { id: 'b1', name: 'براوني', quantity: 3, amount: 6000 },
    m1: { id: 'm1', name: 'مافن', quantity: 2, amount: 6000 },
    s1: { id: 's1', name: 'ساندويش', quantity: 4, amount: 8000 },
  },
  inventory_items: { flour: { id: 'flour', quantity: 100 } },
  purchases: { p1: { id: 'p1', amount: 9000 } },
};
const input = path.join(dir, 'snapshot.json');
const output = path.join(dir, 'out');
fs.writeFileSync(input, JSON.stringify(snapshot));
const run = (root, out = output) => JSON.parse(execFileSync(process.execPath, ['scripts/finished-product-migration.mjs', `--input=${root}`, `--output=${out}`], { encoding: 'utf8' }));
const first = run(input);
const patched = JSON.parse(JSON.stringify(snapshot));
for (const [key, value] of Object.entries(JSON.parse(fs.readFileSync(path.join(output, 'patch.json'))))) {
  const parts = key.split('/');
  let node = patched;
  for (const part of parts.slice(0, -1)) node = node[part] ||= {};
  node[parts.at(-1)] = value;
}
const postInput = path.join(dir, 'post.json');
fs.writeFileSync(postInput, JSON.stringify(patched));
const second = run(postInput, path.join(dir, 'out-second'));
const checks = {
  expectedCandidates: first.candidate_records === 3,
  migratedOnce: first.migrated === 3 && first.unresolved === 0,
  financialUnchanged: first.financial_before.total === first.financial_after.total && first.financial_changes === 0,
  noInventoryOrPurchaseWrites: Object.keys(JSON.parse(fs.readFileSync(path.join(output, 'patch.json')))).every((key) => !/^(inventory_items|purchases)(\/|$)/.test(key)),
  rerunIsNoop: second.migrated === 0 && second.duplicated === 0 && second.stock_adjusted === 0 && second.financial_changes === 0 && second.unresolved === 0,
};
if (Object.values(checks).some((value) => !value)) throw new Error(JSON.stringify({ checks, first, second }));
console.log('finished-product-regression: PASS');
console.log(JSON.stringify({ checks, first: { migrated: first.migrated, unresolved: first.unresolved }, second: { migrated: second.migrated, stock_adjusted: second.stock_adjusted, financial_changes: second.financial_changes } }, null, 2));
