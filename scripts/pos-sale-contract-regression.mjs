import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const contract = require('../functions/pos-sale-contract.js');
const functionSource = fs.readFileSync(new URL('../functions/index.js', import.meta.url), 'utf8');
const posSource = fs.readFileSync('C:/Users/MSI/Desktop/101 POS/src/services/accSync.js', 'utf8');

assert.equal(contract.requiredBusinessDate('2026-10-01'), '2026-10-01');
assert.throws(() => contract.requiredBusinessDate(''), { code: 'INVALID_BUSINESS_DATE' });
assert.equal(contract.integrationKeyForSale('POS-1028'), 'POS101:sale:POS-1028');
assert.equal(contract.normalizeSaleStatus('synced'), 'completed');
assert.equal(contract.normalizeSaleStatus('voided'), 'voided');
assert.equal(contract.sourceTimestamp(1790000000000, 'createdAt'), 1790000000000);
assert.equal(contract.saleUpsertAction({ fingerprint: 'a' }), 'create');
assert.equal(contract.saleUpsertAction({ existing: { fingerprint: 'a' }, fingerprint: 'a' }), 'skip');
assert.equal(contract.saleUpsertAction({ existing: { fingerprint: 'a' }, fingerprint: 'b' }), 'update');
assert.match(functionSource, /businessDate = requiredBusinessDate\(data\.businessDate\)/);
assert.match(functionSource, /source: 'POS101', sourceType: 'sale', sourceId: saleId, integrationKey, businessDate/);
assert.match(functionSource, /status !== 'completed'/);
assert.match(functionSource, /saleUpsertAction\(\{ existing: operation\.status === 'completed' \? operation : null, fingerprint: fingerprintValue \}\)/);
assert.match(functionSource, /updated: true, saleId, operationKey, integrationKey/);
assert.match(posSource, /businessDate: sale\.businessDate/);
assert.match(posSource, /createdAt: sale\.createdAt/);

console.log('POS_SALE_CONTRACT_REGRESSION=PASS');
