import assert from 'node:assert/strict';
import { createDashboardRefreshScheduler } from '../src/services/dashboard-realtime.js';

let loads = 0; let updates = 0; let release;
const firstLoad = new Promise((resolve) => { release = resolve; });
const scheduler = createDashboardRefreshScheduler({
  load: async () => { loads += 1; if (loads === 1) await firstLoad; return { loads }; },
  onData: () => { updates += 1; },
});
for (let i = 0; i < 10; i += 1) scheduler.schedule();
await new Promise((resolve) => setTimeout(resolve, 0));
for (let i = 0; i < 10; i += 1) scheduler.schedule();
release();
await new Promise((resolve) => setTimeout(resolve, 0));
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(loads, 2);
assert.equal(updates, 2);
scheduler.dispose();
scheduler.schedule();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(loads, 2);
assert.equal(updates, 2);
console.log('REALTIME_REGRESSION_PASS');
