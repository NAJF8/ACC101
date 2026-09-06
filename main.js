const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const isDev = !app.isPackaged;
if (isDev) {
  const localUserData = path.join(__dirname, '.electron');
  fs.mkdirSync(localUserData, { recursive: true });
  app.setPath('userData', localUserData);
}
const dbDir = process.env.COFFEE_DB_DIR || (isDev ? path.join(__dirname, 'data') : path.join(app.getPath('userData'), 'data'));
const dbPath = path.join(dbDir, '101coffee.db');

let win;
let db;
let activeSession = null;

const ALL_PERMISSIONS = [
  'dashboard.view', 'financial.view_revenue', 'financial.view_cogs',
  'financial.view_gross_profit', 'financial.view_net_profit',
  'financial.view_profit_margin', 'financial.view_profit_by_category',
  'financial.view_profit_by_product', 'financial.view_financial_dashboard',
  'financial.view_profitability_reports',
  'purchases.view', 'purchases.create', 'purchases.edit', 'purchases.delete',
  'expenses.view', 'expenses.create', 'expenses.edit', 'expenses.delete',
  'sales.view', 'sales.create', 'sales.edit', 'sales.delete',
  'inventory.view', 'inventory.adjust', 'inventory.count',
  'materials.view', 'materials.create', 'materials.edit', 'materials.delete',
  'products.view', 'products.create', 'products.edit', 'products.delete',
  'suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.delete',
  'employees.view', 'employees.create', 'employees.edit', 'employees.disable',
  'payroll.view', 'payroll.create', 'payroll.edit',
  'reports.view', 'reports.export',
  'profits.view', 'profits.net', 'profits.margin',
  'imports.create', 'imports.undo',
  'backups.create', 'backups.restore',
  'users.view', 'users.create', 'users.edit', 'users.disable',
  'settings.view', 'settings.edit',
  'audit.view', 'system.reset'
];

const ROLE_DEFAULTS = {
  super_admin: ALL_PERMISSIONS,
  manager: ALL_PERMISSIONS.filter((p) => !['system.reset', 'backups.restore'].includes(p)),
  supervisor: [
    'dashboard.view', 'purchases.view', 'purchases.create', 'purchases.edit',
    'expenses.view', 'expenses.create', 'expenses.edit',
    'sales.view', 'sales.create', 'sales.edit',
    'inventory.view', 'inventory.adjust', 'inventory.count',
    'materials.view', 'products.view', 'suppliers.view',
    'reports.view', 'financial.view_revenue', 'financial.view_cogs',
    'financial.view_gross_profit', 'financial.view_net_profit',
    'financial.view_profit_margin'
  ],
  employee: [
    'dashboard.view', 'purchases.view', 'purchases.create', 'expenses.view', 'expenses.create', 'sales.create',
    'materials.view', 'inventory.view'
  ],
  viewer: ['dashboard.view']
};

const ENTITY_CONFIG = {
  categories: {
    table: 'categories',
    permissions: { view: 'settings.view', create: 'settings.edit', edit: 'settings.edit', delete: 'settings.edit' },
    fields: ['name_ar', 'name_en', 'type', 'icon', 'color', 'sort_order', 'active']
  },
  materials: {
    table: 'materials',
    permissions: { view: 'materials.view', create: 'materials.create', edit: 'materials.edit', delete: 'materials.delete' },
    fields: ['name_ar', 'name_en', 'category_id', 'base_unit', 'min_stock', 'default_supplier_id', 'active', 'notes']
  },
  suppliers: {
    table: 'suppliers',
    permissions: { view: 'suppliers.view', create: 'suppliers.create', edit: 'suppliers.edit', delete: 'suppliers.delete' },
    fields: ['name', 'phone', 'notes']
  },
  products: {
    table: 'products',
    permissions: { view: 'products.view', create: 'products.create', edit: 'products.edit', delete: 'products.delete' },
    fields: ['name', 'category_id', 'selling_price', 'active']
  },
  recipes: {
    table: 'recipe_items',
    permissions: { view: 'products.view', create: 'products.edit', edit: 'products.edit', delete: 'products.edit' },
    fields: ['product_id', 'material_id', 'quantity', 'unit']
  },
  purchases: {
    table: 'purchase_batches',
    permissions: { view: 'purchases.view', create: 'purchases.create', edit: 'purchases.edit', delete: 'purchases.delete' },
    fields: ['date', 'category_id', 'material_id', 'quantity', 'unit', 'total_price', 'supplier_id', 'invoice_no', 'payment_method', 'paid_amount', 'notes', 'status']
  },
  expenses: {
    table: 'expenses',
    permissions: { view: 'expenses.view', create: 'expenses.create', edit: 'expenses.edit', delete: 'expenses.delete' },
    fields: ['date', 'category_id', 'description', 'amount', 'payment_method', 'beneficiary', 'notes', 'recurring', 'recurring_frequency', 'status']
  },
  sales: {
    table: 'sales',
    permissions: { view: 'sales.view', create: 'sales.create', edit: 'sales.edit', delete: 'sales.delete' },
    fields: ['date', 'product_id', 'quantity', 'unit_price', 'status']
  },
  employees: {
    table: 'employees',
    permissions: { view: 'employees.view', create: 'employees.create', edit: 'employees.edit', delete: 'employees.disable' },
    fields: ['name', 'job_title', 'base_salary', 'start_date', 'status', 'notes']
  },
  payroll: {
    table: 'payroll',
    permissions: { view: 'payroll.view', create: 'payroll.create', edit: 'payroll.edit', delete: 'payroll.edit' },
    fields: ['employee_id', 'month', 'base_salary', 'advance', 'deduction', 'bonus', 'paid_date', 'notes']
  },
  users: {
    table: 'users',
    permissions: { view: 'users.view', create: 'users.create', edit: 'users.edit', delete: 'users.disable' },
    fields: ['name', 'username', 'role', 'status']
  },
  audit: {
    table: 'audit_log',
    permissions: { view: 'audit.view' },
    fields: []
  }
};

function now() {
  return new Date().toISOString();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const check = crypto.pbkdf2Sync(String(password), salt, 120000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}

function openDatabase() {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log(`[Database] Initializing SQLite database at: ${dbPath}`);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate();
  seed();
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      last_login TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_permission_overrides (
      user_id INTEGER NOT NULL,
      permission TEXT NOT NULL,
      allowed INTEGER NOT NULL,
      changed_by INTEGER,
      changed_at TEXT NOT NULL,
      PRIMARY KEY (user_id, permission),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_ar TEXT NOT NULL,
      name_en TEXT,
      type TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'circle',
      color TEXT NOT NULL DEFAULT '#276749',
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_ar TEXT NOT NULL,
      name_en TEXT,
      category_id INTEGER,
      base_unit TEXT NOT NULL,
      min_stock REAL NOT NULL DEFAULT 0,
      current_stock REAL NOT NULL DEFAULT 0,
      average_cost REAL NOT NULL DEFAULT 0,
      default_supplier_id INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (default_supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category_id INTEGER,
      selling_price REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS recipe_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      material_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (material_id) REFERENCES materials(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      category_id INTEGER,
      material_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      total_price REAL NOT NULL,
      unit_price REAL NOT NULL,
      supplier_id INTEGER,
      invoice_no TEXT,
      payment_method TEXT,
      paid_amount REAL NOT NULL DEFAULT 0,
      remaining_amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'approved',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (material_id) REFERENCES materials(id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS supplier_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      purchase_id INTEGER,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY (purchase_id) REFERENCES purchase_batches(id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      category_id INTEGER,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT,
      beneficiary TEXT,
      notes TEXT,
      recurring INTEGER NOT NULL DEFAULT 0,
      recurring_frequency TEXT,
      status TEXT NOT NULL DEFAULT 'approved',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      revenue REAL NOT NULL,
      cogs REAL NOT NULL,
      gross_profit REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'approved',
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      job_title TEXT,
      base_salary REAL NOT NULL DEFAULT 0,
      start_date TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payroll (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      base_salary REAL NOT NULL DEFAULT 0,
      advance REAL NOT NULL DEFAULT 0,
      deduction REAL NOT NULL DEFAULT 0,
      bonus REAL NOT NULL DEFAULT 0,
      net_paid REAL NOT NULL DEFAULT 0,
      paid_date TEXT,
      notes TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      old_value TEXT,
      new_value TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

function seed() {
  if (!db.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').get('super_admin')) {
    const t = now();
    db.prepare(`
      INSERT INTO users (name, username, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('مدير النظام', 'admin', hashPassword('admin123'), 'super_admin', 'active', t, t);
  }

  const categoryCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  if (categoryCount === 0) {
    const categories = [
      ['قهوة', 'Coffee', 'مواد أولية', 'coffee', '#1f7a4d'],
      ['شاي', 'Tea', 'مواد أولية', 'cup', '#427a39'],
      ['حليب', 'Milk', 'مواد أولية', 'milk', '#9c7a47'],
      ['سيربات', 'Syrups', 'مواد أولية', 'droplet', '#b97d3c'],
      ['أكواب', 'Cups', 'مخزون', 'package', '#606c38'],
      ['مواد تنظيف', 'Cleaning', 'مصاريف تشغيلية', 'spray', '#3a6b66'],
      ['رواتب', 'Payroll', 'رواتب', 'wallet', '#624c33'],
      ['كهرباء', 'Electricity', 'خدمات', 'bolt', '#b45309'],
      ['إنترنت', 'Internet', 'خدمات', 'wifi', '#386641'],
      ['إيجار', 'Rent', 'مصاريف تشغيلية', 'home', '#7f5539'],
      ['تسويق', 'Marketing', 'تسويق', 'megaphone', '#bc6c25'],
      ['أخرى', 'Other', 'أخرى', 'more', '#6b7280']
    ];
    const stmt = db.prepare(`
      INSERT INTO categories (name_ar, name_en, type, icon, color, sort_order, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
    const t = now();
    categories.forEach((c, i) => stmt.run(c[0], c[1], c[2], c[3], c[4], i + 1, t, t));
  }

  const settings = [
    ['currency', 'IQD'],
    ['currencyLabel', 'د.ع'],
    ['employeeEditWindowHours', '24'],
    ['employeeMaxExpense', '250000'],
    ['supervisorMaxExpense', '1000000']
  ];
  const setStmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  settings.forEach((s) => setStmt.run(s[0], s[1]));
}

function audit(action, entity, entityId, oldValue, newValue) {
  db.prepare(`
    INSERT INTO audit_log (actor_user_id, action, entity, entity_id, old_value, new_value, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    activeSession?.user?.id || null,
    action,
    entity,
    entityId == null ? null : String(entityId),
    oldValue == null ? null : JSON.stringify(oldValue),
    newValue == null ? null : JSON.stringify(newValue),
    now()
  );
}

function permissionsForUser(user) {
  const base = new Set(ROLE_DEFAULTS[user.role] || []);
  if (user.role === 'super_admin') return ALL_PERMISSIONS;
  const rows = db.prepare('SELECT permission, allowed FROM user_permission_overrides WHERE user_id = ?').all(user.id);
  rows.forEach((row) => {
    if (row.allowed) base.add(row.permission);
    else base.delete(row.permission);
  });
  return [...base];
}

function requireLogin() {
  if (!activeSession?.user) throw new Error('يجب تسجيل الدخول أولاً.');
}

function has(permission) {
  return activeSession?.permissions?.includes(permission);
}

function requirePermission(permission) {
  requireLogin();
  if (!has(permission)) throw new Error('ليست لديك صلاحية تنفيذ هذه العملية.');
}

function safeRow(row) {
  if (!row) return row;
  const copy = { ...row };
  delete copy.password_hash;
  return copy;
}

function ensureSuperAdminProtection(entity, id, payload, action) {
  if (entity !== 'users') return;
  const target = id ? db.prepare('SELECT * FROM users WHERE id = ?').get(id) : null;
  const actorIsSuper = activeSession?.user?.role === 'super_admin';
  if (payload?.role === 'super_admin' && !actorIsSuper) {
    throw new Error('Super Admin فقط يستطيع إنشاء أو تعديل Super Admin.');
  }
  if (target?.role === 'super_admin' && !actorIsSuper) {
    throw new Error('لا يمكن تعديل أو تعطيل Super Admin إلا بواسطة Super Admin.');
  }
  if (target?.role === 'super_admin' && action === 'delete') {
    const count = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'super_admin' AND status = 'active'").get().c;
    if (count <= 1) throw new Error('يجب أن يبقى Super Admin واحد على الأقل.');
  }
}

function normalizeQuantity(quantity, fromUnit, toUnit) {
  const q = Number(quantity || 0);
  if (fromUnit === toUnit) return q;
  const mass = { kg: 1000, g: 1, كيلو: 1000, غرام: 1 };
  const liquid = { liter: 1000, litre: 1000, l: 1000, ml: 1, لتر: 1000, مل: 1 };
  if (mass[fromUnit] && mass[toUnit]) return (q * mass[fromUnit]) / mass[toUnit];
  if (liquid[fromUnit] && liquid[toUnit]) return (q * liquid[fromUnit]) / liquid[toUnit];
  return q;
}

function recalcMaterialAfterPurchase(materialId, addedQtyBase, totalPrice) {
  const mat = db.prepare('SELECT current_stock, average_cost FROM materials WHERE id = ?').get(materialId);
  const oldValue = Number(mat.current_stock || 0) * Number(mat.average_cost || 0);
  const newQty = Number(mat.current_stock || 0) + Number(addedQtyBase || 0);
  const newAvg = newQty > 0 ? (oldValue + Number(totalPrice || 0)) / newQty : 0;
  db.prepare('UPDATE materials SET current_stock = ?, average_cost = ?, updated_at = ? WHERE id = ?')
    .run(newQty, newAvg, now(), materialId);
}

function calculateProductCost(productId) {
  const rows = db.prepare(`
    SELECT r.quantity, r.unit, m.base_unit, m.average_cost, m.name_ar
    FROM recipe_items r
    JOIN materials m ON m.id = r.material_id
    WHERE r.product_id = ?
  `).all(productId);
  const lines = rows.map((row) => {
    const baseQty = normalizeQuantity(row.quantity, row.unit, row.base_unit);
    const cost = baseQty * Number(row.average_cost || 0);
    return { material: row.name_ar, quantity: row.quantity, unit: row.unit, cost };
  });
  const total = lines.reduce((sum, line) => sum + line.cost, 0);
  return { total, lines };
}

function maybeApproval(entity, payload) {
  if (entity !== 'expenses') return payload.status || 'approved';
  const role = activeSession.user.role;
  const amount = Number(payload.amount || 0);
  if (role === 'employee') {
    const max = Number(db.prepare("SELECT value FROM settings WHERE key = 'employeeMaxExpense'").get()?.value || 250000);
    return amount > max ? 'pending_approval' : 'approved';
  }
  if (role === 'supervisor') {
    const max = Number(db.prepare("SELECT value FROM settings WHERE key = 'supervisorMaxExpense'").get()?.value || 1000000);
    return amount > max ? 'pending_approval' : 'approved';
  }
  return payload.status || 'approved';
}

function listEntity(entity, params = {}) {
  const cfg = ENTITY_CONFIG[entity];
  if (!cfg) throw new Error('كيان غير معروف.');
  if (entity === 'categories') requireLogin();
  else requirePermission(cfg.permissions.view);

  if (entity === 'users') {
    return db.prepare('SELECT id, name, username, role, status, last_login, created_at, updated_at FROM users ORDER BY id DESC').all();
  }
  if (entity === 'materials') {
    return db.prepare(`
      SELECT m.*, c.name_ar AS category_name, s.name AS supplier_name,
        (m.current_stock * m.average_cost) AS inventory_value,
        (SELECT MAX(unit_price) FROM purchase_batches WHERE material_id = m.id AND deleted_at IS NULL) AS highest_price,
        (SELECT MIN(unit_price) FROM purchase_batches WHERE material_id = m.id AND deleted_at IS NULL) AS lowest_price,
        (SELECT unit_price FROM purchase_batches WHERE material_id = m.id AND deleted_at IS NULL ORDER BY date DESC, id DESC LIMIT 1) AS last_price,
        (SELECT date FROM purchase_batches WHERE material_id = m.id AND deleted_at IS NULL ORDER BY date DESC, id DESC LIMIT 1) AS last_purchase_date
      FROM materials m
      LEFT JOIN categories c ON c.id = m.category_id
      LEFT JOIN suppliers s ON s.id = m.default_supplier_id
      ORDER BY m.id DESC
    `).all();
  }
  if (entity === 'purchases') {
    const ownOnly = activeSession.user.role === 'employee';
    return db.prepare(`
      SELECT p.*, c.name_ar AS category_name, m.name_ar AS material_name, s.name AS supplier_name, u.name AS created_by_name
      FROM purchase_batches p
      LEFT JOIN categories c ON c.id = p.category_id
      JOIN materials m ON m.id = p.material_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      LEFT JOIN users u ON u.id = p.created_by
      WHERE p.deleted_at IS NULL ${ownOnly ? 'AND p.created_by = @uid' : ''}
      ORDER BY p.date DESC, p.id DESC
    `).all({ uid: activeSession.user.id });
  }
  if (entity === 'expenses') {
    const ownOnly = activeSession.user.role === 'employee';
    return db.prepare(`
      SELECT e.*, c.name_ar AS category_name, u.name AS created_by_name
      FROM expenses e
      LEFT JOIN categories c ON c.id = e.category_id
      LEFT JOIN users u ON u.id = e.created_by
      WHERE e.deleted_at IS NULL ${ownOnly ? 'AND e.created_by = @uid' : ''}
      ORDER BY e.date DESC, e.id DESC
    `).all({ uid: activeSession.user.id });
  }
  if (entity === 'sales') {
    const sensitive = has('financial.view_revenue') || has('financial.view_cogs') || has('financial.view_gross_profit');
    const rows = db.prepare(`
      SELECT s.*, p.name AS product_name, u.name AS created_by_name
      FROM sales s
      JOIN products p ON p.id = s.product_id
      LEFT JOIN users u ON u.id = s.created_by
      WHERE s.deleted_at IS NULL
      ORDER BY s.date DESC, s.id DESC
    `).all();
    return rows.map((row) => ({
      ...row,
      revenue: has('financial.view_revenue') ? row.revenue : undefined,
      cogs: has('financial.view_cogs') ? row.cogs : undefined,
      gross_profit: has('financial.view_gross_profit') ? row.gross_profit : undefined,
      unit_price: sensitive ? row.unit_price : undefined
    }));
  }
  if (entity === 'suppliers') {
    return db.prepare(`
      SELECT s.*,
        COALESCE(SUM(p.total_price), 0) AS total_purchases,
        COALESCE(SUM(p.paid_amount), 0) AS paid,
        COALESCE(SUM(p.remaining_amount), 0) AS remaining,
        MAX(p.date) AS last_operation
      FROM suppliers s
      LEFT JOIN purchase_batches p ON p.supplier_id = s.id AND p.deleted_at IS NULL
      GROUP BY s.id
      ORDER BY s.name
    `).all();
  }
  if (entity === 'payroll') {
    return db.prepare(`
      SELECT p.*, e.name AS employee_name, e.job_title
      FROM payroll p
      JOIN employees e ON e.id = p.employee_id
      ORDER BY p.month DESC, p.id DESC
    `).all();
  }
  if (entity === 'audit') {
    return db.prepare(`
      SELECT a.*, u.name AS actor_name
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.actor_user_id
      ORDER BY a.id DESC
      LIMIT 300
    `).all();
  }
  if (entity === 'recipes' && params.product_id) {
    return db.prepare(`
      SELECT r.*, m.name_ar AS material_name, m.average_cost, m.base_unit
      FROM recipe_items r
      JOIN materials m ON m.id = r.material_id
      WHERE r.product_id = ?
      ORDER BY r.id
    `).all(params.product_id);
  }
  return db.prepare(`SELECT * FROM ${cfg.table} ORDER BY id DESC`).all();
}

function createEntity(entity, payload) {
  const cfg = ENTITY_CONFIG[entity];
  if (!cfg) throw new Error('كيان غير معروف.');
  requirePermission(cfg.permissions.create);
  ensureSuperAdminProtection(entity, null, payload, 'create');

  const t = now();
  if (entity === 'users') {
    if (!payload.password) throw new Error('كلمة المرور مطلوبة.');
    const info = db.prepare(`
      INSERT INTO users (name, username, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(payload.name, payload.username, hashPassword(payload.password), payload.role, payload.status || 'active', t, t);
    applyPermissionOverrides(info.lastInsertRowid, payload.permissions || {});
    audit('create', entity, info.lastInsertRowid, null, { ...payload, password: '[hidden]' });
    return { id: info.lastInsertRowid };
  }

  if (entity === 'purchases') {
    const material = db.prepare('SELECT base_unit FROM materials WHERE id = ?').get(payload.material_id);
    if (!material) throw new Error('المادة غير موجودة.');
    const qtyBase = normalizeQuantity(payload.quantity, payload.unit, material.base_unit);
    const unitPrice = Number(payload.total_price || 0) / (qtyBase || 1);
    const paid = Number(payload.paid_amount || 0);
    const remaining = Math.max(0, Number(payload.total_price || 0) - paid);
    const status = payload.status || 'approved';
    const info = db.prepare(`
      INSERT INTO purchase_batches
      (date, category_id, material_id, quantity, unit, total_price, unit_price, supplier_id, invoice_no, payment_method, paid_amount, remaining_amount, notes, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(payload.date, payload.category_id || null, payload.material_id, payload.quantity, payload.unit, payload.total_price, unitPrice, payload.supplier_id || null, payload.invoice_no || null, payload.payment_method || null, paid, remaining, payload.notes || null, status, activeSession.user.id, t, t);
    if (status === 'approved') recalcMaterialAfterPurchase(payload.material_id, qtyBase, payload.total_price);
    audit('create', entity, info.lastInsertRowid, null, payload);
    return { id: info.lastInsertRowid };
  }

  if (entity === 'sales') {
    const cost = calculateProductCost(payload.product_id).total;
    const qty = Number(payload.quantity || 0);
    const unitPrice = Number(payload.unit_price || db.prepare('SELECT selling_price FROM products WHERE id = ?').get(payload.product_id)?.selling_price || 0);
    const revenue = qty * unitPrice;
    const cogs = qty * cost;
    const gross = revenue - cogs;
    const info = db.prepare(`
      INSERT INTO sales (date, product_id, quantity, unit_price, revenue, cogs, gross_profit, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(payload.date, payload.product_id, qty, unitPrice, revenue, cogs, gross, payload.status || 'approved', activeSession.user.id, t, t);
    audit('create', entity, info.lastInsertRowid, null, payload);
    return { id: info.lastInsertRowid };
  }

  if (entity === 'expenses') {
    payload = { ...payload, status: maybeApproval(entity, payload) };
  }

  if (entity === 'payroll') {
    payload = {
      ...payload,
      net_paid: Number(payload.base_salary || 0) - Number(payload.advance || 0) - Number(payload.deduction || 0) + Number(payload.bonus || 0)
    };
  }

  const fields = cfg.fields.filter((field) => Object.prototype.hasOwnProperty.call(payload, field));
  const allFields = [...fields, ...(entity === 'payroll' ? ['net_paid'] : []), 'created_at', 'updated_at'];
  const values = [...fields.map((field) => payload[field]), ...(entity === 'payroll' ? [payload.net_paid] : []), t, t];
  if (['expenses', 'payroll'].includes(entity)) {
    allFields.push('created_by');
    values.push(activeSession.user.id);
  }
  const placeholders = allFields.map(() => '?').join(', ');
  const info = db.prepare(`INSERT INTO ${cfg.table} (${allFields.join(', ')}) VALUES (${placeholders})`).run(...values);
  audit('create', entity, info.lastInsertRowid, null, payload);
  return { id: info.lastInsertRowid };
}

function canEditOwn(entity, row) {
  if (activeSession.user.role !== 'employee') return true;
  if (!['expenses', 'purchase_batches', 'sales'].includes(entity)) return false;
  const windowHours = Number(db.prepare("SELECT value FROM settings WHERE key = 'employeeEditWindowHours'").get()?.value || 24);
  if (windowHours === 0) return false;
  const created = new Date(row.created_at).getTime();
  return row.created_by === activeSession.user.id && Date.now() - created <= windowHours * 3600000;
}

function updateEntity(entity, id, payload) {
  const cfg = ENTITY_CONFIG[entity];
  if (!cfg) throw new Error('كيان غير معروف.');
  requirePermission(cfg.permissions.edit);
  ensureSuperAdminProtection(entity, id, payload, 'edit');

  const oldRow = db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(id);
  if (!oldRow) throw new Error('السجل غير موجود.');
  if (!canEditOwn(cfg.table, oldRow)) throw new Error('انتهت صلاحية تعديل هذا السجل لهذا المستخدم.');

  if (entity === 'users') {
    const allowed = ['name', 'username', 'role', 'status'];
    const updates = allowed.filter((field) => Object.prototype.hasOwnProperty.call(payload, field));
    const values = updates.map((field) => payload[field]);
    if (payload.password) {
      updates.push('password_hash');
      values.push(hashPassword(payload.password));
    }
    updates.push('updated_at');
    values.push(now(), id);
    db.prepare(`UPDATE users SET ${updates.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(...values);
    if (payload.permissions) applyPermissionOverrides(id, payload.permissions);
    audit('update', entity, id, safeRow(oldRow), { ...payload, password: payload.password ? '[hidden]' : undefined });
    return { id };
  }

  if (entity === 'payroll') {
    payload = {
      ...payload,
      net_paid: Number(payload.base_salary || 0) - Number(payload.advance || 0) - Number(payload.deduction || 0) + Number(payload.bonus || 0)
    };
  }

  const fields = cfg.fields.filter((field) => Object.prototype.hasOwnProperty.call(payload, field));
  if (entity === 'payroll') fields.push('net_paid');
  if (fields.length === 0) return { id };
  const values = fields.map((field) => payload[field]);
  fields.push('updated_at');
  values.push(now(), id);
  db.prepare(`UPDATE ${cfg.table} SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(...values);
  audit('update', entity, id, oldRow, payload);
  return { id };
}

function deleteEntity(entity, id) {
  const cfg = ENTITY_CONFIG[entity];
  if (!cfg) throw new Error('كيان غير معروف.');
  requirePermission(cfg.permissions.delete);
  ensureSuperAdminProtection(entity, id, {}, 'delete');
  const oldRow = db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(id);
  if (!oldRow) throw new Error('السجل غير موجود.');

  if (entity === 'categories') {
    const linked = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM materials WHERE category_id = @id) +
        (SELECT COUNT(*) FROM products WHERE category_id = @id) +
        (SELECT COUNT(*) FROM expenses WHERE category_id = @id) +
        (SELECT COUNT(*) FROM purchase_batches WHERE category_id = @id) AS c
    `).get({ id }).c;
    if (linked > 0) {
      db.prepare('UPDATE categories SET active = 0, updated_at = ? WHERE id = ?').run(now(), id);
      audit('archive', entity, id, oldRow, { active: 0 });
      return { id, archived: true };
    }
  }

  if (['expenses', 'purchases', 'sales'].includes(entity)) {
    db.prepare(`UPDATE ${cfg.table} SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(now(), now(), id);
  } else if (entity === 'users') {
    db.prepare("UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?").run(now(), id);
  } else {
    db.prepare(`DELETE FROM ${cfg.table} WHERE id = ?`).run(id);
  }
  audit('delete', entity, id, oldRow, null);
  return { id };
}

function applyPermissionOverrides(userId, permissions) {
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
  if (target?.role === 'super_admin' && activeSession?.user?.role !== 'super_admin') {
    throw new Error('لا يمكن تعديل صلاحيات Super Admin.');
  }
  const stmt = db.prepare(`
    INSERT INTO user_permission_overrides (user_id, permission, allowed, changed_by, changed_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, permission) DO UPDATE SET
      allowed = excluded.allowed,
      changed_by = excluded.changed_by,
      changed_at = excluded.changed_at
  `);
  Object.entries(permissions).forEach(([permission, allowed]) => {
    if (!ALL_PERMISSIONS.includes(permission)) return;
    const old = db.prepare('SELECT allowed FROM user_permission_overrides WHERE user_id = ? AND permission = ?').get(userId, permission);
    stmt.run(userId, permission, allowed ? 1 : 0, activeSession?.user?.id || null, now());
    audit('permission_change', 'users', userId, { permission, allowed: old?.allowed }, { permission, allowed: allowed ? 1 : 0 });
  });
}

function dashboard() {
  requirePermission('dashboard.view');
  const month = new Date().toISOString().slice(0, 7);
  const today = new Date().toISOString().slice(0, 10);
  const sums = {
    todayExpenses: db.prepare("SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE date = ? AND status = 'approved' AND deleted_at IS NULL").get(today).v,
    monthExpenses: db.prepare("SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE substr(date, 1, 7) = ? AND status = 'approved' AND deleted_at IS NULL").get(month).v,
    monthPurchases: db.prepare("SELECT COALESCE(SUM(total_price), 0) AS v FROM purchase_batches WHERE substr(date, 1, 7) = ? AND status = 'approved' AND deleted_at IS NULL").get(month).v,
    monthSales: db.prepare("SELECT COALESCE(SUM(revenue), 0) AS v FROM sales WHERE substr(date, 1, 7) = ? AND status = 'approved' AND deleted_at IS NULL").get(month).v,
    cogs: db.prepare("SELECT COALESCE(SUM(cogs), 0) AS v FROM sales WHERE substr(date, 1, 7) = ? AND status = 'approved' AND deleted_at IS NULL").get(month).v,
    grossProfit: db.prepare("SELECT COALESCE(SUM(gross_profit), 0) AS v FROM sales WHERE substr(date, 1, 7) = ? AND status = 'approved' AND deleted_at IS NULL").get(month).v,
    inventoryValue: db.prepare('SELECT COALESCE(SUM(current_stock * average_cost), 0) AS v FROM materials').get().v,
    purchaseCount: db.prepare("SELECT COUNT(*) AS v FROM purchase_batches WHERE substr(date, 1, 7) = ? AND deleted_at IS NULL").get(month).v,
    expenseCount: db.prepare("SELECT COUNT(*) AS v FROM expenses WHERE substr(date, 1, 7) = ? AND deleted_at IS NULL").get(month).v
  };
  sums.netProfit = sums.grossProfit - sums.monthExpenses;

  const visible = {
    todayExpenses: has('expenses.view') ? sums.todayExpenses : undefined,
    monthExpenses: has('expenses.view') ? sums.monthExpenses : undefined,
    monthPurchases: has('purchases.view') ? sums.monthPurchases : undefined,
    monthSales: has('financial.view_revenue') ? sums.monthSales : undefined,
    cogs: has('financial.view_cogs') ? sums.cogs : undefined,
    grossProfit: has('financial.view_gross_profit') ? sums.grossProfit : undefined,
    operatingExpenses: has('expenses.view') ? sums.monthExpenses : undefined,
    netProfit: has('financial.view_net_profit') ? sums.netProfit : undefined,
    inventoryValue: has('inventory.view') ? sums.inventoryValue : undefined,
    purchaseCount: has('purchases.view') ? sums.purchaseCount : undefined,
    expenseCount: has('expenses.view') ? sums.expenseCount : undefined
  };

  const monthly = db.prepare(`
    WITH months AS (
      SELECT substr(date, 1, 7) AS month FROM sales
      UNION SELECT substr(date, 1, 7) AS month FROM expenses
    )
    SELECT m.month,
      COALESCE((SELECT SUM(revenue) FROM sales WHERE substr(date, 1, 7) = m.month AND status = 'approved' AND deleted_at IS NULL), 0) AS revenue,
      COALESCE((SELECT SUM(amount) FROM expenses WHERE substr(date, 1, 7) = m.month AND status = 'approved' AND deleted_at IS NULL), 0) AS expenses,
      COALESCE((SELECT SUM(gross_profit) FROM sales WHERE substr(date, 1, 7) = m.month AND status = 'approved' AND deleted_at IS NULL), 0) AS gross_profit
    FROM months m
    ORDER BY m.month DESC
    LIMIT 12
  `).all().reverse().map((row) => ({
    month: row.month,
    revenue: has('financial.view_revenue') ? row.revenue : undefined,
    expenses: has('expenses.view') ? row.expenses : undefined,
    profit: has('financial.view_net_profit') ? row.gross_profit - row.expenses : undefined
  }));

  const expenseByCategory = has('expenses.view') ? db.prepare(`
    SELECT c.name_ar AS name, COALESCE(SUM(e.amount), 0) AS value
    FROM expenses e
    LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.status = 'approved' AND e.deleted_at IS NULL
    GROUP BY c.id
    ORDER BY value DESC
    LIMIT 8
  `).all() : [];

  const employeeMini = activeSession.user.role === 'employee' ? db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM expenses WHERE created_by = @uid AND date = @today AND deleted_at IS NULL) +
      (SELECT COUNT(*) FROM purchase_batches WHERE created_by = @uid AND date = @today AND deleted_at IS NULL) +
      (SELECT COUNT(*) FROM sales WHERE created_by = @uid AND date = @today AND deleted_at IS NULL) AS today_ops
  `).get({ uid: activeSession.user.id, today }) : null;

  return {
    metrics: visible,
    monthly,
    expenseByCategory,
    employeeMini,
    permissions: activeSession.permissions
  };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#f7f3e9',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer ${level}] ${message} (${sourceId}:${line})`);
  });

  const distFile = path.join(__dirname, 'dist', 'index.html');
  if (process.env.VITE_DEV === '1') {
    win.loadURL('http://127.0.0.1:5173').catch(() => {
      if (fs.existsSync(distFile)) win.loadFile(distFile);
    });
  } else if (fs.existsSync(distFile)) {
    win.loadFile(distFile);
  } else {
    win.loadURL('http://127.0.0.1:5173');
  }
}

ipcMain.handle('auth:login', (_event, credentials) => {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(credentials.username);
  if (!user || !verifyPassword(credentials.password, user.password_hash)) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة.');
  if (user.status !== 'active') throw new Error('هذا الحساب معطل.');
  db.prepare('UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?').run(now(), now(), user.id);
  const clean = safeRow(user);
  activeSession = { user: clean, permissions: permissionsForUser(user), startedAt: now() };
  audit('login', 'auth', user.id, null, { username: user.username });
  return activeSession;
});

ipcMain.handle('auth:logout', () => {
  activeSession = null;
  return true;
});

ipcMain.handle('auth:session', () => activeSession);
ipcMain.handle('data:list', (_event, entity, params) => listEntity(entity, params));
ipcMain.handle('data:create', (_event, entity, payload) => createEntity(entity, payload));
ipcMain.handle('data:update', (_event, entity, id, payload) => updateEntity(entity, id, payload));
ipcMain.handle('data:delete', (_event, entity, id) => deleteEntity(entity, id));
ipcMain.handle('reports:dashboard', () => dashboard());
ipcMain.handle('reports:productCost', (_event, productId) => {
  requirePermission('products.view');
  const result = calculateProductCost(productId);
  const product = db.prepare('SELECT selling_price FROM products WHERE id = ?').get(productId);
  const price = Number(product?.selling_price || 0);
  return {
    ...result,
    sellingPrice: price,
    grossProfit: price - result.total,
    margin: price ? ((price - result.total) / price) * 100 : 0
  };
});

ipcMain.handle('system:backup', async () => {
  requirePermission('backups.create');
  const target = await dialog.showSaveDialog(win, {
    title: 'حفظ نسخة احتياطية',
    defaultPath: `101coffee-backup-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: 'SQLite Database', extensions: ['db'] }]
  });
  if (target.canceled || !target.filePath) return null;
  fs.copyFileSync(dbPath, target.filePath);
  audit('backup', 'system', null, null, { path: target.filePath });
  return target.filePath;
});

ipcMain.handle('system:exportExcel', async (_event, entity) => {
  requirePermission('reports.export');
  const rows = listEntity(entity);
  const xml = toExcelXml(entity, rows);
  const target = await dialog.showSaveDialog(win, {
    title: 'تصدير Excel',
    defaultPath: `${entity}-${new Date().toISOString().slice(0, 10)}.xls`,
    filters: [{ name: 'Excel', extensions: ['xls'] }]
  });
  if (target.canceled || !target.filePath) return null;
  fs.writeFileSync(target.filePath, xml, 'utf8');
  audit('export', entity, null, null, { path: target.filePath });
  return target.filePath;
});

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toExcelXml(sheetName, rows) {
  const headers = rows[0] ? Object.keys(rows[0]) : ['empty'];
  const rowXml = rows.map((row) => `
    <Row>${headers.map((key) => `<Cell><Data ss:Type="String">${xmlEscape(row[key])}</Data></Cell>`).join('')}</Row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="${xmlEscape(sheetName).slice(0, 31)}">
    <Table>
      <Row>${headers.map((key) => `<Cell><Data ss:Type="String">${xmlEscape(key)}</Data></Cell>`).join('')}</Row>
      ${rowXml}
    </Table>
  </Worksheet>
</Workbook>`;
}

app.whenReady().then(() => {
  openDatabase();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
