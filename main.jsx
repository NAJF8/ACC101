import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BadgeDollarSign, BarChart3, Boxes, Calculator, ClipboardList, Coffee,
  FileSpreadsheet, Home, Layers3, Lock, LogOut, Package, Plus, ReceiptText,
  Save, Settings, ShieldCheck, ShoppingCart, Trash2, Users, WalletCards
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import { api, defaultCats, permissionGroups } from './src/services/api.js';
import './styles.css';

const money = (value) => `${Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} د.ع`;
const today = () => new Date().toISOString().slice(0, 10);
const month = () => new Date().toISOString().slice(0, 7);

const sections = [
  { id: 'dashboard', label: 'لوحة التحكم', icon: Home, permission: 'dashboard.view' },
  { id: 'pos', label: 'POS المصاريف', icon: Calculator, permission: 'expenses.create' },
  { id: 'purchases', label: 'المشتريات', icon: ShoppingCart, permission: 'purchases.view' },
  { id: 'expenses', label: 'المصاريف التشغيلية', icon: ReceiptText, permission: 'expenses.view' },
  { id: 'inventory', label: 'المخزون والمواد', icon: Boxes, permission: 'inventory.view' },
  { id: 'products', label: 'المنتجات والوصفات', icon: Coffee, permission: 'products.view' },
  { id: 'sales', label: 'المبيعات', icon: BadgeDollarSign, permission: 'sales.view' },
  { id: 'payroll', label: 'الرواتب', icon: WalletCards, permission: 'payroll.view' },
  { id: 'suppliers', label: 'الموردون والديون', icon: Package, permission: 'suppliers.view' },
  { id: 'users', label: 'الموظفون والصلاحيات', icon: Users, permission: 'users.view' },
  { id: 'reports', label: 'التقارير والتصدير', icon: FileSpreadsheet, permission: 'reports.view' },
  { id: 'audit', label: 'Audit Log', icon: ShieldCheck, permission: 'audit.view' }
];



function App() {
  const [session, setSession] = useState(null);
  const [active, setActive] = useState('dashboard');
  const [toast, setToast] = useState('');

  useEffect(() => {
    api.session().then(setSession).catch(() => {});
  }, []);

  const can = (permission) => session?.permissions?.includes(permission);
  const visibleSections = sections.filter((section) => can(section.permission));

  if (!session) return <Login onLogin={setSession} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">101</div>
          <div>
            <strong>101 COFFEE</strong>
            <span>نظام إدارة التكاليف</span>
          </div>
        </div>
        <nav>
          {visibleSections.map((section) => {
            const Icon = section.icon;
            return (
              <button key={section.id} className={active === section.id ? 'active' : ''} onClick={() => setActive(section.id)}>
                <Icon size={19} />
                <span>{section.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="user-card">
          <div>
            <strong>{session.user.name}</strong>
            <span>{roleLabel(session.user.role)}</span>
          </div>
          <button className="icon-button" title="تسجيل خروج" onClick={async () => { await api.logout(); setSession(null); }}>
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{sections.find((s) => s.id === active)?.label || '101 COFFEE'}</h1>
            <p>قاعدة البيانات المحلية: SQLite، العملة الأساسية: الدينار العراقي</p>
          </div>
          <div className="topbar-actions">
            <button onClick={() => api.backup().then((p) => p && setToast('تم إنشاء نسخة احتياطية'))} disabled={!can('backups.create')}>
              <ShieldCheck size={17} /> نسخة احتياطية
            </button>
            <button onClick={() => setActive('pos')} disabled={!can('expenses.create')}>
              <Plus size={17} /> عملية جديدة
            </button>
          </div>
        </header>
        <Screen active={active} session={session} can={can} setToast={setToast} />
      </main>
      {toast && <div className="toast" onAnimationEnd={() => setToast('')}>{toast}</div>}
    </div>
  );
}

function Login({ onLogin }) {
  const [credentials, setCredentials] = useState({ username: 'admin', password: 'admin123' });
  const [error, setError] = useState('');
  return (
    <div className="login-page">
      <form className="login-box" onSubmit={async (event) => {
        event.preventDefault();
        setError('');
        try { onLogin(await api.login(credentials)); }
        catch (err) { setError(err.message); }
      }}>
        <div className="brand-mark large">101</div>
        <h1>101 COFFEE Finance</h1>
        <p>نظام محلي للمحاسبة والتكاليف والمصاريف</p>
        <label>اسم المستخدم</label>
        <input value={credentials.username} onChange={(e) => setCredentials({ ...credentials, username: e.target.value })} />
        <label>كلمة المرور</label>
        <input type="password" value={credentials.password} onChange={(e) => setCredentials({ ...credentials, password: e.target.value })} />
        {error && <div className="error">{error}</div>}
        <button className="primary"><Lock size={17} /> دخول</button>
        <small>الحساب الأولي: admin / admin123</small>
      </form>
    </div>
  );
}

function Screen(props) {
  const map = {
    dashboard: Dashboard,
    pos: PosExpenses,
    purchases: Purchases,
    expenses: Expenses,
    inventory: Inventory,
    products: Products,
    sales: Sales,
    payroll: Payroll,
    suppliers: Suppliers,
    users: UsersPermissions,
    reports: Reports,
    audit: Audit
  };
  const Component = map[props.active] || Dashboard;
  return <Component {...props} />;
}

function Dashboard({ can }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.dashboard().then(setData); }, []);
  if (!data) return <Loader />;
  const cards = [
    ['إجمالي المصاريف اليوم', data.metrics.todayExpenses, 'expenses.view', ReceiptText],
    ['إجمالي المصاريف هذا الشهر', data.metrics.monthExpenses, 'expenses.view', ReceiptText],
    ['المشتريات هذا الشهر', data.metrics.monthPurchases, 'purchases.view', ShoppingCart],
    ['إجمالي المبيعات', data.metrics.monthSales, 'financial.view_revenue', BarChart3],
    ['COGS', data.metrics.cogs, 'financial.view_cogs', Layers3],
    ['الربح الإجمالي', data.metrics.grossProfit, 'financial.view_gross_profit', BadgeDollarSign],
    ['المصاريف التشغيلية', data.metrics.operatingExpenses, 'expenses.view', ClipboardList],
    ['صافي الربح', data.metrics.netProfit, 'financial.view_net_profit', WalletCards],
    ['قيمة المخزون', data.metrics.inventoryValue, 'inventory.view', Boxes],
    ['عدد عمليات الشراء', data.metrics.purchaseCount, 'purchases.view', ShoppingCart],
    ['عدد عمليات المصروفات', data.metrics.expenseCount, 'expenses.view', ReceiptText]
  ].filter(([, value, permission]) => can(permission) && value !== undefined);

  if (data.employeeMini) {
    return (
      <section className="panel">
        <h2>واجهتك اليوم</h2>
        <div className="employee-dash">
          <div><strong>{data.employeeMini.today_ops}</strong><span>عمليات أدخلتها اليوم</span></div>
          <p>يمكنك إدخال المصاريف أو المشتريات حسب صلاحياتك. البيانات المالية الحساسة غير مرسلة لهذه الواجهة.</p>
        </div>
      </section>
    );
  }

  return (
    <div className="screen-stack">
      <div className="kpi-grid">
        {cards.map(([label, value,, Icon]) => (
          <article className="kpi" key={label}>
            <Icon size={22} />
            <span>{label}</span>
            <strong className={Number(value) < 0 ? 'loss' : ''}>{typeof value === 'number' ? money(value) : value}</strong>
          </article>
        ))}
      </div>
      <div className="chart-grid">
        <ChartPanel title="المبيعات مقابل المصاريف">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data.monthly}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(v) => money(v)} />
              <Area dataKey="revenue" name="المبيعات" stroke="#1f7a4d" fill="#d7ead9" />
              <Area dataKey="expenses" name="المصاريف" stroke="#b45309" fill="#f3dfc3" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title="صافي الربح الشهري">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.monthly}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(v) => money(v)} />
              <Bar dataKey="profit" name="الربح" fill="#276749" />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title="توزيع المصروفات حسب الأقسام">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={data.expenseByCategory} dataKey="value" nameKey="name" innerRadius={58} outerRadius={96}>
                {data.expenseByCategory.map((_, index) => <Cell key={index} fill={['#1f7a4d', '#8a6f3d', '#bc6c25', '#9d4edd', '#6b7280'][index % 5]} />)}
              </Pie>
              <Tooltip formatter={(v) => money(v)} />
            </PieChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>
    </div>
  );
}

function PosExpenses({ setToast }) {
  const [categories, setCategories] = useState([]);
  const [selected, setSelected] = useState(null);
  useEffect(() => { api.list('categories').then((rows) => setCategories(rows.filter((c) => c.active))); }, []);
  return (
    <div className="screen-stack">
      <div className="pos-grid">
        {categories.map((cat) => (
          <button key={cat.id} className="pos-tile" style={{ '--tile': cat.color }} onClick={() => setSelected(cat)}>
            <CategoryIcon name={cat.icon} />
            <strong>{cat.name_ar}</strong>
            <span>{cat.type}</span>
          </button>
        ))}
      </div>
      {selected && (
        <Modal title={`تسجيل مصروف: ${selected.name_ar}`} onClose={() => setSelected(null)}>
          <ExpenseForm categoryId={selected.id} onDone={() => { setSelected(null); setToast('تم حفظ العملية بنجاح'); }} />
        </Modal>
      )}
    </div>
  );
}

function Purchases({ setToast }) {
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const load = () => api.list('purchases').then(setRows);
  useEffect(load, []);
  return (
    <CrudPanel title="دفعات المشتريات" action="إضافة شراء" onAction={() => setShow(true)}>
      <DataTable rows={rows} columns={[
        ['date', 'التاريخ'], ['material_name', 'المادة'], ['quantity', 'الكمية'], ['unit', 'الوحدة'],
        ['total_price', 'الإجمالي', money], ['unit_price', 'سعر الوحدة', money], ['supplier_name', 'المورد'],
        ['remaining_amount', 'المتبقي', money], ['status', 'الحالة']
      ]} />
      {show && <Modal title="إضافة عملية شراء" onClose={() => setShow(false)}><PurchaseForm onDone={() => { setShow(false); load(); setToast('تم حفظ عملية الشراء وتحديث متوسط التكلفة'); }} /></Modal>}
    </CrudPanel>
  );
}

function Expenses({ setToast }) {
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const load = () => api.list('expenses').then(setRows);
  useEffect(load, []);
  return (
    <CrudPanel title="المصاريف التشغيلية" action="إضافة مصروف" onAction={() => setShow(true)}>
      <DataTable rows={rows} columns={[
        ['date', 'التاريخ'], ['category_name', 'القسم'], ['description', 'الوصف'], ['amount', 'المبلغ', money],
        ['payment_method', 'الدفع'], ['beneficiary', 'المستفيد'], ['status', 'الحالة'], ['created_by_name', 'أدخلها']
      ]} />
      {show && <Modal title="إضافة مصروف" onClose={() => setShow(false)}><ExpenseForm onDone={() => { setShow(false); load(); setToast('تم حفظ المصروف'); }} /></Modal>}
    </CrudPanel>
  );
}

function Inventory() {
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const load = () => api.list('materials').then(setRows);
  useEffect(load, []);
  return (
    <CrudPanel title="المواد والمخزون" action="إضافة مادة" onAction={() => setShow(true)}>
      <DataTable rows={rows} columns={[
        ['name_ar', 'المادة'], ['category_name', 'القسم'], ['base_unit', 'الوحدة'], ['current_stock', 'المخزون'],
        ['average_cost', 'متوسط التكلفة', money], ['inventory_value', 'قيمة المخزون', money],
        ['last_price', 'آخر سعر', money], ['highest_price', 'أعلى سعر', money], ['lowest_price', 'أقل سعر', money]
      ]} />
      {show && <Modal title="إضافة مادة" onClose={() => setShow(false)}><MaterialForm onDone={() => { setShow(false); load(); }} /></Modal>}
    </CrudPanel>
  );
}

function Products({ setToast }) {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [cost, setCost] = useState(null);
  const load = () => api.list('products').then(setRows);
  useEffect(load, []);
  useEffect(() => {
    if (selected) api.productCost(selected.id).then(setCost);
  }, [selected]);
  return (
    <CrudPanel title="المنتجات وتكلفة الوصفة" action="إضافة منتج" onAction={() => setSelected({})}>
      <DataTable rows={rows} onRowClick={setSelected} columns={[
        ['name', 'المنتج'], ['selling_price', 'سعر البيع', money], ['active', 'الحالة', (v) => v ? 'فعال' : 'متوقف']
      ]} />
      {selected && (
        <Modal title={selected.id ? `تكلفة ${selected.name}` : 'إضافة منتج'} onClose={() => { setSelected(null); setCost(null); }}>
          {selected.id ? <ProductCost cost={cost} /> : <ProductForm onDone={() => { setSelected(null); load(); setToast('تم حفظ المنتج'); }} />}
        </Modal>
      )}
    </CrudPanel>
  );
}

function Sales({ setToast }) {
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const load = () => api.list('sales').then(setRows);
  useEffect(load, []);
  return (
    <CrudPanel title="إدخال المبيعات اليومية" action="إضافة مبيعات" onAction={() => setShow(true)}>
      <DataTable rows={rows} columns={[
        ['date', 'التاريخ'], ['product_name', 'المنتج'], ['quantity', 'الكمية'], ['unit_price', 'سعر البيع', money],
        ['revenue', 'Revenue', money], ['cogs', 'COGS', money], ['gross_profit', 'Gross Profit', money]
      ]} />
      {show && <Modal title="إضافة مبيعات" onClose={() => setShow(false)}><SaleForm onDone={() => { setShow(false); load(); setToast('تم حفظ المبيعات وحساب COGS'); }} /></Modal>}
    </CrudPanel>
  );
}

function Payroll({ setToast }) {
  const [employees, setEmployees] = useState([]);
  const [payroll, setPayroll] = useState([]);
  const [tab, setTab] = useState('employees');
  const [show, setShow] = useState(false);
  const load = () => Promise.all([api.list('employees'), api.list('payroll')]).then(([e, p]) => { setEmployees(e); setPayroll(p); });
  useEffect(load, []);
  return (
    <div className="screen-stack">
      <div className="tabs">
        <button className={tab === 'employees' ? 'active' : ''} onClick={() => setTab('employees')}>الموظفون</button>
        <button className={tab === 'payroll' ? 'active' : ''} onClick={() => setTab('payroll')}>مسير الرواتب</button>
        <button onClick={() => setShow(true)}><Plus size={16} /> إضافة</button>
      </div>
      {tab === 'employees' ? <DataTable rows={employees} columns={[['name', 'الاسم'], ['job_title', 'الوظيفة'], ['base_salary', 'الراتب الأساسي', money], ['start_date', 'تاريخ البدء'], ['status', 'الحالة']]} /> : <DataTable rows={payroll} columns={[['month', 'الشهر'], ['employee_name', 'الموظف'], ['base_salary', 'الراتب', money], ['advance', 'سلفة', money], ['deduction', 'خصم', money], ['bonus', 'مكافأة', money], ['net_paid', 'الصافي', money], ['paid_date', 'تاريخ الدفع']]} />}
      {show && <Modal title={tab === 'employees' ? 'إضافة موظف' : 'إضافة راتب شهري'} onClose={() => setShow(false)}>
        {tab === 'employees' ? <EmployeeForm onDone={() => { setShow(false); load(); setToast('تم حفظ الموظف'); }} /> : <PayrollForm employees={employees} onDone={() => { setShow(false); load(); setToast('تم حفظ الراتب'); }} />}
      </Modal>}
    </div>
  );
}

function Suppliers() {
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const load = () => api.list('suppliers').then(setRows);
  useEffect(load, []);
  return (
    <CrudPanel title="الموردون والديون" action="إضافة مورد" onAction={() => setShow(true)}>
      <DataTable rows={rows} columns={[
        ['name', 'المورد'], ['phone', 'الهاتف'], ['total_purchases', 'إجمالي المشتريات', money],
        ['paid', 'المدفوع', money], ['remaining', 'المتبقي', money], ['last_operation', 'آخر عملية']
      ]} />
      {show && <Modal title="إضافة مورد" onClose={() => setShow(false)}><SupplierForm onDone={() => { setShow(false); load(); }} /></Modal>}
    </CrudPanel>
  );
}

function UsersPermissions({ setToast }) {
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(null);
  const load = () => api.list('users').then(setUsers);
  useEffect(load, []);
  return (
    <CrudPanel title="Users & Permissions" action="إضافة مستخدم" onAction={() => setSelected({})}>
      <DataTable rows={users} onRowClick={setSelected} columns={[
        ['name', 'Name'], ['username', 'Username'], ['role', 'Role', roleLabel], ['status', 'Status'], ['last_login', 'Last Login']
      ]} />
      {selected && <Modal title={selected.id ? `صلاحيات ${selected.name}` : 'إضافة مستخدم'} onClose={() => setSelected(null)}>
        <UserForm user={selected} onDone={() => { setSelected(null); load(); setToast('تم حفظ المستخدم والصلاحيات'); }} />
      </Modal>}
    </CrudPanel>
  );
}

function Reports() {
  const entities = ['purchases', 'expenses', 'sales', 'materials', 'suppliers', 'payroll'];
  return (
    <section className="panel">
      <h2>التقارير والتصدير</h2>
      <p className="muted">التصدير يقرأ من SQLite مباشرة ويحترم صلاحيات المستخدم الحالي.</p>
      <div className="action-grid">
        {entities.map((entity) => <button key={entity} onClick={() => api.exportExcel(entity)}><FileSpreadsheet size={20} /> تصدير {entity}</button>)}
      </div>
    </section>
  );
}

function Audit() {
  const [rows, setRows] = useState([]);
  useEffect(() => { api.list('audit').then(setRows); }, []);
  return <CrudPanel title="Audit Log"><DataTable rows={rows} columns={[['created_at', 'الوقت'], ['actor_name', 'المستخدم'], ['action', 'العملية'], ['entity', 'الكيان'], ['entity_id', 'ID'], ['new_value', 'القيمة الجديدة']]} /></CrudPanel>;
}

function ExpenseForm({ categoryId, onDone }) {
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({ date: today(), category_id: categoryId || '', description: '', amount: '', payment_method: 'نقدي', beneficiary: '', notes: '', recurring: 0, recurring_frequency: '' });
  useEffect(() => { api.list('categories').then(setCategories); }, []);
  return <SmartForm form={form} setForm={setForm} fields={[
    ['date', 'date', 'التاريخ'], ['category_id', 'select', 'القسم', categories.map((c) => [c.id, c.name_ar])],
    ['description', 'text', 'الوصف'], ['amount', 'number', 'المبلغ بالدينار العراقي'],
    ['payment_method', 'text', 'طريقة الدفع'], ['beneficiary', 'text', 'المستفيد'], ['notes', 'textarea', 'ملاحظة'],
    ['recurring', 'checkbox', 'مصروف متكرر'], ['recurring_frequency', 'text', 'التكرار']
  ]} onSubmit={() => api.create('expenses', form).then(onDone)} />;
}

function PurchaseForm({ onDone }) {
  const [categories, setCategories] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState({ date: today(), category_id: '', material_id: '', quantity: '', unit: 'kg', total_price: '', paid_amount: '', supplier_id: '', invoice_no: '', payment_method: 'نقدي', notes: '' });
  useEffect(() => { Promise.all([api.list('categories'), api.list('materials'), api.list('suppliers')]).then(([c, m, s]) => { setCategories(c); setMaterials(m); setSuppliers(s); }); }, []);
  return <SmartForm form={form} setForm={setForm} fields={[
    ['date', 'date', 'التاريخ'], ['category_id', 'select', 'القسم', categories.map((c) => [c.id, c.name_ar])],
    ['material_id', 'select', 'المادة', materials.map((m) => [m.id, m.name_ar])], ['quantity', 'number', 'الكمية'],
    ['unit', 'select', 'الوحدة', units().map((u) => [u, u])], ['total_price', 'number', 'السعر الإجمالي د.ع'],
    ['paid_amount', 'number', 'المدفوع'], ['supplier_id', 'select', 'المورد', suppliers.map((s) => [s.id, s.name])],
    ['invoice_no', 'text', 'رقم الفاتورة'], ['payment_method', 'text', 'طريقة الدفع'], ['notes', 'textarea', 'ملاحظات']
  ]} onSubmit={() => api.create('purchases', form).then(onDone)} />;
}

function MaterialForm({ onDone }) {
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState({ name_ar: '', name_en: '', category_id: '', base_unit: 'kg', min_stock: 0, default_supplier_id: '', active: 1, notes: '' });
  useEffect(() => { Promise.all([api.list('categories'), api.list('suppliers')]).then(([c, s]) => { setCategories(c); setSuppliers(s); }); }, []);
  return <SmartForm form={form} setForm={setForm} fields={[
    ['name_ar', 'text', 'الاسم العربي'], ['name_en', 'text', 'الاسم الإنجليزي'],
    ['category_id', 'select', 'القسم', categories.map((c) => [c.id, c.name_ar])], ['base_unit', 'select', 'الوحدة الأساسية', units().map((u) => [u, u])],
    ['min_stock', 'number', 'الحد الأدنى'], ['default_supplier_id', 'select', 'المورد الافتراضي', suppliers.map((s) => [s.id, s.name])],
    ['notes', 'textarea', 'ملاحظات']
  ]} onSubmit={() => api.create('materials', form).then(onDone)} />;
}

function ProductForm({ onDone }) {
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({ name: '', category_id: '', selling_price: '', active: 1 });
  useEffect(() => { api.list('categories').then(setCategories); }, []);
  return <SmartForm form={form} setForm={setForm} fields={[
    ['name', 'text', 'اسم المنتج'], ['category_id', 'select', 'القسم', categories.map((c) => [c.id, c.name_ar])],
    ['selling_price', 'number', 'سعر البيع د.ع']
  ]} onSubmit={() => api.create('products', form).then(onDone)} />;
}

function SaleForm({ onDone }) {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ date: today(), product_id: '', quantity: '', unit_price: '' });
  useEffect(() => { api.list('products').then(setProducts); }, []);
  return <SmartForm form={form} setForm={setForm} fields={[
    ['date', 'date', 'التاريخ'], ['product_id', 'select', 'المنتج', products.map((p) => [p.id, p.name])],
    ['quantity', 'number', 'الكمية المباعة'], ['unit_price', 'number', 'سعر البيع اختياري']
  ]} onSubmit={() => api.create('sales', form).then(onDone)} />;
}

function EmployeeForm({ onDone }) {
  const [form, setForm] = useState({ name: '', job_title: '', base_salary: '', start_date: today(), status: 'active', notes: '' });
  return <SmartForm form={form} setForm={setForm} fields={[
    ['name', 'text', 'اسم الموظف'], ['job_title', 'text', 'الوظيفة'], ['base_salary', 'number', 'الراتب الأساسي د.ع'],
    ['start_date', 'date', 'تاريخ بدء العمل'], ['status', 'select', 'الحالة', [['active', 'فعال'], ['inactive', 'متوقف']]], ['notes', 'textarea', 'ملاحظات']
  ]} onSubmit={() => api.create('employees', form).then(onDone)} />;
}

function PayrollForm({ employees, onDone }) {
  const [form, setForm] = useState({ employee_id: '', month: month(), base_salary: '', advance: 0, deduction: 0, bonus: 0, paid_date: today(), notes: '' });
  const net = Number(form.base_salary || 0) - Number(form.advance || 0) - Number(form.deduction || 0) + Number(form.bonus || 0);
  return <>
    <SmartForm form={form} setForm={setForm} fields={[
      ['employee_id', 'select', 'الموظف', employees.map((e) => [e.id, e.name])], ['month', 'month', 'الشهر'],
      ['base_salary', 'number', 'الراتب'], ['advance', 'number', 'سلفة'], ['deduction', 'number', 'خصم'],
      ['bonus', 'number', 'مكافأة'], ['paid_date', 'date', 'تاريخ الدفع'], ['notes', 'textarea', 'ملاحظة']
    ]} onSubmit={() => api.create('payroll', form).then(onDone)} />
    <div className="net-box">صافي المدفوع: <strong>{money(net)}</strong></div>
  </>;
}

function SupplierForm({ onDone }) {
  const [form, setForm] = useState({ name: '', phone: '', notes: '' });
  return <SmartForm form={form} setForm={setForm} fields={[
    ['name', 'text', 'اسم المورد'], ['phone', 'text', 'الهاتف'], ['notes', 'textarea', 'ملاحظات']
  ]} onSubmit={() => api.create('suppliers', form).then(onDone)} />;
}

function UserForm({ user, onDone }) {
  const [form, setForm] = useState({ name: user.name || '', username: user.username || '', password: '', role: user.role || 'employee', status: user.status || 'active', permissions: {} });
  const save = () => (user.id ? api.update('users', user.id, form) : api.create('users', form)).then(onDone);
  return (
    <div className="user-form">
      <SmartForm form={form} setForm={setForm} fields={[
        ['name', 'text', 'الاسم'], ['username', 'text', 'اسم المستخدم'],
        ['password', 'password', user.id ? 'كلمة مرور جديدة اختيارية' : 'كلمة المرور'],
        ['role', 'select', 'الدور', [['super_admin', 'Super Admin'], ['manager', 'Manager'], ['supervisor', 'Supervisor'], ['employee', 'Employee'], ['viewer', 'Viewer']]],
        ['status', 'select', 'الحالة', [['active', 'Active'], ['disabled', 'Disabled']]]
      ]} onSubmit={save} submitLabel="حفظ المستخدم" />
      <h3>Custom Permissions</h3>
      <div className="permission-grid">
        {Object.entries(permissionGroups).map(([group, perms]) => (
          <fieldset key={group}>
            <legend>{group}</legend>
            {perms.map((permission) => (
              <label className="check-row" key={permission}>
                <input
                  type="checkbox"
                  checked={!!form.permissions[permission]}
                  onChange={(e) => setForm({ ...form, permissions: { ...form.permissions, [permission]: e.target.checked } })}
                />
                <span>{permission}</span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
    </div>
  );
}

function SmartForm({ form, setForm, fields, onSubmit, submitLabel = 'حفظ' }) {
  const [error, setError] = useState('');
  return (
    <form className="smart-form" onSubmit={async (event) => {
      event.preventDefault();
      setError('');
      try { await onSubmit(); }
      catch (err) { setError(err.message); }
    }}>
      {fields.map(([key, type, label, options]) => (
        <label key={key} className={type === 'textarea' ? 'wide' : ''}>
          <span>{label}</span>
          {type === 'select' ? (
            <select value={form[key] ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })}>
              <option value="">اختر</option>
              {(options || []).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          ) : type === 'textarea' ? (
            <textarea value={form[key] ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
          ) : type === 'checkbox' ? (
            <input type="checkbox" checked={!!form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked ? 1 : 0 })} />
          ) : (
            <input type={type} value={form[key] ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
          )}
        </label>
      ))}
      {error && <div className="error wide">{error}</div>}
      <button className="primary wide"><Save size={17} /> {submitLabel}</button>
    </form>
  );
}

function CrudPanel({ title, action, onAction, children }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {action && <button onClick={onAction}><Plus size={17} /> {action}</button>}
      </div>
      {children}
    </section>
  );
}

function DataTable({ rows, columns, onRowClick }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={columns.length}>لا توجد بيانات بعد</td></tr> : rows.map((row, i) => (
            <tr key={row.id || i} onClick={() => onRowClick?.(row)} className={onRowClick ? 'clickable' : ''}>
              {columns.map(([key, , format]) => <td key={key}>{format ? format(row[key]) : row[key] ?? '-'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={onClose}><Trash2 size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}

function ChartPanel({ title, children }) {
  return <section className="panel chart-panel"><h2>{title}</h2>{children}</section>;
}

function ProductCost({ cost }) {
  if (!cost) return <Loader />;
  return (
    <div className="cost-box">
      <div><span>Total Cost</span><strong>{money(cost.total)}</strong></div>
      <div><span>Selling Price</span><strong>{money(cost.sellingPrice)}</strong></div>
      <div><span>Gross Profit</span><strong>{money(cost.grossProfit)}</strong></div>
      <div><span>Margin</span><strong>{Number(cost.margin || 0).toFixed(1)}%</strong></div>
      <DataTable rows={cost.lines} columns={[['material', 'المادة'], ['quantity', 'الكمية'], ['unit', 'الوحدة'], ['cost', 'التكلفة', money]]} />
    </div>
  );
}

function Loader() {
  return <div className="loader">جاري التحميل...</div>;
}

function CategoryIcon({ name }) {
  const icons = { coffee: Coffee, package: Package, wallet: WalletCards, bolt: Settings };
  const Icon = icons[name] || Layers3;
  return <Icon size={26} />;
}

function roleLabel(role) {
  return ({ super_admin: 'سوبر مشرف', manager: 'مدير', supervisor: 'مشرف', employee: 'موظف إدخال', viewer: 'مشاهدة فقط' })[role] || role;
}

function units() {
  return ['kg', 'g', 'liter', 'ml', 'piece', 'box', 'carton', 'pack', 'bottle', 'bag', 'كيلو', 'غرام', 'لتر', 'مل'];
}

createRoot(document.getElementById('root')).render(<App />);
