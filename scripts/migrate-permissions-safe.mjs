import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { permissionKey } from '../src/services/permissions.js';

const production = process.argv.includes('--production');
const apply = process.argv.includes('--apply');
const projectId = process.env.FIREBASE_PROJECT_ID || 'acc-101';
const targetEmail = process.env.PERMISSION_TARGET_EMAIL || 'rafid89esb@gmail.com';
const host = process.env.FIREBASE_EMULATOR_HOST || '127.0.0.1';
const port = 9000;
const runId = `permissions-safe-${projectId}`;

if (!production && !['127.0.0.1', 'localhost'].includes(host)) throw new Error(`Refusing non-local host: ${host}`);
if (apply && production && !process.argv.includes('--confirm-production')) throw new Error('Production apply requires --confirm-production.');

const base = `http://${host}:${port}`;
const localUrl = (path) => `${base}/${path}.json?ns=${projectId}-default-rtdb&access_token=owner`;
const runCli = (args) => {
  if (process.platform === 'win32') return execFileSync(process.env.ComSpec, ['/d', '/c', `npx -y firebase-tools@latest ${args.join(' ')}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return execFileSync('npx', ['-y', 'firebase-tools@latest', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
};
const read = async (path) => {
  if (production) { const value = runCli(['database:get', `/${path}`, '--project', projectId]); return value ? JSON.parse(value) : null; }
  const response = await fetch(localUrl(path));
  if (!response.ok) throw new Error(`Read failed ${path}: ${response.status}`);
  return response.json();
};
const patch = async (path, value) => {
  if (production) {
    const temp = `.tmp-permissions-update-${Date.now()}.json`;
    await fs.writeFile(temp, JSON.stringify(value));
    try { runCli(['database:update', `/${path}`, temp, '--project', projectId, '--force']); }
    finally { await fs.unlink(temp).catch(() => {}); }
    return;
  }
  const response = await fetch(localUrl(path), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  if (!response.ok) throw new Error(`Patch failed ${path}: ${response.status}`);
};
const flattenEnabled = (value, prefix = '', output = []) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  for (const [key, enabled] of Object.entries(value)) {
    const id = prefix ? `${prefix}.${key}` : key;
    if (enabled && typeof enabled === 'object' && !Array.isArray(enabled)) flattenEnabled(enabled, id, output);
    else if (enabled === true) output.push(id);
  }
  return output;
};
const normalizePermissions = (permissions = {}) => {
  const safe = {};
  let duplicates = 0;
  for (const id of flattenEnabled(permissions)) {
    const safeId = permissionKey(id);
    if (safe[safeId] === true) { duplicates += 1; continue; }
    safe[safeId] = true;
  }
  return { safe, duplicates };
};
const countChangedPermissions = (before, after) => {
  const beforeKeys = new Set(Object.keys(normalizePermissions(before).safe));
  const afterKeys = new Set(Object.keys(after));
  return [...new Set([...beforeKeys, ...afterKeys])].filter((key) => beforeKeys.has(key) !== afterKeys.has(key)).length;
};

const [sourceValue, usersValue] = await Promise.all([read('authorized_users'), read('users')]);
const source = sourceValue || {};
const users = usersValue || {};
const backupPath = `backups/permissions-migration-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
await fs.mkdir('backups', { recursive: true });
await fs.writeFile(backupPath, JSON.stringify({ authorized_users: source, users, created_at: new Date().toISOString(), project: projectId }, null, 2));

const marker = await read(`permission_migrations/${runId}`);
const targetKey = targetEmail.toLowerCase().replace(/[.#$\/\[\]]/g, '_');
const targetBefore = source[targetKey] || null;
if (marker?.status === 'completed' && !apply) {
  console.log(JSON.stringify({ idempotent: true, runId, backupPath, migrated: 0, permissionsConverted: 0, duplicated: 0, changes: 0, targetEmail, targetBefore }, null, 2));
  process.exit(0);
}

const updates = {};
let migrated = 0;
let permissionsConverted = 0;
let duplicated = 0;
for (const [id, user] of Object.entries(source)) {
  if (user?.role === 'super_admin') continue;
  const before = user?.permissions || {};
  const { safe, duplicates } = normalizePermissions(before);
  duplicated += duplicates;
  if (JSON.stringify(safe) !== JSON.stringify(before)) {
    updates[`authorized_users/${id}/permissions`] = safe;
    updates[`authorized_users/${id}/permissions_legacy_backup`] = before;
    migrated += 1;
    permissionsConverted += countChangedPermissions(before, safe);
  }
}
if (duplicated > 0) throw new Error(`Refusing migration: ${duplicated} duplicate permission key collision(s).`);
const changes = Object.keys(updates).filter((path) => path.endsWith('/permissions')).length;
if (apply && changes) await patch('', updates);
if (apply) await patch(`permission_migrations/${runId}`, { runId, status: 'completed', migrated, permissionsConverted, duplicated, changes, backupPath, completed_at: new Date().toISOString() });

const after = apply ? await read('authorized_users') || {} : source;
const targetAfter = after[targetKey] || null;
console.log(JSON.stringify({ runId, status: apply ? 'completed' : 'dry_run', backupPath, migrated, permissionsConverted, duplicated, changes, idempotent: !changes, targetEmail, targetBefore, targetAfter }, null, 2));
