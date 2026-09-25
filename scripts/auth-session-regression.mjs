import assert from 'node:assert/strict';
import { authEmailKey, findAuthorizedRecord, normalizeAuthEmail } from '../src/services/auth-session.mjs';

const safe = { email: 'Example@gmail.com', role: 'manager' };
const legacy = { '-PUSH-ID': { email: 'legacy@example.com', role: 'supervisor' } };

assert.equal(normalizeAuthEmail('  Example@gmail.com '), 'example@gmail.com');
assert.equal(authEmailKey('Example@gmail.com'), 'example@gmail_com');
assert.equal(findAuthorizedRecord({ [authEmailKey('Example@gmail.com')]: safe }, ' example@gmail.com ')?.role, 'manager');
assert.equal(findAuthorizedRecord(legacy, 'LEGACY@example.com')?.role, 'supervisor');
assert.equal(findAuthorizedRecord(legacy, 'missing@example.com'), null);
console.log('auth-session regression: PASS');
