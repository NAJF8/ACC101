import { auth, db, ref, set, get, push, update, remove, onValue, serverTimestamp, signOut, GoogleAuthProvider, signInWithPopup } from './firebase.js';

export const permissionGroups = {
  Financial: [
    'financial.view_revenue', 'financial.view_cogs', 'financial.view_gross_profit',
    'financial.view_net_profit', 'financial.view_profit_margin',
    'financial.view_profit_by_category', 'financial.view_profit_by_product',
    'financial.view_financial_dashboard', 'financial.view_profitability_reports'
  ],
  Purchases: ['purchases.view', 'purchases.create', 'purchases.edit', 'purchases.delete'],
  Expenses: ['expenses.view', 'expenses.create', 'expenses.edit', 'expenses.delete'],
  Inventory: ['inventory.view', 'inventory.adjust', 'inventory.count', 'materials.view', 'materials.create', 'materials.edit', 'materials.delete'],
  Sales: ['sales.view', 'sales.create', 'sales.edit', 'sales.delete'],
  Products: ['products.view', 'products.create', 'products.edit', 'products.delete'],
  Suppliers: ['suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.delete'],
  Employees: ['employees.view', 'employees.create', 'employees.edit', 'employees.disable', 'payroll.view', 'payroll.create', 'payroll.edit'],
  Reports: ['reports.view', 'reports.export', 'imports.create', 'imports.undo'],
  Backups: ['backups.create', 'backups.restore'],
  System: ['users.view', 'users.create', 'users.edit', 'users.disable', 'settings.view', 'settings.edit', 'audit.view', 'system.reset']
};

export const defaultCats = [
    { id: 1, name_ar: 'قهوة', name_en: 'Coffee', type: 'مواد أولية', icon: 'coffee', color: '#1f7a4d', sort_order: 1, active: 1 },
    { id: 2, name_ar: 'شاي', name_en: 'Tea', type: 'مواد أولية', icon: 'cup', color: '#427a39', sort_order: 2, active: 1 },
    { id: 3, name_ar: 'حليب', name_en: 'Milk', type: 'مواد أولية', icon: 'milk', color: '#9c7a47', sort_order: 3, active: 1 },
    { id: 4, name_ar: 'سيربات', name_en: 'Syrups', type: 'مواد أولية', icon: 'droplet', color: '#b97d3c', sort_order: 4, active: 1 },
    { id: 5, name_ar: 'أكواب', name_en: 'Cups', type: 'مخزون', icon: 'package', color: '#606c38', sort_order: 5, active: 1 },
    { id: 6, name_ar: 'مواد تنظيف', name_en: 'Cleaning', type: 'مصاريف تشغيلية', icon: 'spray', color: '#3a6b66', sort_order: 6, active: 1 },
    { id: 7, name_ar: 'إيجار', name_en: 'Rent', type: 'مصاريف تشغيلية', icon: 'home', color: '#7f5539', sort_order: 7, active: 1 },
    { id: 8, name_ar: 'كهرباء', name_en: 'Electricity', type: 'خدمات', icon: 'bolt', color: '#b45309', sort_order: 8, active: 1 },
    { id: 9, name_ar: 'إنترنت', name_en: 'Internet', type: 'خدمات', icon: 'wifi', color: '#386641', sort_order: 9, active: 1 },
    { id: 10, name_ar: 'ماء', name_en: 'Water', type: 'خدمات', icon: 'droplet', color: '#00CED1', sort_order: 10, active: 1 },
    { id: 11, name_ar: 'مولدة', name_en: 'Generator', type: 'خدمات', icon: 'settings', color: '#808080', sort_order: 11, active: 1 },
    { id: 12, name_ar: 'صيانة', name_en: 'Maintenance', type: 'مصاريف تشغيلية', icon: 'tool', color: '#FF6347', sort_order: 12, active: 1 },
    { id: 13, name_ar: 'تسويق', name_en: 'Marketing', type: 'تسويق', icon: 'megaphone', color: '#bc6c25', sort_order: 13, active: 1 },
    { id: 14, name_ar: 'إعلانات', name_en: 'Ads', type: 'تسويق', icon: 'megaphone', color: '#FF69B4', sort_order: 14, active: 1 },
    { id: 15, name_ar: 'نقل', name_en: 'Transport', type: 'مصاريف تشغيلية', icon: 'truck', color: '#DAA520', sort_order: 15, active: 1 },
    { id: 16, name_ar: 'رواتب', name_en: 'Payroll', type: 'رواتب', icon: 'wallet', color: '#624c33', sort_order: 16, active: 1 },
    { id: 17, name_ar: 'أخرى', name_en: 'Other', type: 'أخرى', icon: 'more', color: '#6b7280', sort_order: 17, active: 1 }
];

let currentUserProfile = null;

async function fetchUserProfile(uid) {
  const snap = await get(ref(db, `users/${uid}`));
  if (snap.exists()) {
    return { id: uid, ...snap.val() };
  }
  return null;
}

export const api = {
  login: async () => {
    try {
      const provider = new GoogleAuthProvider();
      const userCredential = await signInWithPopup(auth, provider);
      const userProfile = await fetchUserProfile(userCredential.user.uid);
      
      if (!userProfile) {
        await signOut(auth);
        throw new Error('هذا الحساب غير مخول لاستخدام النظام.');
      }
      if (userProfile.active === false || userProfile.status === 'disabled') {
        await signOut(auth);
        throw new Error('هذا الحساب موقوف.');
      }
      
      currentUserProfile = userProfile;
      return api.session();
    } catch (err) {
      if (err.message === 'هذا الحساب موقوف.' || err.message === 'هذا الحساب غير مخول لاستخدام النظام.') throw err;
      throw new Error('فشل تسجيل الدخول.');
    }
  },
  
  logout: async () => {
    await signOut(auth);
    currentUserProfile = null;
    return true;
  },

  session: async () => {
    if (!auth.currentUser) return null;
    if (!currentUserProfile) {
      currentUserProfile = await fetchUserProfile(auth.currentUser.uid);
      if (!currentUserProfile) return null;
    }
    
    // Resolve permissions based on role and overrides
    let perms = [];
    if (currentUserProfile.role === 'super_admin') {
      perms = Object.values(permissionGroups).flat();
    } else if (currentUserProfile.role === 'manager') {
      perms = Object.values(permissionGroups).flat().filter(p => !['system.reset', 'users.delete', 'audit.delete'].includes(p));
    } else {
      // Use custom permissions if they exist, otherwise base role defaults
      if (currentUserProfile.permissions && Object.keys(currentUserProfile.permissions).length > 0) {
        perms = Object.keys(currentUserProfile.permissions).filter(k => currentUserProfile.permissions[k]);
      } else {
        if (currentUserProfile.role === 'supervisor') {
          perms = ['purchases.view', 'purchases.create', 'expenses.view', 'expenses.create', 'sales.view', 'inventory.view', 'inventory.count', 'dashboard.view'];
        } else if (currentUserProfile.role === 'employee') {
          perms = ['purchases.create', 'expenses.create', 'sales.create'];
        } else if (currentUserProfile.role === 'viewer') {
          perms = ['dashboard.view', 'reports.view'];
        }
      }
    }
    
    // Ensure pos and dashboard basic access if needed
    if (perms.includes('expenses.create')) perms.push('pos.view');
    
    return {
      user: currentUserProfile,
      permissions: perms
    };
  },

  list: async (entity) => {
    const snap = await get(ref(db, entity));
    if (!snap.exists()) return [];
    const data = snap.val();
    return Object.keys(data).map(key => ({ id: key, ...data[key] }));
  },

  create: async (entity, payload) => {
    const newRef = push(ref(db, entity));
    const now = new Date().toISOString();
    const data = {
      ...payload,
      id: newRef.key,
      created_at: now,
      created_by: auth.currentUser?.uid || 'system',
      created_by_name: currentUserProfile?.name || 'System'
    };
    await set(newRef, data);
    
    // Record audit log
    await api.logAudit('CREATE', entity, newRef.key, data);
    return data;
  },

  update: async (entity, id, payload) => {
    const itemRef = ref(db, `${entity}/${id}`);
    const data = {
      ...payload,
      updated_at: new Date().toISOString(),
      updated_by: auth.currentUser?.uid || 'system'
    };
    await update(itemRef, data);
    await api.logAudit('UPDATE', entity, id, data);
    return true;
  },

  remove: async (entity, id) => {
    const itemRef = ref(db, `${entity}/${id}`);
    const oldSnap = await get(itemRef);
    const oldData = oldSnap.exists() ? oldSnap.val() : null;
    
    // Soft delete for financial records
    if (['purchases', 'expenses', 'sales', 'payroll'].includes(entity)) {
      await update(itemRef, { deleted: true, deleted_at: new Date().toISOString(), deleted_by: auth.currentUser?.uid });
    } else {
      await remove(itemRef);
    }
    
    await api.logAudit('DELETE', entity, id, oldData);
    return true;
  },

  logAudit: async (action, entity, entityId, newValue) => {
    if (entity === 'auditLogs' || entity === 'audit') return;
    const logRef = push(ref(db, 'audit'));
    await set(logRef, {
      id: logRef.key,
      created_at: new Date().toISOString(),
      actor_uid: auth.currentUser?.uid || 'system',
      actor_name: currentUserProfile?.name || 'System',
      role: currentUserProfile?.role || 'system',
      action,
      entity,
      entity_id: entityId,
      new_value: JSON.stringify(newValue || {})
    });
  },

  dashboard: async () => {
    const s = await api.session();
    const perms = s?.permissions || [];
    
    const [expSnap, purSnap, salSnap] = await Promise.all([
      get(ref(db, 'expenses')),
      get(ref(db, 'purchases')),
      get(ref(db, 'sales'))
    ]);
    
    const exp = expSnap.exists() ? Object.values(expSnap.val()).filter(x => !x.deleted) : [];
    const pur = purSnap.exists() ? Object.values(purSnap.val()).filter(x => !x.deleted) : [];
    const sal = salSnap.exists() ? Object.values(salSnap.val()).filter(x => !x.deleted) : [];
    
    const rev = sal.reduce((sum, x) => sum + Number(x.revenue || 0), 0);
    const expTotal = exp.reduce((sum, x) => sum + Number(x.amount || 0), 0);
    const purTotal = pur.reduce((sum, x) => sum + Number(x.total_price || 0), 0);
    
    const isEmployeeOnly = s?.user?.role === 'employee';
    
    if (isEmployeeOnly) {
      const myId = s?.user?.id;
      const myExp = exp.filter(x => x.created_by === myId && x.date === new Date().toISOString().slice(0, 10));
      const myPur = pur.filter(x => x.created_by === myId && x.date === new Date().toISOString().slice(0, 10));
      return {
        metrics: {},
        employeeMini: { today_ops: myExp.length + myPur.length },
        permissions: perms
      };
    }
    
    return {
      metrics: {
        revenue: rev,
        cogs: 0,
        grossProfit: rev,
        netProfit: rev - expTotal,
        profitMargin: rev ? ((rev - expTotal) / rev) * 100 : 0,
        expenses: expTotal,
        purchases: purTotal,
        inventoryValue: 0,
        purchaseCount: pur.length,
        expenseCount: exp.length
      },
      monthly: [],
      expenseByCategory: [],
      employeeMini: null,
      permissions: perms
    };
  },

  productCost: async (id) => ({ total: 0, items: [] }),

  backup: async () => {
    alert('النسخ الاحتياطي السحابي يتم تلقائياً بواسطة Firebase.');
    return null;
  },

  exportExcel: async (entity) => {
    const items = await api.list(entity);
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entity}.json`;
    a.click();
    return entity;
  }
};
