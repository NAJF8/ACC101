import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { createRoot } from "react-dom/client";
import {
  Archive,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardList,
  Coffee,
  Edit3,
  FileSpreadsheet,
  Home,
  Layers,
  LogOut,
  Menu,
  Package,
  Plus,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import * as XLSX from "xlsx";
import { api } from "./services/api.js";
import {
  permissionGroups,
  permissionGroupLabels,
  getPermissionLabel,
  getRoleLabel,
  getPermissionPreset,
  hasPermission,
  permissionForEntity,
} from "./services/permissions.js";
import "../styles.css";
import "./reference.css";
import { aggregateFinancialTimeline, buildPayrollRows, buildPeriodComparison, currentMonth, getRecordMonth, monthLabel, nextMonth, normalizeDateRange, previousMonth, recordsForMonth } from "./services/financial.js";
import { buildInventorySalesAnalytics, filterExpiry, expiryStatus, inventoryBaseUnitCost, inventoryValue, isAmbiguousInventoryUnit, locationBalances, lowStockStatus, movementConsumptionBySource, normalizeBarcode, sortHistory, sortLowStock, packageEquivalent, packageSize } from "./services/inventory.js";
import { cameraMessages, createBarcodeCameraController } from "./services/barcodeCamera.js";

const money = (v) =>
  `${Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} د.ع`;
const today = () => new Date().toISOString().slice(0, 10);
const operationReference = (row = {}, prefix = "OP") => {
  const explicit = row.operation_number || row.invoice_number || row.reference || row.operation_id || row.operation_key;
  if (explicit) return String(explicit);
  const source = row.id || "legacy";
  const fragment = String(source).replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase() || "LEGACY";
  return `${prefix}-${fragment}`;
};
const cashTypeLabel = (value) => ({ IN: "إدخال", OUT: "إخراج" }[value] || value || "—");
const paymentMethodLabel = (value) => ({ cash: "نقدي", electronic: "إلكتروني / بطاقة", transfer: "تحويل", credit: "آجل" }[value] || value || "—");
const userFacingError = (error, fallback = "تعذر إتمام العملية.") => {
  const message = String(error?.message || error || "").trim();
  if (!message || /permission_denied|PERMISSION_DENIED|auth\//i.test(message)) return "لا تملك صلاحية تنفيذ هذه العملية.";
  if (/network|failed to fetch|fetch/i.test(message)) return "تعذر الاتصال بالخدمة المحلية. حاول مرة أخرى.";
  return message || fallback;
};
const localQa = import.meta.env.DEV && typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
const referencePrefix = { sales: "SALE", purchases: "PUR", expenses: "EXP", cash_movements: "CASH", debts: "DEBT", debt_payments: "DEBT-PAY", payroll_payments: "PAY", cashier_shifts: "SHIFT" };
const auditActionLabel = { CREATE: "إنشاء", UPDATE: "تعديل", DELETE: "إلغاء / أرشفة", PAYMENT_METHOD_REVIEWED: "تصحيح طريقة الدفع", PURCHASE_INVOICE_CREATED: "إنشاء فاتورة شراء", SHIFT_OPENED: "فتح وردية", SHIFT_CLOSED: "إغلاق وردية" };
const auditFieldLabel = { amount: "المبلغ", quantity: "الكمية", payment_method: "طريقة الدفع", status: "الحالة", reason: "السبب", date: "التاريخ", notes: "ملاحظات" };
const auditValueText = (value) => {
  if (value == null || value === "") return "—";
  if (typeof value !== "object") return String(value);
  return Object.entries(value).filter(([, item]) => item != null && item !== "").slice(0, 8).map(([key, item]) => `${auditFieldLabel[key] || "بيان"}: ${typeof item === "object" ? "…" : item}`).join(" · ");
};
const roleLabel = getRoleLabel;
const nav = [
  ["dashboard", "الرئيسية", Home],
  ["today", "اليوم في 101", CalendarDays],
  ["alerts", "مركز التنبيهات", Bell],
  ["payment_review", "مراجعة طرق الدفع", Receipt],
  ["shifts", "الورديات", WalletCards],
  ["account_review", "مراجعة الحسابات", ShieldCheck],
  ["purchases", "المشتريات", ShoppingCart],
  ["sales", "المبيعات", BarChart3],
  ["products", "المنتجات", Coffee],
  ["categories", "إدارة الأقسام", SlidersHorizontal],
  ["inventory", "المخزون", Boxes],
  ["expenses", "المصروفات", Receipt],
  ["other_income", "الإيرادات الأخرى", Receipt],
  ["employees", "ملفات الموظفين", Users],
  ["payroll", "رواتب الموظفين", Users],
  ["assets", "الأصول", Building2],
  ["suppliers", "التجار والشركات", Package],
  ["debts", "الديون والآجل", WalletCards],
  ["cash", "حركة الصندوق", WalletCards],
  ["partners", "الشركاء ورأس المال", Users],
  ["establishment", "تكاليف التأسيس والافتتاح", Building2],
  ["reports", "التقارير", ClipboardList],
  ["imports", "استيراد وتصدير Excel", FileSpreadsheet],
  ["users", "الموظفون والصلاحيات", Users],
  ["settings", "الإعدادات", Settings],
  ["system_reset", "تصفير النظام وبدء حسابات جديدة", ShieldCheck],
];
const pagePermissions = {
  today: "dashboard.view",
  alerts: "alerts.view",
  payment_review: "payment_review.edit",
  shifts: "shifts.view",
  account_review: "account_review.view",
  purchases: "purchases.view",
  sales: "sales.view",
  products: "products.view",
  categories: "categories.view",
  inventory: "inventory.view",
  expenses: "expenses.view",
  other_income: "other_income.view",
  employees: "employees.view",
  payroll: "payroll.view",
  assets: "assets.view",
  suppliers: "suppliers.view",
  debts: "debts.view",
  cash: "cash_movements.view",
  partners: "partners.view",
  establishment: "establishment.view",
  reports: "financial.view_profitability_reports",
  imports: "excel.import",
  users: "users.view",
  settings: "settings.view",
  system_reset: "system.reset",
};
const pageCreatePermissions = {
  purchases: "purchases.create", sales: "sales.create", products: "products.create",
  categories: "categories.create", inventory: "materials.create", expenses: "expenses.create",
  other_income: "other_income.create",
  payroll: "payroll.create", assets: "assets.create", suppliers: "suppliers.create",
  debts: "debts.create",
  employees: "employees.create",
  cash: "cash_movements.create", imports: "excel.import", users: "users.create", settings: "settings.edit",
  partners: "partners.manage", establishment: "establishment.manage", system_reset: "system.reset",
};
const pageIsAllowed = (session, pageId) => pageId === "dashboard" || hasPermission(session, pagePermissions[pageId]);
export function App() {
  console.info("BUILD_MARKER_20260913_2110");
  const [session, setSession] = useState(null),
    [active, setActive] = useState("dashboard"),
    [loading, setLoading] = useState(true),
    [authError, setAuthError] = useState(""),
    [retry, setRetry] = useState(0),
    [drawer, setDrawer] = useState(false),
    [toast, setToast] = useState(""),
    [selectedMonth, setSelectedMonth] = useState(currentMonth()),
    [months, setMonths] = useState([currentMonth()]),
    [periodStatus, setPeriodStatus] = useState(null),
    [periodMode, setPeriodMode] = useState("month"),
    [fromDate, setFromDate] = useState(""),
    [toDate, setToDate] = useState(""),
    [appliedRange, setAppliedRange] = useState({ mode: "month", month: currentMonth() }),
    [notifications, setNotifications] = useState([]),
    [notificationOpen, setNotificationOpen] = useState(false),
    [readNotificationIds, setReadNotificationIds] = useState([]),
    [legacyPayrollModal, setLegacyPayrollModal] = useState(false),
    [showNewMonth, setShowNewMonth] = useState(false),
    [alertTarget, setAlertTarget] = useState(null);
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setAuthError("");
    api.session().then((s) => { if (mounted) setSession(s); }).catch((e) => {
      if (mounted) {
        console.error("SESSION_FAILED", e);
        setAuthError(e.code === "AUTH_TIMEOUT" ? "تعذر التحقق من جلسة تسجيل الدخول" : (e.message || "تعذر التحقق من جلسة تسجيل الدخول"));
      }
    }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [retry]);
  useEffect(() => { if (session) api.availableMonths().then(setMonths).catch(() => setMonths([currentMonth()])); }, [session]);
  useEffect(() => { if (session && selectedMonth !== "all") api.get(`monthly_periods/${selectedMonth}`).then(setPeriodStatus).catch(() => setPeriodStatus(null)); else setPeriodStatus(null); }, [session, selectedMonth]);
  useEffect(() => {
    if (!session) return undefined;
    const key = `101-finance:notification-read:${session.user.id}`;
    try { setReadNotificationIds(JSON.parse(window.localStorage.getItem(key) || "[]")); } catch { setReadNotificationIds([]); }
    return api.subscribeSystemNotifications({ month: selectedMonth, onData: setNotifications, onError: () => setNotifications([]) });
  }, [session, selectedMonth]);
  useEffect(() => {
    if (!session) return;
    window.localStorage.setItem(`101-finance:notification-read:${session.user.id}`, JSON.stringify(readNotificationIds));
  }, [session, readNotificationIds]);
  useEffect(() => {
    const h = (e) => setActive(pageIsAllowed(session, e.detail) ? e.detail : "dashboard");
    document.addEventListener("app:navigate", h);
    return () => document.removeEventListener("app:navigate", h);
  }, [session]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 3200);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const can = (permission) => hasPermission(session, permission) || permission === "dashboard.view";
  const canPage = (pageId) => pageIsAllowed(session, pageId);
  const isSelectedMonthClosed = periodStatus?.status === "closed";
  const unreadNotifications = notifications.filter((item) => !readNotificationIds.includes(item.id));
  const markNotificationRead = (id) => setReadNotificationIds((rows) => rows.includes(id) ? rows : [...rows, id]);
  const openNotification = (item) => {
    markNotificationRead(item.id); setNotificationOpen(false);
    const target = item.target || {}; if (target.month) { setSelectedMonth(target.month); setAppliedRange({ mode: "month", month: target.month }); }
    setAlertTarget({ ...target, notificationId: item.id }); if (target.page) setActive(target.page);
  };
  const onMonthClosed = (next) => { setSelectedMonth(next); setAppliedRange({ mode: "month", month: next }); setActive("dashboard"); setToast(`تم إغلاق الشهر والانتقال إلى ${monthLabel(next)}.`); };
  const canStartAction = !isSelectedMonthClosed && (active === "dashboard" || can(pageCreatePermissions[active]));
  if (loading) return <Loader />;
  if (authError) return <div className="login-page"><div className="login-card"><h1>تعذر التحقق من جلسة تسجيل الدخول</h1><p>{authError}</p><button className="primary login-btn" onClick={() => setRetry((x) => x + 1)}>إعادة المحاولة</button></div></div>;
  if (!session) return <Login onLogin={setSession} />;
  const title = nav.find((x) => x[0] === active)?.[1] || "الرئيسية";
  return (
    <div className="app-shell">
      <aside className={`sidebar ${drawer ? "open" : ""}`}>
        <div className="brand">
          <img
            src="/assets/logo.jpg"
            alt="101 COFFEE HOUSE"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
          <div>
            <strong>101 COFFEE</strong>
            <span>Finance System</span>
          </div>
        </div>
        <nav>
          {nav
            .filter(
              ([id]) =>
                id === "dashboard" ||
                canPage(id),
            )
            .map(([id, label, Icon]) => (
              <button
                key={id}
                className={active === id ? "active" : ""}
                onClick={() => {
                  setActive(id);
                  setDrawer(false);
                }}
              >
                <Icon size={19} />
                <span>{label}</span>
              </button>
            ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-card">
            <div className="avatar">
              <UserRound size={17} />
            </div>
            <div>
              <strong>{session.user.name || "مستخدم النظام"}</strong>
              <span>{roleLabel(session.user.role)}</span>
            </div>
          </div>
          <button
            className="logout"
            onClick={async () => {
              await api.logout();
              setSession(null);
            }}
          >
            <LogOut size={17} /> تسجيل خروج
          </button>
        </div>
      </aside>
      {drawer && (
        <button
          className="scrim"
          onClick={() => setDrawer(false)}
          aria-label="إغلاق القائمة"
        />
      )}
      <main className="workspace">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setDrawer(true)}>
            <Menu />
          </button>
          <div className="search">
            <Search size={18} />
            <input placeholder="ابحث في المنتجات أو الأقسام أو أي شيء..." />
          </div>
          <div className="top-actions">
            <PeriodSelector mode={periodMode} month={selectedMonth} months={months} fromDate={fromDate} toDate={toDate} onModeChange={(mode) => { setPeriodMode(mode); if (mode === "month") setAppliedRange({ mode, month: selectedMonth }); }} onMonthChange={(month) => { setSelectedMonth(month); if (periodMode === "month") setAppliedRange({ mode: "month", month }); }} onFromChange={setFromDate} onToChange={setToDate} onApply={() => { try { setAppliedRange(normalizeDateRange({ mode: "custom", fromDate, toDate })); setToast("تم تطبيق الفترة المخصصة"); } catch (e) { setToast(e.message); } }} canStartNewMonth={can("monthly_periods.close")} onStartNewMonth={() => setShowNewMonth(true)} />
            <div className="date">
              <CalendarDays size={17} />
              <span>
                {new Intl.DateTimeFormat("ar-IQ", { dateStyle: "full" }).format(
                  new Date(),
                )}
              </span>
              <span className={`global-period-status ${isSelectedMonthClosed ? "closed" : "open"}`} title={isSelectedMonthClosed ? "هذا الشهر مغلق. أعد فتح الشهر أولاً للتعديل." : "الفترة المالية مفتوحة"}>{isSelectedMonthClosed ? "🔒 مغلق" : "● مفتوح"}</span>
            </div>
            <div className="notification-menu">
            <button className="icon-btn" aria-label="الإشعارات" aria-expanded={notificationOpen} onClick={() => setNotificationOpen((value) => !value)}>
              <Bell size={19} />
              {unreadNotifications.length > 0 && <i>{unreadNotifications.length > 99 ? "99+" : unreadNotifications.length}</i>}
            </button>
            {notificationOpen && <div className="notification-popover" role="dialog" aria-label="الإشعارات"><div className="notification-popover-head"><strong>الإشعارات</strong>{unreadNotifications.length > 0 && <button className="text-btn" onClick={() => setReadNotificationIds(notifications.map((item) => item.id))}>تحديد الكل كمقروء</button>}</div>{notifications.length ? <div className="notification-list">{notifications.map((item) => <article key={item.id} className={`notification-row ${readNotificationIds.includes(item.id) ? "read" : "unread"}`}><button className="notification-open" onClick={() => openNotification(item)}><strong>{item.title}</strong><span>{item.message}</span><small>{item.timestamp ? new Intl.DateTimeFormat("ar-IQ", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.timestamp)) : "تنبيه مباشر"}</small></button>{!readNotificationIds.includes(item.id) && <button className="notification-mark" title="تحديد كمقروء" onClick={() => markNotificationRead(item.id)}>✓</button>}</article>)}</div> : <Empty text="لا توجد إشعارات مهمة" />}</div>}
            </div>
            <div className="top-user">
              <strong>{session.user.name || "مستخدم النظام"}</strong>
              <span>{roleLabel(session.user.role)}</span>
            </div>
          </div>
        </header>
        <div className="page-head">
          <div>
            <p className="eyebrow">101 COFFEE FINANCE</p>
            <h1>{title}</h1>
            <p className="muted">إدارة يومية أوضح لعمليات المقهى ونتائجه.</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
            {(canStartAction || isSelectedMonthClosed) && <button
              className="primary"
              disabled={isSelectedMonthClosed}
              title={isSelectedMonthClosed ? "الشهر المحدد مغلق — انتقل إلى شهر مفتوح لإضافة عملية جديدة" : ""}
              onClick={() => {
                if (active === "dashboard") {
                  setActive("sales");
                  return;
                }
                document.dispatchEvent(new CustomEvent("app:new-action", { detail: active }));
              }}
            >
              <Plus size={18} /> عملية جديدة
            </button>}
            {isSelectedMonthClosed && <small style={{ color: '#a83235', fontSize: '11px', marginTop: '2px' }}>الشهر المحدد مغلق — انتقل إلى شهر مفتوح لإضافة عملية جديدة</small>}
          </div>
        </div>
        <Screen active={active} setToast={setToast} can={can} canPage={canPage} selectedMonth={selectedMonth} months={months} onMonthChange={setSelectedMonth} reportRange={appliedRange} isMonthClosed={isSelectedMonthClosed} periodStatus={periodStatus} isSuperAdmin={session.user.role === "super_admin"} canSeeSensitiveFinancial={["super_admin", "supervisor"].includes(session.user.role) || can("financial.view_payroll_cost") || can("financial.view_net_profit")} alertTarget={alertTarget} onMonthClosed={onMonthClosed} />
        <LegacyLinkHost setToast={setToast} />
      </main>
      {showNewMonth && (
        <NewMonthModal
          selectedMonth={selectedMonth}
          months={months}
          onClose={() => setShowNewMonth(false)}
          onDone={(newMonth) => {
            setShowNewMonth(false);
            if (!months.includes(newMonth)) setMonths([...months, newMonth].sort().reverse());
            setSelectedMonth(newMonth);
            setAppliedRange({ mode: "month", month: newMonth });
          }}
          setToast={setToast}
        />
      )}
      {toast && (
        <div className="toast">
          <Sparkles size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
function MonthSelector({ value, months, onChange }) {
  return <label className="month-selector"><CalendarDays size={16} /><span>الفترة المالية</span><select aria-label="الفترة المالية" value={value} onChange={(e) => onChange(e.target.value)}><option value={currentMonth()}>هذا الشهر — {monthLabel(currentMonth())}</option><option value={previousMonth(currentMonth())}>الشهر السابق — {monthLabel(previousMonth(currentMonth()))}</option>{months.filter((month) => month !== currentMonth() && month !== previousMonth(currentMonth())).map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}<option value="all">جميع الأشهر</option></select></label>;
}
function PeriodSelector({ mode, month, months, fromDate, toDate, onModeChange, onMonthChange, onFromChange, onToChange, onApply, canStartNewMonth, onStartNewMonth }) {
  return <div className="period-selector"><label className="month-selector"><CalendarDays size={16} /><span>نوع الفترة</span><select aria-label="نوع الفترة" value={mode} onChange={(e) => onModeChange(e.target.value)}><option value="month">شهر كامل</option><option value="custom">فترة مخصصة</option></select></label>{mode === "month" ? <div style={{display: 'flex', gap: '8px', alignItems: 'flex-end'}}><MonthSelector value={month} months={months} onChange={onMonthChange} />{canStartNewMonth && <button className="secondary" style={{whiteSpace: 'nowrap', height: '38px', padding: '0 12px'}} onClick={onStartNewMonth}>+ بدء شهر جديد</button>}</div> : <div className="custom-range-controls"><label><span>من</span><input aria-label="من تاريخ" type="date" value={fromDate} onChange={(e) => onFromChange(e.target.value)} /></label><label><span>إلى</span><input aria-label="إلى تاريخ" type="date" value={toDate} onChange={(e) => onToChange(e.target.value)} /></label><button className="secondary" onClick={onApply}>تطبيق الفترة</button></div>}</div>;
}
function Login({ onLogin }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  return (
    <div className="login-page">
      <div className="login-card">
        <img
          className="login-logo"
          src="/assets/logo.jpg"
          alt="101 COFFEE HOUSE"
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
        <div className="brand-lockup">
          <strong>101 COFFEE</strong>
          <span>Finance System</span>
        </div>
        <h1>مرحباً بك من جديد</h1>
        <p>سجّل الدخول لإدارة عمليات 101 COFFEE المالية.</p>
        {error && <div className="error">{error}</div>}
        <button
          className="primary login-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              onLogin(await api.login());
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "جارٍ تسجيل الدخول..." : "تسجيل الدخول بواسطة Google"}
        </button>
        {localQa && <form className="local-qa-login" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(""); try { onLogin(await api.loginLocal(email, password)); } catch (e) { setError(e.message); } finally { setBusy(false); } }}>
          <strong>اختبار محلي فقط</strong>
          <input type="email" required autoComplete="username" placeholder="بريد مستخدم المحاكي" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="password" required autoComplete="current-password" placeholder="كلمة مرور المحاكي" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="secondary login-btn" disabled={busy}>{busy ? "جارٍ التحقق..." : "دخول اختبار محلي"}</button>
        </form>}
        <small>الوصول محمي بواسطة Firebase Authentication</small>
      </div>
    </div>
  );
}

function PartnersPage({ setToast }) {
  const [data, setData] = useState({ partners: [], payments: [], agreed: 0, paid: 0, remaining: 0 });
  const [partner, setPartner] = useState({ name: '', agreed_capital: '', notes: '' });
  const [payment, setPayment] = useState({ partner_id: '', amount: '', date: today(), payment_method: 'cash', notes: '' });
  const load = () => api.listPartnerCapital().then(setData).catch((e) => setToast(userFacingError(e)));
  useEffect(load, []);
  const savePartner = async (event) => { event.preventDefault(); try { await api.savePartner(partner); setPartner({ name: '', agreed_capital: '', notes: '' }); await load(); setToast('تم حفظ بيانات الشريك'); } catch (e) { setToast(userFacingError(e)); } };
  const addPayment = async (event) => { event.preventDefault(); try { await api.addPartnerPayment(payment); setPayment({ ...payment, amount: '', notes: '' }); await load(); setToast('تمت إضافة دفعة رأس المال دون استبدال السابق'); } catch (e) { setToast(userFacingError(e)); } };
  return <div className="screen-stack">
    <Panel title="الشركاء ورأس المال" action="إدارة مستقلة — السوبر أدمن فقط"><div className="report-summary-grid">{[['إجمالي رأس المال المتفق عليه', data.agreed], ['المستلم فعلياً', data.paid], ['المتبقي', data.remaining]].map(([label, value]) => <div className="report-summary-card" key={label}><span>{label}</span><strong>{money(value)}</strong></div>)}</div>
      <form className="smart-form" onSubmit={savePartner}><label><span>اسم الشريك</span><input required value={partner.name} onChange={(e) => setPartner({ ...partner, name: e.target.value })} /></label><label><span>رأس المال المتفق عليه</span><input required type="number" min="0" value={partner.agreed_capital} onChange={(e) => setPartner({ ...partner, agreed_capital: e.target.value })} /></label><label><span>ملاحظات</span><input value={partner.notes} onChange={(e) => setPartner({ ...partner, notes: e.target.value })} /></label><button className="primary">إضافة / حفظ الشريك</button></form>
      <DataTable rows={data.partners} columns={[["name", "الشريك"],["agreed_capital", "المتفق عليه", money],["paid_capital", "المدفوع", money],["remaining_capital", "المتبقي", money]]} />
    </Panel>
    <Panel title="إضافة دفعة شريك" action="كل دفعة تحفظ كسجل مستقل وتؤثر على وسيلة الدفع دون إيراد"><form className="smart-form"><SelectField label="الشريك" value={payment.partner_id} onChange={(v) => setPayment({ ...payment, partner_id: v })}><option value="">اختر الشريك</option>{data.partners.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</SelectField><label><span>المبلغ</span><input required type="number" min="0.01" value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} /></label><label><span>التاريخ</span><input required type="date" value={payment.date} onChange={(e) => setPayment({ ...payment, date: e.target.value })} /></label><SelectField label="طريقة الدفع" value={payment.payment_method} onChange={(v) => setPayment({ ...payment, payment_method: v })}>{PAYMENT_METHODS.filter(([key]) => key !== 'credit').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</SelectField><label className="wide"><span>ملاحظات</span><input value={payment.notes} onChange={(e) => setPayment({ ...payment, notes: e.target.value })} /></label><button className="primary wide" onClick={addPayment}>تسجيل الدفعة</button></form><DataTable rows={data.payments} columns={[["date", "التاريخ"],["partner_name", "الشريك"],["amount", "المبلغ", money],["payment_method", "طريقة الدفع", paymentMethodLabel],["notes", "الملاحظات"],["created_by", "أضيف بواسطة"]]} /></Panel>
  </div>;
}

function EstablishmentPage({ setToast }) {
  const [data, setData] = useState({ costs: [], categories: [], report: { total: 0, paid: 0, remaining: 0, byCategory: [], capital: {} } });
  const [form, setForm] = useState({ amount: '', paid_amount: '', date: today(), category_id: '', description: '', payment_method: 'cash', linked_source_type: '', linked_source_id: '', notes: '' });
  const [category, setCategory] = useState('');
  const load = () => api.listEstablishmentCosts().then(setData).catch((e) => setToast(userFacingError(e)));
  useEffect(load, []);
  const save = async (event) => { event.preventDefault(); try { await api.addEstablishmentCost(form); setForm({ ...form, amount: '', paid_amount: '', description: '', notes: '' }); await load(); setToast('تم تسجيل تكلفة التأسيس'); } catch (e) { setToast(userFacingError(e)); } };
  const saveCategory = async (event) => { event.preventDefault(); try { await api.saveEstablishmentCategory({ name: category }); setCategory(''); await load(); setToast('تمت إضافة التصنيف'); } catch (e) { setToast(userFacingError(e)); } };
  const renameCategory = async (row) => { const name = window.prompt('اسم التصنيف الجديد:', row.name || ''); if (!name?.trim()) return; try { await api.saveEstablishmentCategory({ id: row.id, name: name.trim(), active: row.active !== false }); await load(); setToast('تم تعديل التصنيف'); } catch (e) { setToast(userFacingError(e)); } };
  const editCost = async (row) => { const description = window.prompt('الوصف:', row.description || ''); if (description == null) return; const paid = window.prompt('المبلغ المدفوع فعلياً:', String(row.paid_amount ?? 0)); if (paid == null) return; try { await api.updateEstablishmentCost(row.id, { description: description.trim(), paid_amount: Number(paid) }); await load(); setToast('تم تعديل تكلفة التأسيس وتحديث أثر الصندوق'); } catch (e) { setToast(userFacingError(e)); } };
  const report = data.report || {};
  return <div className="screen-stack"><Panel title="تكلفة افتتاح 101 COFFEE" action="التأسيس منفصل عن التشغيل ولا يدخل في نتيجة الأشهر"><div className="report-summary-grid">{[['إجمالي تكاليف التأسيس', report.total], ['المدفوع فعلياً', report.paid], ['التزامات غير مسددة', report.remaining], ['رأس المال المتفق عليه', report.capital?.agreed], ['المستلم من الشركاء', report.capital?.paid], ['المتبقي على الشركاء', report.capital?.remaining]].map(([label, value]) => <div className="report-summary-card" key={label}><span>{label}</span><strong>{money(value)}</strong></div>)}</div><div className="category-grid">{(report.byCategory || []).map((row) => <article className="category-card" key={row.category}><span>{row.category}</span><strong>{money(row.total)}</strong><small>مدفوع {money(row.paid)} · متبقٍ {money(row.remaining)}</small></article>)}</div></Panel>
    <Panel title="إضافة تكلفة تأسيس" action="لمنع التكرار: اربط العملية القديمة بدلاً من تسجيل دفع نقدي جديد"><form className="smart-form" onSubmit={save}><label><span>المبلغ الإجمالي</span><input required type="number" min="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label><label><span>المدفوع فعلياً</span><input type="number" min="0" value={form.paid_amount} placeholder="كامل المبلغ افتراضياً" onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} /></label><label><span>التاريخ</span><input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label><SelectField label="التصنيف" value={form.category_id} onChange={(v) => setForm({ ...form, category_id: v })}><option value="">تكاليف تأسيس أخرى</option>{data.categories.filter((x) => x.active !== false).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectField><label><span>الوصف</span><input required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label><SelectField label="طريقة الدفع" value={form.payment_method} onChange={(v) => setForm({ ...form, payment_method: v })}>{PAYMENT_METHODS.filter(([key]) => key !== 'credit').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</SelectField><SelectField label="نوع المصدر المرتبط (اختياري)" value={form.linked_source_type} onChange={(v) => setForm({ ...form, linked_source_type: v })}><option value="">لا يوجد</option><option value="purchases">مشتريات</option><option value="purchase_invoices">فاتورة شراء</option><option value="expenses">مصروفات</option><option value="assets">أصول</option></SelectField><label><span>معرّف المصدر المرتبط</span><input placeholder="اتركه فارغاً إذا لم توجد عملية سابقة" value={form.linked_source_id} onChange={(e) => setForm({ ...form, linked_source_id: e.target.value })} /></label><label><span>ملاحظات / مرفق</span><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label><button className="primary wide">تسجيل تكلفة التأسيس</button></form></Panel>
    <Panel title="تصنيفات التأسيس" action="يمكن إضافة تصنيفات غير محدودة"><form className="smart-form"><label><span>تصنيف جديد</span><input required value={category} onChange={(e) => setCategory(e.target.value)} /></label><button className="secondary" onClick={saveCategory}>إضافة التصنيف</button></form><DataTable rows={data.categories} columns={[["name", "التصنيف"],["active", "الحالة", (v) => v === false ? 'مؤرشف' : 'فعال']]} rowActions={(row) => <button className="table-action" onClick={() => renameCategory(row)}>تعديل</button>}/></Panel>
    <Panel title="تفاصيل العمليات"><DataTable rows={data.costs} columns={[["date", "التاريخ"],["category_name", "التصنيف"],["description", "الوصف"],["amount", "الإجمالي", money],["paid_amount", "المدفوع", money],["remaining_amount", "المتبقي", money],["payment_method", "الدفع"],["linked_source_id", "رابط سابق"]]} rowActions={(row) => <button className="table-action" onClick={() => editCost(row)}>تعديل</button>}/></Panel>
  </div>;
}

function SystemResetPage({ setToast }) {
  const [plan, setPlan] = useState(null); const [backup, setBackup] = useState(null); const [confirmation, setConfirmation] = useState(''); const [includeInventory, setIncludeInventory] = useState(false); const [result, setResult] = useState(null); const phrase = 'أوافق على تصفير النظام وبدء حسابات جديدة';
  const prepare = async () => { try { const next = await api.prepareSystemReset(); const json = JSON.stringify(next.snapshot); const parsed = JSON.parse(json); const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json)); const hashText = [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, '0')).join(''); const blob = new Blob([JSON.stringify({ ...next, snapshot: parsed }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `101-coffee-reset-backup-${new Date().toISOString().replaceAll(':', '-')}.json`; a.click(); URL.revokeObjectURL(url); setBackup({ hash: hashText, counts: next.counts, verified: JSON.stringify(parsed) === json }); setPlan(next); setToast('تم إنشاء نسخة JSON والتحقق من قراءتها قبل التصفير'); } catch (e) { setToast(userFacingError(e)); } };
  const execute = async () => { if (!backup?.verified || confirmation !== phrase) return setToast('أكمل النسخة الاحتياطية وعبارة التأكيد أولاً.'); if (!window.confirm('تحذير نهائي: سيؤثر التصفير على جميع الأشهر والبيانات المالية. هل تريد المتابعة؟')) return; try { const done = await api.executeSystemReset({ confirmation, backupHash: backup.hash, backupCounts: backup.counts, includeInventory }); const verify = await api.verifySystemReset({ includeInventory }); setResult({ done, verify }); setToast(verify.passed ? 'تم التصفير والتحقق محلياً على Emulator' : 'اكتمل التنفيذ لكن فشل تحقق واحد'); } catch (e) { setToast(userFacingError(e)); } };
  return <div className="screen-stack"><Panel title="تصفير النظام وبدء حسابات جديدة" action="السوبر أدمن فقط — محلياً على Emulator فقط"><div className="notice"><strong>لا يتم حذف المستخدمين أو الصلاحيات أو المنتجات أو الوصفات.</strong><span>سيتم حذف السجلات المالية والحركات السابقة، وتصفير الصندوق، وتصفير المخزون فقط إذا فعّلت الخيار أدناه.</span></div><button className="secondary" onClick={prepare}>1) إنشاء نسخة احتياطية JSON ومعاينة الأعداد</button>{plan && <div className="table-wrap"><table><thead><tr><th>القسم</th><th>عدد السجلات</th></tr></thead><tbody>{Object.entries(plan.counts).map(([key, value]) => <tr key={key}><td>{key}</td><td>{value}</td></tr>)}</tbody></table></div>}<label className="checkbox-label"><input type="checkbox" checked={includeInventory} onChange={(e) => setIncludeInventory(e.target.checked)} /><span>أؤكد تصفير كميات المخزون مع بقاء تعريف المواد والمنتجات</span></label><label><span>اكتب عبارة التأكيد حرفياً</span><input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder={phrase} /></label><button className="primary" disabled={!backup?.verified || confirmation !== phrase} onClick={execute}>2) تنفيذ التصفير المحلي</button>{result && <div className="notice"><strong>{result.verify.passed ? 'PASS' : 'FAIL'} — تحقق ما بعد التصفير</strong><span>{Object.entries(result.verify.checks).filter(([, value]) => !value).map(([key]) => key).join('، ') || 'جميع المسارات المستهدفة فارغة والقيم صفرية'}</span></div>}</Panel></div>;
}

function Screen({ active, canPage, ...p }) {
  if (!canPage(active)) return <AccessDenied />;
  const map = {
    dashboard: Dashboard,
    today: TodayPage,
    alerts: AlertsPage,
    payment_review: PaymentReviewPage,
    shifts: ShiftsPage,
    account_review: AccountReviewPage,
    purchases: Purchases,
    sales: Sales,
    products: Products,
    categories: Categories,
    inventory: Inventory,
    expenses: Expenses,
    other_income: OtherIncome,
    employees: Employees,
    payroll: Payroll,
    assets: Assets,
    suppliers: Suppliers,
    debts: Debts,
    cash: Cash,
    partners: PartnersPage,
    establishment: EstablishmentPage,
    reports: Reports,
    imports: Imports,
    users: UsersPage,
    settings: SettingsPage,
    system_reset: SystemResetPage,
  };
  const C = map[active] || Dashboard;
  return <C {...p} canPage={canPage} />;
}
function AccessDenied() {
  return <div className="empty"><ShieldCheck size={25} /><strong>لا تملك صلاحية عرض هذه الصفحة</strong><span>اطلب من مدير النظام منحك الصلاحية المناسبة.</span></div>;
}

function TodayPage({ selectedMonth, can = () => false }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    const stop = api.subscribeDashboardData(selectedMonth, (x) => live && setData(x), () => live && setData({ metrics: {} }));
    return () => { live = false; if (typeof stop === "function") stop(); };
  }, [selectedMonth]);
  const m = data?.metrics || {};
  const cards = [["الوارد اليوم", m.todaySales], ["النقدي اليوم", m.todayCashSales], ["الإلكتروني اليوم", m.todayElectronicSales], ["عدد عمليات البيع", m.todaySalesCount], ["مشتريات اليوم", m.todayPurchases], ["مصروفات اليوم", m.todayExpenses], ["رصيد الصندوق المتوقع", m.todayExpectedCash], ["أفضل منتج اليوم", m.todayBestProduct || "لا توجد مبيعات اليوم"], ["العمليات التي تحتاج مراجعة", m.todayReviewCount]];
  const visible = cards.filter(([label]) => can("financial.view_revenue") || label === "عدد عمليات البيع");
  return <div className="screen-stack"><Panel title="اليوم في 101" action="ملخص تشغيلي محدث تلقائياً">{data === null ? <LoadingBlock /> : <><div className="report-summary-grid">{visible.map(([label, value]) => <div className="report-summary-card" key={label}><span>{label}</span><strong>{["عدد عمليات البيع", "العمليات التي تحتاج مراجعة"].includes(label) ? Number(value || 0).toLocaleString("ar-IQ") : label === "أفضل منتج اليوم" ? value : money(value)}</strong></div>)}</div>{!m.todaySalesCount && <Empty text="لا توجد عمليات بيع اليوم" />}</>}</Panel><Panel title="تنبيهات اليوم"><div className="notice">{Number(m.todayReviewCount || 0) ? `توجد ${Number(m.todayReviewCount).toLocaleString("ar-IQ")} عمليات تحتاج مراجعة.` : "لا توجد تنبيهات مهمة"}</div></Panel></div>;
}

const reviewLabels = { missing_payment: "طريقة دفع مفقودة", negative_inventory: "مخزون سالب", orphan_cash: "حركة صندوق بلا مصدر", payment_over_debt: "دفع أكبر من الدين", incomplete_payroll: "حالة راتب غير مكتملة", shift_discrepancy: "فرق وردية", pending_inventory: "استرداد مخزون معلّق" };
const reviewActions = { missing_payment: "تحديد طريقة الدفع", negative_inventory: "فتح حركة المخزون", orphan_cash: "مراجعة أثر الحركة", payment_over_debt: "مراجعة التسديد", incomplete_payroll: "إكمال كشف الراتب", shift_discrepancy: "مراجعة الوردية", pending_inventory: "إتمام الاسترداد" };

function AlertsPage({ selectedMonth }) {
  const [rows, setRows] = useState([]);
  useEffect(() => api.subscribeSystemNotifications({ month: selectedMonth, onData: setRows, onError: () => setRows([]) }), [selectedMonth]);
  const label = { urgent: "عاجل", followup: "يحتاج متابعة", info: "معلومات" };
  return <div className="screen-stack"><Panel title="مركز التنبيهات" action="تنبيهات مشتقة من البيانات الفعلية ولا تتكرر عند إعادة الاتصال"><div className="alert-groups">{["urgent", "followup", "info"].map((severity) => <section className={`alert-group alert-${severity}`} key={severity}><h3>{label[severity]}</h3>{rows.filter((row) => (row.severity || "info") === severity).map((row) => <div className="alert-item" key={row.id}><span className="alert-icon"><Bell size={15} /></span><div><strong>{row.title}</strong><small>{row.message} · {row.timestamp || "تنبيه مباشر"}</small></div></div>)}{!rows.some((row) => (row.severity || "info") === severity) && <p className="muted">لا توجد تنبيهات</p>}</section>)}</div></Panel></div>;
}

function AccountReviewPage({ selectedMonth }) { const [rows, setRows] = useState([]); useEffect(() => { api.accountReview(selectedMonth).then(setRows).catch(() => setRows([])); }, [selectedMonth]); return <div className="screen-stack"><Panel title="مراجعة الحسابات" action="قراءة فقط — لا يتم التصحيح تلقائياً"><DataTable rows={rows} columns={[["type", "النوع", (v) => reviewLabels[v] || "مراجعة تشغيلية"], ["date", "التاريخ"], ["source", "رقم العملية", (v, r) => operationReference({ ...r, id: r.operation_id || r.source_id || String(v || "").split("/").pop() }, referencePrefix[r.entity] || "OP")], ["amount", "المبلغ / الحالة", (v) => v == null ? "—" : money(v)], ["status", "سبب المراجعة"], ["action", "الإجراء المقترح", (v, r) => reviewActions[r.type] || v || "مراجعة التفاصيل"]]} /></Panel></div>; }

function PaymentReviewPage({ selectedMonth, can = () => false, setToast }) {
  const [rows, setRows] = useState([]), [busy, setBusy] = useState(""), [correction, setCorrection] = useState(null), [reason, setReason] = useState("");
  const load = () => api.list("sales").then((x) => setRows(x.filter((row) => !row.deleted && !row.payment_method && (!selectedMonth || getRecordMonth(row) === selectedMonth)))).catch(() => setRows([]));
  useEffect(() => { load(); }, [selectedMonth]);
  const openCorrection = (row, method) => { setReason(""); setCorrection({ row, method }); };
  const correct = async (event) => { event.preventDefault(); if (!correction || !reason.trim()) return; const { row, method } = correction; setBusy(row.id); try { await api.reviewPayment({ saleId: row.id, paymentMethod: method, reason: reason.trim() }); const actor = (await api.session().catch(() => null))?.user?.name || "المستخدم الحالي"; const completedAt = new Intl.DateTimeFormat("ar-IQ", { dateStyle: "short", timeStyle: "short" }).format(new Date()); setToast?.(`تم تصحيح طريقة الدفع للعملية ${operationReference(row, "SALE")} — السبب: ${reason.trim()} — المستخدم: ${actor} — ${completedAt}`); setCorrection(null); load(); } catch (e) { setToast?.(userFacingError(e, "تعذر تصحيح طريقة الدفع.")); } finally { setBusy(""); } };
  const actionButtons = (row) => can("payment_review.edit") && <><button className="table-action" disabled={busy === row.id} onClick={() => openCorrection(row, "cash")}>نقدي</button><button className="table-action" disabled={busy === row.id} onClick={() => openCorrection(row, "electronic")}>إلكتروني</button></>;
  return <div className="screen-stack"><Panel title="مراجعة طرق الدفع" action="المبيعات غير المصنفة تبقى ضمن الوارد الكلي ولا تُحتسب نقداً أو إلكترونياً"><div className="payment-review-mobile-cards">{rows.map((row) => <article className="payment-review-card" key={row.id}><div className="payment-review-head"><strong>{operationReference(row, "SALE")}</strong><span>تحتاج مراجعة</span></div><p><b>التاريخ:</b> {row.date || "—"}</p><p><b>المنتج:</b> {row.product_name || "—"}</p><p><b>المبلغ:</b> {money(row.total_after_discount)}</p><div className="payment-review-actions">{actionButtons(row)}</div></article>)}</div><div className="payment-review-table"><DataTable rows={rows} columns={[["id", "رقم العملية", (v, r) => operationReference(r, "SALE")], ["date", "التاريخ"], ["product_name", "المنتج"], ["total_after_discount", "المبلغ", (v) => money(v)], ["payment_method", "التصنيف الحالي", () => "تحتاج مراجعة"]]} rowActions={(row) => <span className="toolbar">{actionButtons(row)}</span>} /></div></Panel>{correction && <Modal title={`تصحيح طريقة الدفع — ${operationReference(correction.row, "SALE")}`} onClose={() => setCorrection(null)}><form className="smart-form payment-correction-form" onSubmit={correct}><div className="notice wide">سيتم التصحيح إلى: <strong>{correction.method === "cash" ? "نقدي" : "إلكتروني"}</strong>. لا يتم حفظ التصحيح دون سبب.</div><label className="wide"><span>سبب التصحيح</span><textarea required autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="اذكر سبب مراجعة العملية وتصحيح طريقة الدفع" /></label><div className="payment-review-actions wide"><button type="button" className="secondary" onClick={() => setCorrection(null)}>إلغاء</button><button className="primary" disabled={busy === correction.row.id}>حفظ التصحيح</button></div></form></Modal>}</div>;
}

function ShiftsPage({ selectedMonth, can = () => false, setToast }) {
  const [rows, setRows] = useState([]), [form, setForm] = useState({ opening_cash: "", note: "" }), [selected, setSelected] = useState(null), [counts, setCounts] = useState({});
  const load = () => api.list("cashier_shifts").then(setRows).catch(() => setRows([])); useEffect(() => { load(); }, [selectedMonth]);
  const open = async (e) => { e.preventDefault(); try { await api.openCashierShift({ ...form, month: selectedMonth }); setForm({ opening_cash: "", note: "" }); load(); setToast?.("تم فتح الوردية"); } catch (e) { setToast?.(e.message); } };
  const actualCash = [50000, 25000, 10000, 5000, 1000, 500, 250].reduce((sum, denomination) => sum + denomination * Number(counts[denomination] || 0), 0);
  const expectedCash = Number(selected?.expected_cash || 0);
  const difference = actualCash - expectedCash;
  const close = async (event) => { event.preventDefault(); try { const result = await api.closeCashierShift({ shift_id: selected.id, denomination_counts: counts, explanation: "" }); const amount = Math.abs(Number(result.difference ?? difference)).toLocaleString("en-US"); const label = Number(result.difference ?? difference) === 0 ? "مطابق" : Number(result.difference ?? difference) < 0 ? `عجز ${amount} د.ع` : `زيادة ${amount} د.ع`; setToast?.(`تم إغلاق الوردية — ${label}`); setSelected(null); setCounts({}); load(); } catch (e) { setToast?.(e.message); } };
  const shiftActions = (row) => row.status === "open" && <button className="table-action" onClick={() => { setCounts({}); setSelected(row); }}>إغلاق وعدّ النقد</button>;
  return <div className="screen-stack"><Panel title="الورديات" action="فتح وإغلاق وردية مع عدّ الفئات النقدية"><form className="smart-form" onSubmit={open}><label><span>الرصيد الافتتاحي</span><input required type="number" min="0" value={form.opening_cash} onChange={e => setForm({ ...form, opening_cash: e.target.value })} /></label><label><span>ملاحظة</span><input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label><button className="primary" disabled={!can("shifts.open")}>فتح وردية</button></form><div className="shift-mobile-cards">{rows.map((row) => <article className="shift-card" key={row.id}><div className="shift-card-head"><strong>{operationReference(row, "SHIFT")}</strong><span className={`status-badge status-${row.status}`}>{row.status === "open" ? "مفتوحة" : "مغلقة"}</span></div><p><b>الكاشير:</b> {row.cashier_name || "—"}</p><p><b>الافتتاح:</b> {money(row.opening_cash)}</p><p><b>المتوقع:</b> {row.expected_cash == null ? "—" : money(row.expected_cash)}</p><p><b>الفرق:</b> {row.difference == null ? "—" : money(row.difference)}</p>{shiftActions(row)}</article>)}</div><div className="shift-table"><DataTable rows={rows} columns={[["id", "رقم العملية", (v, r) => operationReference(r, "SHIFT")], ["cashier_name", "الكاشير"], ["opened_at", "فُتحت"], ["opening_cash", "الافتتاح", money], ["expected_cash", "المتوقع", (v) => v == null ? "—" : money(v)], ["status", "الحالة", v => v === "open" ? "مفتوحة" : "مغلقة"], ["difference", "الفرق", v => v == null ? "—" : money(v)]]} rowActions={shiftActions} /></div></Panel>{selected && <Modal title="إغلاق الوردية" onClose={() => setSelected(null)}><form className="smart-form shift-close-form" onSubmit={close}><div className="shift-close-summary wide"><div><span>المتوقع</span><strong>{money(expectedCash)}</strong></div><div><span>الفعلي</span><strong>{money(actualCash)}</strong></div><div className={difference < 0 ? "negative" : difference > 0 ? "positive" : "neutral"}><span>الفرق</span><strong>{difference === 0 ? "مطابق" : difference < 0 ? `عجز ${Math.abs(difference).toLocaleString("en-US")} د.ع` : `زيادة ${difference.toLocaleString("en-US")} د.ع`}</strong></div></div>{[50000, 25000, 10000, 5000, 1000, 500, 250].map((d) => <label key={d}><span>{money(d)} — عدد القطع</span><input type="number" min="0" inputMode="numeric" value={counts[d] || ""} onChange={e => setCounts({ ...counts, [d]: e.target.value })} /></label>)}<button className="primary wide" type="submit">اعتماد الإغلاق</button></form></Modal>}</div>;
}
function Dashboard({ setToast, can, canPage, selectedMonth, reportRange = { mode: "month", month: selectedMonth }, isMonthClosed, periodStatus, isSuperAdmin = false, canSeeSensitiveFinancial = false, onMonthClosed }) {
  const [data, setData] = useState(null),
    [pins, setPins] = useState([]),
    [comparisonData, setComparisonData] = useState(null),
    [legacyPayrollModal, setLegacyPayrollModal] = useState(false);
  useEffect(() => {
    let mounted = true;
    if (reportRange?.mode === "custom") {
      api.reportRange(reportRange).then((report) => {
        if (!mounted) return;
        const rows = aggregateFinancialTimeline({ sales: report.rows?.sales || [], purchases: report.rows?.purchases || [], fromDate: reportRange.fromDate, toDate: reportRange.toDate });
        setData({ metrics: { revenue: report.summary?.netSales, purchases: report.summary?.purchases, expenses: report.summary?.expenses, netProfitBeforePayroll: report.summary?.netResult, netProfitAfterPayroll: report.summary?.netResult, canSeeRevenue: true, todaySalesCount: 0, operationCount: rows.reduce((n, x) => n + x.salesCount + x.purchaseCount, 0) }, monthly: rows, expenseByCategory: [], recent: [] });
      }).catch(() => mounted && setData({ metrics: {}, monthly: [], expenseByCategory: [], recent: [] }));
      return () => { mounted = false; };
    }
    api.dashboardPins().then((p) => { if (mounted) setPins(p || []); }).catch(() => { if (mounted) setPins([]); });
    const unsubscribe = api.subscribeDashboardData(
      selectedMonth,
      (nextData) => { if (mounted) setData(nextData); },
      () => {
        if (mounted) setData({ metrics: {}, monthly: [], expenseByCategory: [], recent: [] });
      },
    );
    return () => { mounted = false; if (typeof unsubscribe === "function") unsubscribe(); };
  }, [selectedMonth, reportRange?.mode, reportRange?.fromDate, reportRange?.toDate]);
  useEffect(() => {
    let mounted = true;
    if (reportRange?.mode === "custom") { setComparisonData(null); return () => { mounted = false; }; }
    api.dashboard(previousMonth(selectedMonth)).then((previous) => {
      if (!mounted) return;
      const current = data?.metrics || {};
      const currentSalesCount = (data?.monthly || []).reduce((n, row) => n + Number(row.salesCount || 0), 0);
      const previousSalesCount = (previous?.monthly || []).reduce((n, row) => n + Number(row.salesCount || 0), 0);
      setComparisonData(buildPeriodComparison({ current: { revenue: current.revenue, purchases: current.purchases, expenses: current.expenses, profitBeforePayroll: current.netProfitBeforePayroll, profitAfterPayroll: current.netProfitAfterPayroll, salesCount: currentSalesCount, averageSale: currentSalesCount ? Number(current.revenue || 0) / currentSalesCount : null }, previous: { revenue: previous?.metrics?.revenue, purchases: previous?.metrics?.purchases, expenses: previous?.metrics?.expenses, profitBeforePayroll: previous?.metrics?.netProfitBeforePayroll, profitAfterPayroll: previous?.metrics?.netProfitAfterPayroll, salesCount: previousSalesCount, averageSale: previousSalesCount ? Number(previous.metrics?.revenue || 0) / previousSalesCount : null } }));
    }).catch(() => mounted && setComparisonData(null));
    return () => { mounted = false; };
  }, [selectedMonth, reportRange?.mode, data]);
  if (!data) return <Loader />;
  const m = data.metrics || {};
  const canSeeRevenue = Boolean(m.canSeeRevenue) && can("financial.view_revenue");
  const comparison = (value) => value == null || !Number.isFinite(Number(value)) ? "بيانات غير كافية" : value === 0 ? "— 0%" : `${value >= 0 ? "↑" : "↓"} ${Math.abs(Number(value)).toFixed(1)}%`;
  const displayMoney = (value) => value == null ? "غير متوفر" : money(value);
  const k = canSeeRevenue ? [
    ["الوارد الكلي", m.revenue, BarChart3, "up", "money", null, "إجمالي المبيعات بعد الخصومات"],
    ["المبيعات النقدية", m.cashSales, WalletCards, "up", "money", null, "المبالغ المستلمة نقدًا من المبيعات خلال الفترة."],
    ["المبيعات الإلكترونية", m.electronicSales, WalletCards, "up", "money", null, "جزء من المبيعات تم استلامه إلكترونياً"],
    ["إجمالي المشتريات", m.purchases, ShoppingCart, "down", "money", m.purchaseComparison, "قيمة المواد والبضاعة المشتراة"],
    ["الإيرادات الأخرى", m.otherIncome, Receipt, "up", "money", null, "دخل غير ناتج من المبيعات اليومية"],
    ["إجمالي المصروفات", m.expenses, Receipt, "down", "money", m.expenseComparison, "مصاريف تشغيل الكوفي باستثناء المشتريات والرواتب"],
    ["صافي النقد", m.cashNet, WalletCards, "up", "money", null, "صافي حركة النقد الفعلية خلال الفترة، دون احتساب العمليات الإلكترونية"],
    ["مبيعات تحتاج مراجعة", m.unclassifiedSales, WalletCards, "down", "money", null, "مبيعات محفوظة بدون طريقة دفع واضحة وتحتاج مراجعة."],
    ["المدفوع النقدي للمشتريات", m.cashPaidPurchases, ShoppingCart, "down", "money", null, "المبالغ النقدية المدفوعة مباشرة عند تسجيل المشتريات خلال الفترة."],
  ] : [
    ["عمليات البيع اليوم", m.todaySalesCount || 0, BarChart3, "up", "count"],
    ["إجمالي العمليات", m.operationCount || 0, ClipboardList, "up", "count"],
    ["الأصناف المسجلة", m.productCount || 0, Package, "up", "count"],
    ["تنبيهات المخزون", 0, Boxes, "up", "count"],
  ];
  const fallbackCategories = [
    ["الحليب", "إدخال / إخراج", Package, "milk"],
    ["العصائر", "إدخال / إخراج", Coffee, "juices"],
    ["مشروبات باردة", "إدخال / إخراج", Coffee, "cold"],
    ["مشروبات ساخنة", "إدخال / إخراج", Coffee, "hot"],
    ["قهوة إيلي", "إدخال / إخراج", Coffee, "illy"],
    ["القهوة المخفقة", "إدخال / إخراج", Coffee, "whipped"],
    ["أدوات", "إدخال / إخراج", Boxes, "tools"],
    ["ماء الشرب", "إدخال / إخراج", Package, "water"],
    ["الإضافات / أخرى", "إدخال / إخراج", Package, "extras"],
    ["الساندويتشات", "إدخال / إخراج", Package, "sandwiches"],
    ["الحلويات", "إدخال / إخراج", Package, "desserts"],
    ["المنظفات", "إدخال / إخراج", Boxes, "cleaning"],
  ];
  const categories = (data.productCategories?.length ? data.productCategories : fallbackCategories).map((x) => Array.isArray(x) ? x : [x.name_ar || x.nameAr || x.name, "منتجات القائمة", Coffee, x.id]);
  const operational = [
    ["مصروفات أخرى", "تشغيلية", Receipt, "expenses"],
    ["الأصول", "المعدات والأجهزة", Building2, "assets"],
    ["رواتب الموظفين", "الرواتب والمستحقات", Users, "payroll"],
    ["صيانة عامة", "خدمات وتشغيل", Settings, "expenses"],
    ["الإنترنت", "خدمات وتشغيل", Settings, "expenses"],
    ["كهرباء", "وطني / مولدة", Zap, "expenses"],
  ];
  const pinCards = [
    ["المبيعات", "آخر نتائج البيع", BarChart3, "sales"],
    ["المشتريات", "الفواتير والتوريد", ShoppingCart, "purchases"],
    ["المصروفات", "مصروفات التشغيل", Receipt, "expenses"],
    ["رواتب الموظفين", "المستحقات الشهرية", Users, "payroll"],
  ];
  const go = (id) =>
    document.dispatchEvent(new CustomEvent("app:navigate", { detail: id }));
  return (
    <div className="screen-stack dashboard-reference">
      <section className="period-banner"><div><strong>الفترة المالية: {monthLabel(selectedMonth)}</strong><span className={isMonthClosed ? "closed" : "open"}>{isMonthClosed ? "مغلقة" : "مفتوحة"}</span></div>{isMonthClosed && can("monthly_periods.reopen") && <div className="period-actions"><button className="secondary" onClick={async () => { const reason = window.prompt("اذكر سبب إعادة فتح الشهر:"); if (!reason?.trim()) return; try { await api.reopenMonth(selectedMonth, reason); setToast("تمت إعادة فتح الشهر"); } catch (e) { setToast(e.message); } }}>إعادة فتح الشهر</button></div>}</section>
      <section className="kpi-grid">
        {k.slice(0, 6).map(([l, v, Icon, state, , , help], i) => (
          <article className={`kpi kpi-ref kpi-${i}`} key={l} title={v == null ? `${help} — غير متوفر` : help}>
            <div className="kpi-copy">
              <span>{l}</span>
              <strong>{state === "up" && k[i]?.[4] === "count" ? Number(v || 0).toLocaleString("ar-IQ") : displayMoney(v)}</strong>
              <small className={state === "down" ? "negative" : ""}>
                {k[i]?.[5] !== undefined && k[i]?.[5] !== null ? comparison(k[i][5]) : `الفترة: ${monthLabel(selectedMonth)}`}
              </small>
            </div>
            <div className="kpi-icon">
              <Icon size={23} />
            </div>
          </article>
        ))}
      </section>
      {canSeeRevenue && <section className="kpi-group kpi-supporting-group"><div className="section-title"><div><h2>مراجعة وتفاصيل مالية</h2></div></div><section className="kpi-grid">{k.slice(6).map(([l, v, Icon, state, , , help], i) => <article className={`kpi kpi-ref kpi-support-${i}`} key={l} title={v == null ? `${help} — غير متوفر` : help}><div className="kpi-copy"><span>{l}</span><strong>{displayMoney(v)}</strong><small className={state === "down" ? "negative" : ""}>الفترة: {monthLabel(selectedMonth)}</small></div><div className="kpi-icon"><Icon size={23} /></div></article>)}</section></section>}
      {canSeeSensitiveFinancial && m.payrollDue == null && <section className="period-banner legacy-payroll-notice"><div><strong>تكلفة الرواتب غير متوفرة</strong><span>توجد بيانات رواتب قديمة لا يمكن تحديد تكلفتها بأمان.</span></div>{isSuperAdmin && !isMonthClosed && <button className="secondary" onClick={() => setLegacyPayrollModal(true)}>إدخال تكلفة الرواتب التاريخية</button>}</section>}
      <section className="section-title">
        <div>
          <h2>الأقسام الرئيسية للمشتريات</h2>
        </div>
        {canPage("categories") && <button className="text-btn" onClick={() => go("categories")}>
          <SlidersHorizontal size={16} /> إدارة الأقسام
        </button>}
      </section>
      {canSeeSensitiveFinancial && <section className="kpi-group payroll-result-group"><div className="section-title"><div><h2>الرواتب والنتيجة</h2></div></div><section className="kpi-grid">{[["تكلفة الرواتب", m.payrollDue, Users, "down", "تكلفة رواتب الموظفين للشهر"], ["صافي المبلغ قبل الرواتب", m.netProfitBeforePayroll, Zap, "up", "الوارد الكلي + الإيرادات الأخرى - المشتريات - المصروفات التشغيلية، قبل احتساب تكلفة الرواتب."], ["صافي المبلغ بعد الرواتب", m.netProfitAfterPayroll, Zap, "up", "صافي المبلغ بعد خصم تكلفة الرواتب."]].map(([l, v, Icon, state, help]) => <article className="kpi kpi-ref" key={l} title={help}><div className="kpi-copy"><span>{l}</span><strong>{displayMoney(v)}</strong><small className={state === "down" ? "negative" : ""}>الفترة: {monthLabel(selectedMonth)}</small></div><div className="kpi-icon"><Icon size={23} /></div></article>)}</section></section>}
      <section className="category-grid">
        {categories.map(([l, d, Icon, id]) => (
          <button
            className="category-card"
            key={id}
            onClick={() => go("inventory")}
          >
            <span className="category-art">
              <Icon size={36} />
            </span>
            <strong>{l}</strong>
            <small>{d}</small>
            <span className="category-action">←</span>
          </button>
        ))}
      </section>
      <section className="ops-layout">
        <div>
          <h2>المصروفات</h2>
          <div className="mini-category-grid">
            {operational.slice(3).filter(([, , , id]) => canPage(id)).map(([l, d, Icon, id]) => (
              <button
                className="mini-category-card"
                key={l}
                onClick={() => go(id)}
              >
                <span>
                  <Icon size={26} />
                </span>
                <strong>{l}</strong>
                <small>{d}</small>
              </button>
            ))}
          </div>
        </div>
        <div>
          <h2>إدارة الأعمال</h2>
          <div className="mini-category-grid">
            {operational.slice(0, 3).filter(([, , , id]) => canPage(id)).map(([l, d, Icon, id]) => (
              <button
                className="mini-category-card"
                key={l}
                onClick={() => go(id)}
              >
                <span>
                  <Icon size={26} />
                </span>
                <strong>{l}</strong>
                <small>{d}</small>
              </button>
            ))}
          </div>
        </div>
      </section>
      <section className="section-title pins-title">
        <div>
          <h2>المربعات المثبتة في الداشبورد</h2>
          <p className="muted">يمكن تثبيت 4 أقسام فقط لكل مستخدم.</p>
        </div>
        <span className="pin-count">{pins.length || 4}/4</span>
      </section>
      <section className="pinned-grid">
        {pinCards.filter(([, , , id]) => canPage(id)).map(([l, d, Icon, id]) => (
          <button className="pinned-card" key={id} onClick={() => go(id)}>
            <span className="module-icon">
              <Icon size={22} />
            </span>
            <span>
              <strong>{l}</strong>
              <small>{d}</small>
            </span>
            <PinMark />
          </button>
        ))}
      </section>
      <section className="analytics-grid analytics-reference">
        {canSeeRevenue && <Panel title="المبيعات خلال آخر 7 أيام">
          <MiniBars data={data.monthly || []} />
        </Panel>}
        {canSeeRevenue && <Panel title="توزيع المشتريات حسب الأقسام">
          <div className="donut-row">
            <div className="donut" />
            <div className="legend">
              {(data.expenseByCategory || []).slice(0, 5).map((x, i) => (
                <span key={i}>
                  <i className={`legend-dot dot-${i}`} />
                  {x.label || x.category || "أخرى"} <b>{x.percent || 0}%</b>
                </span>
              ))}
            </div>
          </div>
        </Panel>}
          <Panel title="المبيعات والمشتريات" action="الوارد الكلي مقابل المشتريات — للفترة المحددة">
            <MiniBars data={data.monthly || []} detailed />
          </Panel>
          <Panel title="مقارنة بالفترة السابقة" action={reportRange?.mode === "custom" ? "عن الفترة السابقة" : "عن الشهر السابق"}>
            <ComparisonGrid data={comparisonData} />
          </Panel>
          <Panel title="آخر العمليات">
          <div className="activity-list">
            {(data.recent || []).length ? (
              data.recent.map((r, i) => (
                <div key={i}>
                  <span className="activity-dot" />
                  <div>
                    <strong>{r.label || r.description || "عملية مالية"}</strong>
                    <small>{r.date || "اليوم"}</small>
                  </div>
                  {canSeeRevenue && <b>{money(r.amount || r.total || 0)}</b>}
                </div>
              ))
            ) : (
              <Empty text="لا توجد عمليات مسجلة بعد" />
            )}
          </div>
        </Panel>
      </section>
      <MonthClosePanel month={selectedMonth} isClosed={isMonthClosed} can={can} setToast={setToast} onMonthClosed={onMonthClosed} />
      {legacyPayrollModal && <Modal title="إدخال تكلفة الرواتب التاريخية" onClose={() => setLegacyPayrollModal(false)}><LegacyPayrollCostForm month={selectedMonth} onDone={async () => { setLegacyPayrollModal(false); setData(await api.dashboard(selectedMonth)); setToast("تم اعتماد تكلفة الرواتب التاريخية"); }} /></Modal>}
    </div>
  );
}
function LegacyPayrollCostForm({ month, onDone }) {
  const [amount, setAmount] = useState(""), [notes, setNotes] = useState(""), [error, setError] = useState("");
  const save = async (event) => {
    event.preventDefault();
    try {
      if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) throw new Error("أدخل مبلغاً أكبر من صفر.");
      if (!window.confirm("سيتم اعتماد هذا المبلغ كإجمالي تكلفة رواتب تاريخية للشهر المحدد، وسيستخدم في حساب صافي المبلغ.")) return;
      await api.saveLegacyPayrollCost({ month, amount, notes });
      onDone();
    } catch (err) { setError(err.message || "تعذر حفظ تكلفة الرواتب التاريخية."); }
  };
  return <form className="smart-form" onSubmit={save}><label><span>الشهر</span><input value={month} readOnly /></label><label><span>إجمالي تكلفة الرواتب</span><input required type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></label><label className="wide"><span>ملاحظات</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>{error && <div className="error wide">{error}</div>}<button className="primary wide"><Check size={17} /> اعتماد تكلفة الرواتب</button></form>;
}
function PinMark() {
  return <span className="pin-mark">⌖</span>;
}
function MiniBars({ data, detailed = false }) {
  const [hovered, setHovered] = useState(null);
  const rows = data.length ? data : [];
  if (!rows.length) return <Empty text="لا توجد بيانات لهذه الفترة" />;
  const max = Math.max(
    ...rows.map((x) => Math.max(Number(x.revenue || x.sales || 0), Number(x.purchases || 0))),
    1,
  );
  return (
    <div className="chart-wrap">
      <div className="chart-legend">
        <span><i className="legend-dot dot-0" />الوارد الكلي</span>
        <span><i className="legend-dot dot-2" />المشتريات</span>
      </div>
      <div className="chart-scroll">
        <div className={`mini-chart ${detailed ? "mini-chart-detailed" : ""}`} role="img" aria-label="المبيعات والمشتريات">
          {(detailed ? rows : rows.slice(-7)).map((x, i) => (
            <div className="bar-col" key={i} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
              <div className="bar-pair">
                <div className="bar revenue-bar" style={{ height: `${Math.max(4, (Number(x.revenue || x.sales || 0) / max) * 100)}%` }} />
                <div className="bar purchases-bar" style={{ height: `${Math.max(4, (Number(x.purchases || 0) / max) * 100)}%` }} />
              </div>{hovered === i && <div className="chart-tooltip"><strong>{x.date || x.day || "—"}</strong><span>الوارد الكلي: {money(x.revenue || x.sales || 0)}</span><span>المشتريات: {money(x.purchases || 0)}</span><span>عدد عمليات البيع: {Number(x.salesCount || 0)}</span><span>عدد عمليات الشراء: {Number(x.purchaseCount || 0)}</span><span>المبيعات النقدية: {money(x.cashSales || 0)}</span><span>المبيعات الإلكترونية: {money(x.electronicSales || 0)}</span><span>تحتاج مراجعة: {Number(x.reviewCount || 0)}</span></div>}
              <small>{detailed ? (x.date || "").slice(5) : (x.day || x.label || "")}</small>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function LoadingBlock() { return <div className="loading-block" aria-label="جار التحميل"><span /><span /><span /></div>; }
function ComparisonGrid({ data }) {
  if (!data) return <div className="empty comparison-empty"><strong>بيانات غير كافية</strong></div>;
  const labels = [["revenue", "الوارد الكلي"], ["purchases", "المشتريات"], ["expenses", "المصروفات"], ["profitBeforePayroll", "صافي المبلغ قبل الرواتب"], ["profitAfterPayroll", "صافي المبلغ بعد الرواتب"], ["salesCount", "عدد عمليات البيع"], ["averageSale", "متوسط قيمة عملية البيع"]];
  return <div className="comparison-grid">{labels.map(([key, label]) => { const item = data[key]; const value = item?.percent; const text = value == null || !Number.isFinite(Number(value)) ? "بيانات غير كافية" : value === 0 ? "— 0%" : `${value > 0 ? "↑" : "↓"} ${Math.abs(Number(value)).toFixed(1)}%`; return <div className="comparison-card" key={key}><span>{label}</span><strong className={value > 0 ? "positive" : value < 0 ? "negative" : "neutral"}>{text}</strong></div>; })}</div>;
}
function NewMonthModal({ selectedMonth, months, onClose, onDone, setToast }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [target, setTarget] = useState(nextMonth(selectedMonth || currentMonth()));

  const start = async (e) => {
    e.preventDefault();
    if (months.includes(target)) {
      setError('الشهر محدد موجود مسبقاً.');
      return;
    }
    setBusy(true);
    try {
      await api.startNewMonth(target, selectedMonth);
      setToast('تم بدء الشهر الجديد بنجاح');
      onDone(target);
    } catch(err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="بدء شهر جديد" onClose={onClose}>
      <form className="smart-form" onSubmit={start}>
        <div className="alert-message warning" style={{marginBottom: '15px'}}>
          <strong>تنبيه:</strong> بدء شهر جديد لن يقوم بإغلاق الشهر السابق تلقائياً. سيتم فقط إنشاء فترة مالية جديدة جاهزة للعمليات.
        </div>
        <label>
          <span>الشهر السابق</span>
          <input value={monthLabel(selectedMonth)} readOnly disabled />
        </label>
        <label>
          <span>الشهر الجديد (YYYY-MM)</span>
          <input required pattern="\d{4}-\d{2}" placeholder="مثال: 2026-10" value={target} onChange={e => {setTarget(e.target.value); setError('');}} />
        </label>
        {error && <div className="error wide">{error}</div>}
        <div className="form-actions wide" style={{marginTop: '15px'}}>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>إلغاء</button>
          <button type="submit" className="primary" disabled={busy || !target}>{busy ? 'جارٍ العمل...' : 'تأكيد وبدء الشهر'}</button>
        </div>
      </form>
    </Modal>
  );
}

function MonthClosePanel({ month, isClosed, can, setToast, onMonthClosed }) {
  const [review, setReview] = useState(null), [cash, setCash] = useState(null), [metrics, setMetrics] = useState({}), [summary, setSummary] = useState({}), [carry, setCarry] = useState(null), [actualCash, setActualCash] = useState(""), [notes, setNotes] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; Promise.all([api.monthCloseReview(month).catch(() => []), api.cashMonthReview(month).catch(() => null), api.dashboard(month).catch(() => null), api.reportRange({ mode: "month", month }).catch(() => null), api.get(`cash_carry_forwards/${month}`).catch(() => null)]).then(([nextReview, nextCash, dashboard, report, nextCarry]) => { if (!live) return; setReview(nextReview || []); setCash(nextCash); setMetrics(dashboard?.metrics || {}); setSummary({ ...(report?.summary || {}), inventoryValue: (report?.rows?.inventory || []).reduce((total, item) => total + Number(inventoryValue(item) || 0), 0) }); setCarry(nextCarry); }); return () => { live = false; }; }, [month]);
  const groups = [["BLOCKING", "يمنع الإغلاق"], ["WARNING", "يحتاج مراجعة"], ["INFO", "معلومات"]];
  const blocking = (review || []).filter((item) => item.severity === "BLOCKING").length;
  const close = async () => { if (blocking || isClosed || !can("monthly_periods.close")) return; if (!window.confirm("سيتم إغلاق الشهر، ترحيل الرصيد النقدي المؤكد، ثم الانتقال إلى الشهر التالي.")) return; setBusy(true); try { const result = await api.closeMonth(month, { actual_counted_cash: actualCash, notes }); onMonthClosed?.(result.next_month); } catch (error) { setToast?.(error.message); } finally { setBusy(false); } };
  const values = [["الوارد الكلي", metrics.revenue ?? summary.netSales], ["المبيعات النقدية", metrics.cashSales], ["المبيعات الإلكترونية", metrics.electronicSales], ["إجمالي المشتريات", metrics.purchases ?? summary.purchases], ["الإيرادات الأخرى", metrics.otherIncome], ["إجمالي المصروفات", metrics.expenses ?? summary.expenses], ["تكلفة الرواتب", metrics.payrollDue], ["صافي المبلغ قبل الرواتب", metrics.netProfitBeforePayroll], ["صافي المبلغ بعد الرواتب", metrics.netProfitAfterPayroll ?? summary.netResult], ["رصيد الصندوق", cash?.expectedClosingCash]];
  return <section className="month-close-layout"><Panel title="مراجعة إغلاق الشهر" action="قائمة تحقق قبل الإغلاق — لا تغيّر قواعد الشهر"><div className="close-groups">{groups.map(([severity, title]) => <div className={`close-group close-${severity.toLowerCase()}`} key={severity}><div className="close-group-head"><strong>{title}</strong><span>{(review || []).filter((item) => item.severity === severity).length}</span></div>{(review || []).filter((item) => item.severity === severity).map((item) => <div className="close-item" key={item.code}><strong>{item.label || item.code}</strong><span>{item.detail || "—"}</span></div>)}{!(review || []).some((item) => item.severity === severity) && <small>لا توجد بنود</small>}</div>)}</div>{!isClosed && <div className="smart-form close-cash-confirm"><label><span>الرصيد النقدي المؤكد للإقفال</span><input required type="number" min="0" placeholder={cash?.expectedClosingCash == null ? "أدخل الرصيد الفعلي" : `المتوقع ${cash.expectedClosingCash}`} value={actualCash} onChange={(event) => setActualCash(event.target.value)} /></label><label><span>ملاحظات مطابقة الصندوق</span><input value={notes} onChange={(event) => setNotes(event.target.value)} /></label></div>}<div className="close-actions"><button className="primary" disabled={busy || blocking > 0 || isClosed || !can("monthly_periods.close") || actualCash === ""} onClick={close}>{isClosed ? "الشهر مغلق" : blocking ? "معالجة البنود المانعة أولاً" : busy ? "جارٍ الإغلاق..." : "تأكيد الإغلاق والترحيل"}</button></div></Panel><Panel title="ملخص الإغلاق"><div className="report-summary-grid close-summary">{values.map(([label, value]) => <div className="report-summary-card" key={label}><span>{label}</span><strong>{value == null ? "—" : money(value)}</strong></div>)}</div><div className="carry-forward-card"><strong>رصيد مرحّل من الشهر السابق</strong>{carry ? <span>{carry.source_month ? `مرحّل من ${monthLabel(carry.source_month)}` : "مرحّل من الشهر السابق"} · {money(carry.carried_amount ?? carry.opening_cash)} · {carry.status === "applied" ? "مطبق" : carry.status || "قيد المراجعة"}</span> : <span>لا يوجد رصيد مرحّل مسجل لهذه الفترة</span>}</div></Panel></section>;
}
function Panel({ title, action, children }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {action && <p className="muted">{action}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}
function CrudPage({
  title,
  subtitle,
  entity,
  columns,
  form,
  setToast,
  action = "إضافة جديد",
  pageId = entity,
  can = () => false,
  selectedMonth,
  contexts = [],
  contextField = "",
  isMonthClosed = false,
}) {
  const [rows, setRows] = useState(null),
    [query, setQuery] = useState(""),
    [context, setContext] = useState(""),
    [show, setShow] = useState(false),
    [editing, setEditing] = useState(null),
    [auditRow, setAuditRow] = useState(null);
  const load = () =>
    api
      .list(entity)
      .then(setRows)
      .catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    const handleNewAction = (event) => {
      if (event.detail !== pageId) return;
      setEditing(null);
      setShow(true);
    };
    document.addEventListener("app:new-action", handleNewAction);
    return () => document.removeEventListener("app:new-action", handleNewAction);
  }, [pageId]);
  const removeRow = async (r) => {
    if (isMonthClosed) { setToast?.("هذا الشهر مغلق. أعد فتح الشهر أولاً للتعديل."); return; }
    const reason = window.prompt("اذكر سبب الإلغاء / الأرشفة:");
    if (!reason?.trim()) return;
    if (
      !window.confirm(
        `تأكيد إلغاء / أرشفة ${operationReference(r, referencePrefix[entity] || "OP")}؟`,
      )
    )
      return;
    try {
      await api.remove(entity, r.id, reason.trim());
      const actor = (await api.session().catch(() => null))?.user?.name || "المستخدم الحالي";
      const completedAt = new Intl.DateTimeFormat("ar-IQ", { dateStyle: "short", timeStyle: "short" }).format(new Date());
      setToast?.(`تم إلغاء / أرشفة العملية ${operationReference(r, referencePrefix[entity] || "OP")} — السبب: ${reason.trim()} — المستخدم: ${actor} — ${completedAt}`);
      load();
    } catch (e) {
      setToast?.(userFacingError(e, "تعذر إلغاء العملية."));
    }
  };
  const entityPermissions = permissionForEntity[entity] || {};
  const canCreate = can(entityPermissions.create);
  const canEdit = can(entityPermissions.edit);
  const canDelete = can(entityPermissions.delete);
  const canExport = can("excel.export");
  const referenceColumns = ["sales", "purchases", "expenses", "cash_movements", "debts", "payroll", "cashier_shifts"].includes(entity) && !columns.some(([, label]) => String(label).includes("رقم العملية") || String(label).includes("رقم الفاتورة"))
    ? [["__operation_reference", "رقم العملية", (_v, row) => operationReference(row, referencePrefix[entity] || "OP")], ...columns]
    : columns;
  return (
    <div className="screen-stack">
      <Panel title={title} action={subtitle}>
        {contexts.length > 0 && <div className="context-strip" aria-label="تصفية حسب القسم"><button className={!context ? "active" : ""} onClick={() => setContext("")}>الكل</button>{contexts.map((item) => <button key={item} className={context === item ? "active" : ""} onClick={() => setContext(item)}>{item}</button>)}</div>}
        <div className="toolbar">
          <div className="table-search">
            <Search size={17} />
            <input placeholder="بحث في السجلات..." value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {canCreate && <button
            className="primary"
            disabled={isMonthClosed}
            title={isMonthClosed ? "هذا الشهر مغلق. أعد فتح الشهر أولاً للتعديل." : ""}
            onClick={() => {
              setEditing(contextField && context ? { [contextField]: context } : null);
              setShow(true);
            }}
          >
            <Plus size={17} />
            {action}
          </button>}
          {canExport && <button className="secondary" onClick={() => api.exportExcel(entity)}>
            <FileSpreadsheet size={17} /> تصدير Excel
          </button>}
        </div>
        <DataTable
          rows={(selectedMonth ? recordsForMonth(rows || [], selectedMonth) : (rows || [])).filter((row) => (!context || String(row[contextField] || row.category || "") === context) && (!query || JSON.stringify(row).toLowerCase().includes(query.toLowerCase())))}
          columns={referenceColumns}
          onEdit={canEdit && !isMonthClosed ? (r) => {
            setEditing(r);
            setShow(true);
          } : undefined}
          onDelete={canDelete ? removeRow : undefined}
          actionsDisabled={isMonthClosed}
          onAudit={can("audit.view") ? setAuditRow : undefined}
        />
      </Panel>
      {show && (
        <Modal
          className={show === "movement" ? "" : "inventory-modal"}
          title={editing?.id ? "تعديل السجل" : action}
          onClose={() => setShow(false)}
        >
          {form?.({
            initial: editing || (selectedMonth && selectedMonth !== "all" ? { date: `${selectedMonth}-01`, month: selectedMonth, ...(contextField && context ? { [contextField]: context } : {}) } : null),
              onDone: (message) => {
              setShow(false);
              load();
              setToast?.(message || (editing?.id ? "تم تحديث السجل" : "تم الحفظ بنجاح"));
            },
          })}
        </Modal>
      )}
      {auditRow && <AuditHistory entity={entity} row={auditRow} onClose={() => setAuditRow(null)} />}
    </div>
  );
}
function AuditHistory({ entity, row, onClose }) {
  const [events, setEvents] = useState(null);
  useEffect(() => { let live = true; api.list("audit").then((items) => { if (live) setEvents(items.filter((item) => item.entity === entity && String(item.entity_id) === String(row.id)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))); }).catch(() => live && setEvents([])); return () => { live = false; }; }, [entity, row.id]);
 return <Modal title={`سجل التعديلات — ${operationReference(row, referencePrefix[entity] || "OP")}`} onClose={onClose}><div className="audit-history"><div className="notice"><strong>عكس العملية</strong><span>عكس هذه العملية غير متاح حاليًا</span></div>{events === null ? <LoadingBlock /> : events.length ? events.map((event) => { let value = {}; try { value = JSON.parse(event.new_value || "{}"); } catch { value = {}; } const before = value.before, after = value.after; return <article className="audit-event" key={event.id}><strong>{auditActionLabel[event.action] || "إجراء تشغيلي"}</strong><span>رقم العملية: {operationReference(row, referencePrefix[entity] || "OP")}</span><span>المستخدم: {event.actor_name || event.actor_uid || "—"}</span><span>التاريخ والوقت: {event.created_at || "—"}</span>{value.reason && <span>السبب: {value.reason}</span>}<div className="audit-values"><div><small>قبل</small><b>{auditValueText(before)}</b></div><div><small>بعد</small><b>{auditValueText(after || (value.reason ? { السبب: value.reason } : "تم تسجيل الإجراء"))}</b></div></div></article>; }) : <Empty text="لا توجد تعديلات مسجلة لهذا السجل" />}</div></Modal>;
}
function DataTable({ rows, columns, onEdit, onDelete, onAudit, rowActions, actionsDisabled = false }) {
  const disableActions = (node) => {
    if (!React.isValidElement(node)) return node;
    if (node.type === React.Fragment) return React.cloneElement(node, {}, React.Children.map(node.props.children, disableActions));
    return React.cloneElement(node, { disabled: actionsDisabled, title: actionsDisabled ? "هذا الشهر مغلق. أعد فتح الشهر أولاً للتعديل." : node.props.title }, node.props.children ? React.Children.map(node.props.children, disableActions) : node.props.children);
  };
  if (!rows.length) return <Empty text="لا توجد سجلات مسجلة بعد" />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map(([, l]) => (
              <th key={l}>{l}</th>
            ))}
            {(onEdit || onDelete || rowActions) && <th>إجراءات</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || i}>
              {columns.map(([k, , f]) => (
                <td key={k}>{f ? f(r[k], r) : (r[k] ?? "—")}</td>
              ))}
              {(onEdit || onDelete || rowActions) && (
                <td className="row-actions">
                  {r.employee_name && !r.employee_id ? <button className="table-action action-link" title="يجب ربط السجل بملف موظف أولاً" onClick={() => window.dispatchEvent(new CustomEvent('legacy:link', { detail: r }))}>ربط بملف موظف</button> : React.Children.map(rowActions?.(r), disableActions)}
                  {onEdit && (
                    <button
                      className="table-action"
                      onClick={() => onEdit(r)}
                      disabled={actionsDisabled}
                      title={actionsDisabled ? "هذا الشهر مغلق. أعد فتح الشهر أولاً للتعديل." : "تعديل"}
                    >
                      <Edit3 size={15} />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      className="table-action danger"
                      onClick={() => onDelete(r)}
                      disabled={actionsDisabled}
                      title={actionsDisabled ? "هذا الشهر مغلق. أعد فتح الشهر أولاً للتعديل." : "حذف"}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                  {onAudit && <button className="table-action action-history" onClick={() => onAudit(r)} title="سجل التعديلات">سجل</button>}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Empty({ text }) {
  return (
    <div className="empty">
      <Archive size={25} />
      <strong>{text}</strong>
      <span>ستظهر البيانات هنا بعد أول عملية حفظ.</span>
    </div>
  );
}
const page = (p, title, subtitle, entity, columns, fields, action, pageId, contextField, contexts) => (
  <CrudPage
    {...p}
    title={title}
    subtitle={subtitle}
    entity={entity}
    columns={columns}
    action={action}
    pageId={pageId || entity}
    contextField={contextField}
    contexts={contexts}
    form={({ onDone, initial }) => (
      <SmartForm
        onDone={onDone}
        initial={initial}
        isMonthClosed={p.isMonthClosed}
        entity={entity}
        lockedFields={contextField && contexts?.length ? [contextField] : []}
        fields={fields}
      />
    )}
  />
);
const UNITS = [["kg", "كيلو"], ["g", "غرام"], ["L", "لتر"], ["ml", "مل"], ["piece", "حبة / عدد"], ["bottle", "قنينة"], ["pack", "باكيت"], ["box", "علبة"], ["carton", "كارتون"], ["bag", "كيس"]];
const BASE_UNITS = [["ml", "مل"], ["L", "لتر"], ["g", "غرام"], ["kg", "كيلو"], ["piece", "حبة / عدد"]];
const PURCHASE_UNITS = [["bottle", "قنينة"], ["carton", "كارتون"], ["pack", "باكيت"], ["bag", "كيس"], ["box", "علبة"], ["piece", "حبة / عدد"], ["ml", "مل"], ["L", "لتر"], ["g", "غرام"], ["kg", "كيلو"]];
const unitLabel = (value) => UNITS.find(([key]) => key === value)?.[1] || value || "—";
const userFacingLabel = (value) => String(value ?? "").replaceAll(["صافي", "الربح"].join(" "), "صافي المبلغ");
const inventoryMovementLabel = (row = {}) => row.type === "recipe_consumption" && row.source_type === "sale" ? "استهلاك بيع" : ({ purchase: "شراء", recipe_consumption: "استهلاك وصفة", waste: "هدر", stocktake_adjustment: "تسوية جرد", transfer_in: "نقل داخل", transfer_out: "نقل خارج", ADJUSTMENT: "تعديل يدوي", manual_adjustment: "تعديل يدوي" }[row.type] || row.type || "—");
const inventoryMovementQuantity = (row = {}) => row.quantity_delta != null ? `${Number(row.quantity_delta) > 0 ? "+" : ""}${Number(row.quantity_delta).toLocaleString("en-US")} ${unitLabel(row.base_unit || row.unit)}` : `${Number(row.quantity || 0).toLocaleString("en-US")} ${unitLabel(row.unit)}`;
const inventoryMovementName = (row = {}) => row.item_name || row.material_name || row.inventory_item_name || "—";
const normalizeInventoryMovement = (row = {}, { items = [], products = [], sales = [] } = {}) => {
  const item = items.find((value) => String(value.id) === String(row.item_id || row.inventory_item_id || row.material_id));
  const sale = sales.find((value) => String(value.id) === String(row.source_id || row.sale_id || row.reference));
  const productId = row.product_id || sale?.product_id || sale?.item_id;
  const product = products.find((value) => String(value.id) === String(productId));
  const delta = row.quantity_delta ?? row.delta ?? row.change ?? (row.type === "OUT" ? -Number(row.quantity || 0) : row.quantity);
  const unit = row.base_unit || row.unit || item?.base_unit || item?.unit || "";
  const sourceIsSale = row.source_type === "sale" || row.type === "recipe_consumption" && (row.source_id || row.sale_id);
  return {
    ...row,
    materialId: row.item_id || row.inventory_item_id || row.material_id || "",
    materialName: inventoryMovementName(row) !== "—" ? inventoryMovementName(row) : item?.name_ar || item?.name || item?.nameAr || "—",
    quantity: delta == null || Number.isNaN(Number(delta)) ? "—" : `${Number(delta) > 0 ? "+" : ""}${Number(delta).toLocaleString("en-US")} ${unitLabel(unit)}`,
    unit,
    movementType: inventoryMovementLabel(row),
    reason: row.reason || row.notes || (sourceIsSale ? "بيع / استهلاك وصفة" : row.type === "purchase" ? "شراء" : row.type === "waste" ? "هدر" : row.type === "ADJUSTMENT" || row.type === "manual_adjustment" ? "تعديل يدوي" : "—"),
    productId: productId || "",
    productName: row.product_name || product?.name_ar || product?.name || product?.nameAr || "—",
    saleReference: row.reference || row.source_id || row.sale_id || "—",
    beforeQuantity: row.before_quantity,
    afterQuantity: row.after_quantity,
    createdAt: row.created_at || row.date || "—",
  };
};
const inventoryQuantity = (item = {}) => {
  const raw = Number(item.quantity ?? item.current_stock ?? item.stock ?? item.initial_stock ?? 0);
  const baseUnit = item?.base_unit || item?.unit;
  const purchaseUnit = item?.purchase_unit || item?.unit;
  const packageSize = Number(item?.units_per_package ?? item?.package_size ?? 0);

  const isVol = baseUnit === 'ml' && purchaseUnit === 'L';
  const isMass = baseUnit === 'g' && purchaseUnit === 'kg';
  if ((isVol || isMass) && packageSize <= 1) {
    return raw * 1000;
  }
  return raw;
};
const PAYMENT_METHODS = [["cash", "نقدي"], ["electronic", "إلكتروني / بطاقة"], ["transfer", "تحويل"], ["credit", "آجل"]];
const SelectField = ({ label, value, onChange, children, disabled = false }) => <label><span>{label}</span><select value={value || ""} disabled={disabled} onChange={(e) => onChange(e.target.value)}>{children}</select></label>;
function BarcodeInput({ label = "الباركود", value, onChange, onScan, placeholder = "امسح أو أدخل الرقم ثم Enter", disabled = false }) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const submit = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const code = normalizeBarcode(value);
    if (code) onScan?.(code);
  };
  const supportsCamera = label !== "مسح باركود / إدخال يدوي";
  return <div className="barcode-field"><label><span>{label}</span><input inputMode="numeric" autoComplete="off" value={value || ""} disabled={disabled} placeholder={placeholder} onChange={(event) => onChange?.(event.target.value)} onKeyDown={submit} /></label>{supportsCamera && <><button type="button" className="secondary scan-button" onClick={() => setCameraOpen(true)}>مسح بالكاميرا</button>{cameraOpen && <div className="scanner-inline"><CameraScanner onFound={(code) => { setCameraOpen(false); onScan?.(code); }} /></div>}</>}</div>;
}
function UnknownBarcode({ code, onAdd, onClose }) {
  return <div className="screen-stack"><div className="error"><strong>الباركود غير مسجل</strong><span>القيمة المقروءة: <code dir="ltr">{code}</code></span></div><div className="toolbar"><button type="button" className="primary" onClick={onAdd}>إضافة مادة بهذا الباركود</button><button type="button" className="secondary" onClick={onClose}>إغلاق</button></div></div>;
}
function TransactionForm({ kind, initial, onDone, setToast, isMonthClosed = false }) {
  const purchase = kind === "purchases";
  const [form, setForm] = useState({ date: today(), purchase_type: "inventory", discount_type: "fixed", ...initial });
  const saleOperationKey = useRef(null);
  const [categories, setCategories] = useState([]), [items, setItems] = useState([]), [suppliers, setSuppliers] = useState([]), [error, setError] = useState(""), [saving, setSaving] = useState(false);
  useEffect(() => { Promise.all([api.list(purchase && form.purchase_type === "inventory" ? "inventory_categories" : "product_categories"), api.list(purchase && form.purchase_type === "inventory" ? "inventory_items" : "products"), ...(purchase ? [api.list("suppliers").catch(() => [])] : [])]).then(([c, i, s]) => { setCategories(c); setItems(i); if (s) setSuppliers(s); }).catch((e) => setError(e.message)); }, [purchase, form.purchase_type]);
  const categoryKey = (value) => String(value || "").trim();
  const categoryName = (row) => row?.category_name || row?.categoryName || row?.category || "";
  const selectedCategory = categories.find((x) => categoryKey(x.id) === categoryKey(form.category_id));
  const visible = items.filter((x) => x.active !== false && ([x.category_id, x.categoryId, x.inventory_category_id].some((id) => categoryKey(id) === categoryKey(form.category_id)) || (selectedCategory && api.normalizeName(categoryName(x)) === api.normalizeName(selectedCategory.name_ar || selectedCategory.nameAr || selectedCategory.name))));
  const selected = visible.find((x) => x.id === form.item_id);
  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const subtotal = Number(form.quantity || 0) * Number(form.unit_price || 0);
  const discountAmount = form.discount_type === "percent" ? subtotal * Math.min(100, Number(form.discount_value || 0)) / 100 : Math.min(subtotal, Number(form.discount_value || 0));
  const save = async (e) => {
    e.preventDefault();
    try {
      if (saving) return;
      setSaving(true);
      if (isMonthClosed) throw new Error("هذا الشهر مغلق. أعد فتح الشهر أولاً للتعديل.");
      if (!form.item_id || !form.category_id) throw new Error("اختر القسم ثم المنتج أو المادة.");
      if (!form.unit || Number(form.quantity) <= 0) throw new Error("أدخل كمية واختر الوحدة.");
      if (!purchase && !String(form.payment_method || "").trim()) throw new Error("اختر طريقة الدفع قبل حفظ عملية البيع.");
      const itemName = selected?.name_ar || selected?.nameAr || selected?.name || "";
      const categoryName = categories.find((x) => x.id === form.category_id)?.name_ar || categories.find((x) => x.id === form.category_id)?.nameAr || "";
      const isInventoryPurchase = purchase && form.purchase_type === "inventory";
      const payload = purchase ? {
        purchase_type: form.purchase_type,
        ...(isInventoryPurchase ? { inventory_item_id: form.item_id, inventory_item_name: itemName } : { product_id: form.item_id, product_name: itemName }),
        category_id: form.category_id,
        category_name: categoryName,
        quantity: Number(form.quantity),
        unit: form.unit,
        unit_price: Number(form.unit_price || 0),
        discount_type: form.discount_type || "fixed",
        discount_value: Number(form.discount_value || 0),
        discount_amount: discountAmount,
        total_after_discount: subtotal - discountAmount,
        date: form.date || today(),
        ...(form.supplier_id ? { supplier_id: form.supplier_id } : {}),
        ...(form.supplier_name ? { supplier_name: form.supplier_name } : {}),
        ...(form.payment_method ? { payment_method: form.payment_method } : {}),
        ...(form.notes ? { notes: form.notes } : {})
      } : {
        ...form,
        product_id: form.product_id || form.item_id,
        ...(!initial?.id ? { operation_key: saleOperationKey.current || (saleOperationKey.current = `ui-sale-${Date.now()}-${Math.random().toString(36).slice(2)}`) } : {}),
        item_name: itemName,
        product_name: itemName,
        category_name: categoryName,
        subtotal,
        discount_amount: discountAmount,
        total_after_discount: subtotal - discountAmount
      };
      delete payload.id;
       const saved = initial?.id ? await api.update(kind, initial.id, payload) : await api.create(kind, payload);
       const amount = money(payload.total_after_discount);
       onDone?.(!initial?.id && kind === "sales" ? (saved?.inventory_consumption_status === "no_recipe" ? "تم تسجيل البيع، لكن المنتج لا يحتوي على وصفة ولم يتم خصم مواد مخزون." : payload.payment_method === "cash" ? `تم تسجيل البيع بنجاح — أضيف ${amount} إلى الصندوق وتم خصم مكونات الوصفة تلقائياً.` : "تم تسجيل البيع بنجاح — تم خصم مكونات الوصفة تلقائياً ولم يُضف مبلغ نقدي.") : `تم حفظ عملية الشراء وتحديث أثر النقد أو الدين.`);
    } catch (e) { setError(userFacingError(e, "تعذر حفظ العملية.")); } finally { setSaving(false); }
  };
  return <form className="smart-form" onSubmit={save}>
    <label><span>التاريخ</span><input type="date" value={form.date || ""} onChange={(e) => set("date", e.target.value)} /></label>
    {purchase && <SelectField label="نوع الشراء" value={form.purchase_type} onChange={(v) => setForm((x) => ({ ...x, purchase_type: v, category_id: "", item_id: "", item_name: "" }))}><option value="inventory">مادة مخزون</option><option value="product">منتج جاهز</option></SelectField>}
    <SelectField label="القسم" value={form.category_id} onChange={(v) => setForm((x) => ({ ...x, category_id: v, item_id: "", item_name: "" }))}><option value="">اختر القسم</option>{categories.map((x) => <option key={x.id} value={x.id}>{x.name_ar || x.nameAr || x.name}</option>)}</SelectField>
    <SelectField label={purchase ? "المنتج / المادة" : "المنتج"} value={form.item_id} onChange={(v) => { const next = visible.find((x) => x.id === v); setForm((x) => ({ ...x, item_id: v, item_name: next?.name_ar || next?.nameAr || next?.name || "", unit: purchase && form.purchase_type === "inventory" ? (next?.unit || "") : (next?.unit || x.unit || ""), unit_price: purchase && form.purchase_type === "inventory" ? (next?.purchase_price ?? next?.last_purchase_price ?? "") : (next?.selling_price ?? next?.sellingPrice ?? x.unit_price ?? "") })); }} disabled={!form.category_id}><option value="">اختر من القسم</option>{visible.map((x) => <option key={x.id} value={x.id}>{x.name_ar || x.nameAr || x.name} {x.name_en || x.nameEn ? `— ${x.name_en || x.nameEn}` : ""}</option>)}</SelectField>
    <label><span>الكمية</span><input type="number" min="0" step="0.01" value={form.quantity || ""} onChange={(e) => set("quantity", e.target.value)} /></label>
    <SelectField label="الوحدة" value={form.unit} onChange={(v) => set("unit", v)} disabled={purchase && form.purchase_type === "inventory"}><option value="">اختر الوحدة</option>{UNITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
    <label><span>سعر الوحدة</span><input type="number" min="0" value={form.unit_price || ""} onChange={(e) => set("unit_price", e.target.value)} /></label>
    <label><span>الإجمالي قبل الخصم</span><input readOnly value={subtotal || 0} /></label>
    <SelectField label="نوع الخصم" value={form.discount_type} onChange={(v) => set("discount_type", v)}><option value="fixed">قيمة ثابتة</option><option value="percent">نسبة مئوية</option></SelectField>
    <label><span>قيمة الخصم</span><input type="number" min="0" value={form.discount_value || ""} onChange={(e) => set("discount_value", e.target.value)} /></label>
    <label><span>قيمة الخصم المحسوبة</span><input readOnly value={discountAmount || 0} /></label><label><span>الإجمالي بعد الخصم</span><input readOnly value={subtotal - discountAmount} /></label>
    <SelectField label="طريقة الدفع" value={form.payment_method} onChange={(v) => set("payment_method", v)}><option value="">اختر الطريقة</option>{PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</SelectField>
    {purchase && <SelectField label="التاجر / الشركة" value={form.supplier_id} onChange={(v) => { const row = suppliers.find((x) => x.id === v); setForm((x) => ({ ...x, supplier_id: v, supplier_name: row?.name || "" })); }}><option value="">اختر التاجر / الشركة</option>{suppliers.map((x) => <option key={x.id} value={x.id}>{x.name} — {x.type === "company" ? "شركة" : "تاجر"}</option>)}</SelectField>}
    <label className="wide"><span>ملاحظات</span><textarea value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} /></label>
    {error && <div className="error wide" role="alert">{error}</div>}<button className="primary wide" disabled={saving || isMonthClosed}><Check size={17} /> {saving ? "جارٍ الحفظ..." : "حفظ العملية"}</button>
  </form>;
}
function Purchases(p) {
  const [invoices, setInvoices] = useState([]), [loading, setLoading] = useState(true), [show, setShow] = useState(false);
  useEffect(() => { let mounted = true; setLoading(true); api.listPurchases(p.selectedMonth || "all").then((rows) => mounted && setInvoices(rows || [])).catch(() => mounted && setInvoices([])).finally(() => mounted && setLoading(false)); return () => { mounted = false; }; }, [p.selectedMonth]);
  useEffect(() => {
    const handleNewAction = (event) => {
      if (event.detail !== "purchases") return;
      if (p.can("purchase_invoices.create") && !p.isMonthClosed) setShow(true);
    };
    document.addEventListener("app:new-action", handleNewAction);
    return () => document.removeEventListener("app:new-action", handleNewAction);
  }, [p.can, p.isMonthClosed]);
  const load = () => api.listPurchases(p.selectedMonth || "all").then((rows) => setInvoices(rows || [])).catch(() => setInvoices([]));
  return <div className="screen-stack"><Panel title="فواتير الشراء" action="فاتورة متعددة البنود مع المخزون والدائن"><div className="toolbar">{p.can("purchase_invoices.create") && <button className="primary" onClick={() => setShow(true)}><Plus size={17}/> عملية شراء جديدة</button>}</div>{loading ? <Loader /> : <DataTable rows={invoices} columns={[["date","التاريخ"],["invoice_number","رقم الفاتورة",(v,r)=>v || operationReference(r,"PUR")],["supplier_name","التاجر / الشركة",(v,r)=>v || r.supplier || r.company_name || "—"],["total","الإجمالي",(v,r)=>money(v ?? r.total_after_discount ?? r.total_price ?? r.amount)],["paid_amount","المدفوع",(v,r)=>money(v ?? r.paid ?? 0)],["remaining_amount","المتبقي",(v,r)=>money(v ?? Math.max(0, Number(r.total || 0) - Number(r.paid_amount ?? r.paid ?? 0)))],["status","الحالة",(v)=>({paid:"مدفوعة",partial:"جزئية",unpaid:"غير مدفوعة"}[v]||v || "—")]]}/>}</Panel>{show && <Modal title="عملية شراء جديدة" onClose={() => setShow(false)} className="wide-modal"><PurchaseInvoiceForm isMonthClosed={p.isMonthClosed} onDone={() => { setShow(false); load(); p.setToast?.("تم حفظ عملية الشراء وتحديث أثر النقد أو الدين."); }}/></Modal>}</div>;
}
function Debts(p) {
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(true), [show, setShow] = useState(false), [settling, setSettling] = useState(null);
  const load = () => api.listDebts(p.selectedMonth || "all").then(setRows).catch(() => setRows([]));
  useEffect(() => { let mounted = true; setLoading(true); api.listDebts(p.selectedMonth || "all").then((next) => mounted && setRows(next || [])).catch(() => mounted && setRows([])).finally(() => mounted && setLoading(false)); return () => { mounted = false; }; }, [p.selectedMonth]);
  useEffect(() => {
    const handleNewAction = (event) => {
      if (event.detail !== "debts") return;
      if (p.can("debts.create") && !p.isMonthClosed) setShow(true);
    };
    document.addEventListener("app:new-action", handleNewAction);
    return () => document.removeEventListener("app:new-action", handleNewAction);
  }, [p.can, p.isMonthClosed]);
  const status = { unpaid: "غير مدفوع", partial: "جزئي", overdue: "متأخر", paid: "مسدد" };
  return <div className="screen-stack"><Panel title="الديون والآجل" action="دفتر ذمم مستقل: عليّ وإليّ"><div className="toolbar">{p.can("debts.create") && <button className="primary" onClick={() => setShow(true)}><Plus size={17}/> إضافة دين / آجل</button>}</div>{loading ? <Loader /> : <DataTable rows={rows} columns={[["type","النوع",(v) => v === "receivable" ? "إليّ" : "عليّ"],["party_name","الجهة"],["original_amount","الأصلي",money],["paid_amount","المدفوع",money],["remaining_amount","المتبقي",money],["due_date","الاستحقاق",(v) => v || "—"],["status","الحالة",(v) => <span className={`status-badge status-${v}`}>{status[v] || v}</span>]]} rowActions={(row) => p.can("debts.settle") && row.remaining_amount > 0 ? <button className="table-action action-payment" onClick={() => setSettling(row)}>تسجيل دفعة</button> : null}/>}</Panel>{show && <Modal title="إضافة دين / آجل" onClose={() => setShow(false)}><DebtForm selectedMonth={p.selectedMonth} onDone={() => { setShow(false); load(); }}/></Modal>}{settling && <Modal title={`تسجيل دفعة — ${settling.party_name}`} onClose={() => setSettling(null)}><DebtSettlementForm debt={settling} selectedMonth={p.selectedMonth} onDone={() => { setSettling(null); load(); }}/></Modal>}</div>;
}
function DebtForm({ selectedMonth, onDone }) { const [form, setForm] = useState({ type: "payable", party_name: "", category: "أخرى", original_amount: "", debt_date: `${selectedMonth || currentMonth()}-01`, due_date: "", payment_method: "", notes: "" }); const [error, setError] = useState(""); const set = (key, value) => setForm((old) => ({ ...old, [key]: value })); const save = async (e) => { e.preventDefault(); try { await api.createDebt(form); onDone(); } catch (x) { setError(x.message); } }; return <form className="smart-form" onSubmit={save}><SelectField label="النوع" value={form.type} onChange={(v) => set("type", v)}><option value="payable">عليّ</option><option value="receivable">إليّ</option></SelectField><label><span>الجهة</span><input required value={form.party_name} onChange={(e) => set("party_name", e.target.value)} /></label><label><span>الفئة</span><input value={form.category} onChange={(e) => set("category", e.target.value)} /></label><label><span>المبلغ الأصلي</span><input required type="number" min="1" step="1" value={form.original_amount} onChange={(e) => set("original_amount", e.target.value)} /></label><label><span>تاريخ الدين</span><input required type="date" value={form.debt_date} onChange={(e) => set("debt_date", e.target.value)} /></label><label><span>تاريخ الاستحقاق</span><input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} /></label><label className="wide"><span>ملاحظات</span><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} /></label>{error && <div className="error wide">{error}</div>}<button className="primary wide"><Check size={17}/> حفظ الدين</button></form>; }
function DebtSettlementForm({ debt, selectedMonth, onDone }) { const [amount, setAmount] = useState(String(debt.remaining_amount)); const [method, setMethod] = useState("cash"); const [date, setDate] = useState(today()); const [error, setError] = useState(""); const save = async (e) => { e.preventDefault(); try { await api.settleDebt({ debt_id: debt.id, amount, payment_method: method, date, month: selectedMonth }); onDone(); } catch (x) { setError(x.message); } }; return <form className="smart-form" onSubmit={save}><label><span>المبلغ</span><input required type="number" min="1" max={debt.remaining_amount} value={amount} onChange={(e) => setAmount(e.target.value)} /></label><label><span>التاريخ</span><input required type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label><SelectField label="طريقة الدفع" value={method} onChange={setMethod}>{PAYMENT_METHODS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</SelectField>{error && <div className="error wide">{error}</div>}<button className="primary wide"><Check size={17}/> تأكيد التسوية</button></form>; }
function PurchaseInvoiceForm({ onDone, isMonthClosed = false }) {
  const blank = () => ({ inventory_item_id:"", quantity:"", purchase_unit:"", package_size:"", unit_cost:"", batches:[] });
  const [items, setItems] = useState([blank()]), [inventory, setInventory] = useState([]), [categories, setCategories] = useState([]), [suppliers, setSuppliers] = useState([]), [error, setError] = useState("");
  const [saving, setSaving] = useState(false), [cameraLine, setCameraLine] = useState(null);
  const [operationKey] = useState(() => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`);
  const [form, setForm] = useState({ supplier_id:"", date:today(), payment_method:"cash", paid_amount:"", notes:"", discount:"" });
  useEffect(() => { Promise.all([api.list("inventory_items"), api.list("inventory_categories"), api.list("suppliers")]).then(([a,c,b]) => { setInventory(a); setCategories(c); setSuppliers(b); }).catch((e)=>setError(e.message)); }, []);
  const line = (row) => Number(row.quantity||0) * Number(row.unit_cost||0); const subtotal = items.reduce((n,row)=>n+line(row),0), total = Math.max(0, subtotal-Number(form.discount||0)), paid=Number(form.paid_amount||0);
  const selectedSupplier = suppliers.find((x) => x.id === form.supplier_id);
  const supplierCategoryIds = selectedSupplier ? [selectedSupplier.category_ids, selectedSupplier.inventory_category_ids, selectedSupplier.specialty_category_ids, selectedSupplier.category_id].flatMap((value) => Array.isArray(value) ? value : value ? [value] : []).map(String) : [];
  const hasSpecialty = supplierCategoryIds.length > 0;
  const supplierCategoryNames = supplierCategoryIds.map((id) => categories.find((category) => String(category.id) === id)?.name_ar || categories.find((category) => String(category.id) === id)?.nameAr || categories.find((category) => String(category.id) === id)?.name).filter(Boolean);
  const allowedInventory = hasSpecialty ? inventory.filter((item) => item.active !== false && ([item.category_id, item.categoryId, item.inventory_category_id].filter(Boolean).some((id) => supplierCategoryIds.includes(String(id))) || supplierCategoryNames.some((name) => api.normalizeName(item.category_name || item.categoryName || item.category) === api.normalizeName(name)))) : [];
  const specialtyNames = supplierCategoryIds.map((id) => categories.find((category) => String(category.id) === id)?.name_ar || categories.find((category) => String(category.id) === id)?.nameAr || categories.find((category) => String(category.id) === id)?.name).filter(Boolean);
  const updateLine = (index, change) => setItems((rows)=>rows.map((row,i)=>i===index?{...row,...change}:row));
  const applyBarcode = async (index, code) => {
    const found = allowedInventory.find((item) => [item.barcode, item.internal_barcode].some((value) => normalizeBarcode(value) === normalizeBarcode(code)));
    if (!found) { setError("الباركود غير مسجل"); return; }
    setError("");
    setItems((rows) => {
      const duplicate = rows.findIndex((row, rowIndex) => rowIndex !== index && row.inventory_item_id === found.id);
      if (duplicate >= 0) {
        const next = rows.map((row, rowIndex) => rowIndex === duplicate ? { ...row, quantity: Number(row.quantity || 0) + 1 } : row);
        return !rows[index].inventory_item_id && rows.length > 1 ? next.filter((_, rowIndex) => rowIndex !== index) : next;
      }
      return rows.map((row, rowIndex) => rowIndex === index ? { ...row, inventory_item_id: found.id, purchase_unit: found.base_unit || found.unit || "", package_size: found.units_per_package || "", unit_cost: found.purchase_price || "", quantity: Number(row.quantity || 0) || 1, batches: [] } : row);
    });
  };
  const save = async (e) => { e.preventDefault(); if (saving) return; setError(""); try { setSaving(true); if (isNaN(paid) || paid < 0) throw new Error("أدخل مبلغاً مدفوعاً صحيحاً."); if (paid > total) throw new Error("المبلغ المدفوع أكبر من إجمالي الفاتورة."); if (!form.supplier_id) throw new Error("يرجى اختيار التاجر أو الشركة."); if (!hasSpecialty) throw new Error("لم يتم تحديد اختصاص لهذا التاجر. حدّد الاختصاص أولاً."); if (!items.some((row) => row.inventory_item_id)) throw new Error("يرجى إضافة مادة واحدة على الأقل."); const prepared=items.map((row)=>{ const stock=allowedInventory.find((x)=>x.id===row.inventory_item_id); if (!stock) throw new Error("هذه المادة غير مرتبطة باختصاص التاجر المحدد."); if (!Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0) throw new Error("أدخل كمية شراء صحيحة."); if (!Number.isFinite(Number(row.unit_cost)) || Number(row.unit_cost) < 0) throw new Error("أدخل تكلفة الوحدة."); const factor=Number(stock.units_per_package||1), base=Number(row.quantity)*((row.purchase_unit===stock.base_unit||row.purchase_unit===stock.unit)?1:factor); if (stock.track_expiry && row.batches.length && row.batches.reduce((n,b)=>n+Number(b.base_quantity||0),0)!==base) throw new Error("مجموع الدفعات لا يساوي الكمية الأساسية."); return {...row, inventory_item_name:stock.name_ar||stock.name, unit:row.purchase_unit||stock.base_unit, line_total:line(row)}; }); const supplier=suppliers.find((x)=>x.id===form.supplier_id); const invoiceNumber=`PUR-${String(form.date||today()).replaceAll("-","")}-${operationKey.slice(-8)}`; await api.createPurchaseInvoice({...form, invoice_number:invoiceNumber, operation_id:operationKey, operation_key:operationKey, supplier_name:supplier?.name||"", paid_amount:paid, discount:Number(form.discount||0), items:prepared}); onDone(); } catch (x) { setError(x.message || "تعذر حفظ عملية الشراء."); setSaving(false); } };
  const chooseSupplier = (value) => { setForm((x)=>({...x,supplier_id:value})); setItems([blank()]); setError(""); };
  return <form className="smart-form purchase-form" onSubmit={save}><SelectField label="التاجر / الشركة" value={form.supplier_id} onChange={chooseSupplier}><option value="">اختر التاجر / الشركة</option>{suppliers.map(x=><option key={x.id} value={x.id}>{x.name} — {x.type === "company" ? "شركة" : "تاجر"}</option>)}</SelectField><label><span>التاريخ</span><input required type="date" value={form.date} onChange={e=>setForm(x=>({...x,date:e.target.value}))}/></label>{selectedSupplier && <div className="supplier-specialty wide"><small>{specialtyNames.length > 1 ? "الاختصاصات" : "الاختصاص"}</small><strong>{specialtyNames.length ? specialtyNames.join("، ") : "لم يتم تحديد اختصاص لهذا التاجر"}</strong>{!hasSpecialty && <span>تحديد الاختصاص متاح من ملف التاجر/الشركة.</span>}</div>}<SelectField label="طريقة الدفع" value={form.payment_method} onChange={v=>setForm(x=>({...x,payment_method:v}))}>{PAYMENT_METHODS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</SelectField><label><span>المبلغ المدفوع</span><input type="number" min="0" step="0.01" value={form.paid_amount} onChange={e=>setForm(x=>({...x,paid_amount:e.target.value}))}/></label><label className="wide"><span>المواد المشتراة</span></label><div className="wide purchase-lines">{items.map((row,i)=>{const stock=allowedInventory.find(x=>x.id===row.inventory_item_id); const unit=row.purchase_unit||stock?.base_unit||stock?.unit||""; const base=Number(row.quantity||0)*((unit===stock?.base_unit||unit===stock?.unit)?1:Number(stock?.units_per_package||1)); return <div className="purchase-line-card" key={i}><div className="purchase-line-head"><strong>البند {i+1}</strong><button type="button" className="table-action danger" onClick={()=>setItems(x=>x.length>1?x.filter((_,n)=>n!==i):x)}>حذف</button></div><BarcodeInput label="مسح باركود / إدخال يدوي" value={row.barcode_input || ""} onChange={(value)=>updateLine(i,{barcode_input:value})} onScan={(code)=>applyBarcode(i,code)} /><button type="button" className="secondary scan-button" onClick={()=>setCameraLine(i)}>مسح بالكاميرا</button><SelectField label="المادة" value={row.inventory_item_id} disabled={!hasSpecialty} onChange={v=>{const x=allowedInventory.find(value=>value.id===v);updateLine(i,{inventory_item_id:v,purchase_unit:x?.base_unit||x?.unit||"",package_size:x?.units_per_package||"",unit_cost:x?.purchase_price||"",batches:[]});}}><option value="">{hasSpecialty ? "اختر مادة" : "حدد اختصاص التاجر أولاً"}</option>{allowedInventory.map(x=><option key={x.id} value={x.id}>{x.name_ar||x.name}</option>)}</SelectField><label><span>الكمية</span><input type="number" min="0.01" step="0.01" value={row.quantity} onChange={e=>updateLine(i,{quantity:e.target.value})}/></label><label><span>الوحدة</span><input value={unitLabel(unit)} readOnly/></label><label><span>تكلفة الوحدة</span><input type="number" min="0" step="0.01" value={row.unit_cost} onChange={e=>updateLine(i,{unit_cost:e.target.value})}/></label><div className="line-total">الإجمالي: <strong>{money(line(row))}</strong>{stock?.units_per_package && <small>الكمية الأساسية: {base} {unitLabel(stock.base_unit||stock.unit)}</small>}</div>{stock?.track_expiry && <BatchEditor batches={row.batches} base={base} date={form.date} onChange={(batches)=>updateLine(i,{batches})}/>}</div>;})}</div><button type="button" className="secondary wide" onClick={()=>setItems(x=>[...x,blank()])}>إضافة بند</button><div className="notice wide purchase-summary">الإجمالي: {money(total)} · المدفوع: {money(paid)} · المتبقي: {money(total-paid)}<label><span>خصم اختياري</span><input type="number" min="0" value={form.discount} onChange={e=>setForm(x=>({...x,discount:e.target.value}))}/></label></div><label className="wide"><span>ملاحظات - اختياري</span><textarea value={form.notes} onChange={e=>setForm(x=>({...x,notes:e.target.value}))}/></label>{cameraLine !== null && <div className="wide scanner-inline"><CameraScanner onFound={(code)=>{setCameraLine(null);applyBarcode(cameraLine,code);}} /></div>}{error&&<div className="error wide" role="alert">{error}</div>}<button className="primary wide" disabled={saving || isMonthClosed} title={isMonthClosed ? "هذا الشهر مغلق. أعد فتح الشهر قبل إضافة عملية مالية." : ""}><Check size={17} /> {saving ? "جاري الحفظ..." : "حفظ عملية الشراء"}</button></form>;
}
function BatchEditor({ batches, base, date, onChange }) { const add=()=>onChange([...(batches||[]),{batch_number:"",received_date:date,expiry_date:"",base_quantity:""}]); return <div className="batch-editor"><strong>الدفعات والصلاحية</strong>{batches.map((b,i)=><div key={i} className="inline-fields"><input placeholder="رقم الدفعة" value={b.batch_number} onChange={e=>onChange(batches.map((x,n)=>n===i?{...x,batch_number:e.target.value}:x))}/><input type="date" value={b.received_date} onChange={e=>onChange(batches.map((x,n)=>n===i?{...x,received_date:e.target.value}:x))}/><input type="date" value={b.expiry_date} onChange={e=>onChange(batches.map((x,n)=>n===i?{...x,expiry_date:e.target.value}:x))}/><input type="number" placeholder="الكمية الأساسية" value={b.base_quantity} onChange={e=>onChange(batches.map((x,n)=>n===i?{...x,base_quantity:e.target.value}:x))}/><button type="button" onClick={()=>onChange(batches.filter((_,n)=>n!==i))}>×</button></div>)}<button type="button" className="secondary" onClick={add}>إضافة دفعة</button> <small>المجموع: {batches.reduce((n,b)=>n+Number(b.base_quantity||0),0)} / {base}</small></div>; }
function Sales(p) { return <CrudPage {...p} title="المبيعات" subtitle="الوارد الكلي بعد الخصومات" entity="sales" columns={[["date", "التاريخ"], ["category_name", "القسم"], ["product_name", "المنتج"], ["quantity", "الكمية"], ["unit", "الوحدة", (v) => UNITS.find((x) => x[0] === v)?.[1] || v], ["unit_price", "سعر الوحدة", money], ["discount_amount", "الخصم", money], ["total_after_discount", "الإجمالي", money], ["payment_method", "طريقة الدفع"]]} action="إضافة مبيعات" form={({ onDone, initial }) => <TransactionForm kind="sales" initial={initial} isMonthClosed={p.isMonthClosed} onDone={onDone} />} />; }
function OtherIncome(p) {
  const [categories, setCategories] = useState([]), [manage, setManage] = useState(false);
  useEffect(() => {
    api.listOtherIncomeCategories().then(setCategories).catch(() => setCategories([]));
    return api.subscribeCollection("other_income_categories", setCategories, () => setCategories([]));
  }, []);
  return <><CrudPage {...p} title="الإيرادات الأخرى" subtitle="دخل خارج المبيعات اليومية؛ النقدي منه يضيف حركة صندوق تلقائية" entity="other_income" action="إضافة إيراد آخر" columns={[["date", "التاريخ"], ["amount", "المبلغ", money], ["category_name", "نوع الإيراد", (v, row) => v || row.category], ["description", "الوصف"], ["payment_method", "طريقة الاستلام", (v) => ({ cash: "نقدي", electronic: "إلكتروني", transfer: "تحويل" }[v] || v)], ["notes", "ملاحظات"]]} form={({ onDone, initial }) => <OtherIncomeForm initial={initial} categories={categories} onDone={onDone} />} /><OtherIncomeCategoryTotals selectedMonth={p.selectedMonth} categories={categories} />{p.can("other_income.edit") && <div className="other-income-category-action"><button className="secondary" onClick={() => setManage(true)}>إدارة فئات الإيرادات الأخرى</button></div>}{manage && <Modal title="فئات الإيرادات الأخرى" onClose={() => setManage(false)}><OtherIncomeCategoryManager categories={categories} onChanged={() => api.listOtherIncomeCategories({ includeInactive: true }).then(setCategories)} /></Modal>}</>;
}
function OtherIncomeCategoryTotals({ selectedMonth, categories }) { const [rows, setRows] = useState([]); useEffect(() => { api.list("other_income").then(setRows).catch(() => setRows([])); return api.subscribeCollection("other_income", setRows, () => setRows([])); }, []); const totals = Object.values(recordsForMonth(rows, selectedMonth).reduce((result, row) => { const id = row.category_id || row.category || "legacy"; const name = row.category_name || categories.find((category) => category.id === id)?.name_ar || row.category || "غير مصنفة"; result[id] = { name, amount: Number(result[id]?.amount || 0) + Number(row.amount || 0) }; return result; }, {})); return <Panel title="إجمالي الإيرادات الأخرى حسب الفئة" action="الفترة المالية المحددة"><div className="report-summary-grid">{totals.length ? totals.map((row) => <div className="report-summary-card" key={row.name}><span>{row.name}</span><strong>{money(row.amount)}</strong></div>) : <Empty text="لا توجد إيرادات أخرى لهذه الفترة" />}</div></Panel>; }
function OtherIncomeForm({ initial = {}, categories, onDone }) {
  const [form, setForm] = useState({ date: today(), payment_method: "cash", ...initial }), [error, setError] = useState("");
  const save = async (event) => { event.preventDefault(); try { const saved = form.id ? await api.update("other_income", form.id, form) : await api.create("other_income", form); onDone(saved); } catch (err) { setError(err.message); } };
  return <form className="smart-form" onSubmit={save}><label><span>التاريخ</span><input required type="date" value={form.date || ""} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label><label><span>المبلغ</span><input required type="number" min="1" value={form.amount || ""} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label><SelectField label="نوع الإيراد" value={form.category || form.category_id} onChange={(value) => setForm({ ...form, category: value })}><option value="">اختر الفئة</option>{categories.filter((row) => row.active !== false || row.id === form.category || row.id === form.category_id).map((row) => <option key={row.id} value={row.id}>{row.name_ar}{row.active === false ? " (مؤرشفة)" : ""}</option>)}</SelectField><label><span>الوصف</span><input required value={form.description || ""} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label><SelectField label="طريقة الاستلام" value={form.payment_method} onChange={(value) => setForm({ ...form, payment_method: value })}><option value="cash">نقدي</option><option value="electronic">إلكتروني</option><option value="transfer">تحويل</option></SelectField><label className="wide"><span>ملاحظات</span><textarea value={form.notes || ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>{!categories.some((row) => row.active !== false) && <div className="notice wide">لا توجد فئات مفعّلة بعد. أضف فئة من زر الإدارة قبل تسجيل الإيراد.</div>}{error && <div className="error wide">{error}</div>}<button className="primary wide"><Check size={17} /> حفظ الإيراد</button></form>;
}
function OtherIncomeCategoryManager({ categories, onChanged }) {
  const [name, setName] = useState(""), [error, setError] = useState("");
  const add = async (event) => { event.preventDefault(); try { await api.saveOtherIncomeCategory({ name_ar: name }); setName(""); await onChanged?.(); } catch (err) { setError(err.message); } };
  const edit = async (row) => { const next = window.prompt("اسم الفئة", row.name_ar); if (!next?.trim()) return; try { await api.saveOtherIncomeCategory({ id: row.id, name_ar: next, active: row.active !== false }); await onChanged?.(); } catch (err) { setError(err.message); } };
  return <div className="screen-stack"><form className="smart-form" onSubmit={add}><label className="wide"><span>فئة جديدة</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="مثال: بيع ماكينة قهوة" /></label><button className="primary wide"><Plus size={17} /> إضافة فئة</button></form>{error && <div className="error">{error}</div>}<div className="profile-list">{categories.length ? categories.map((row) => <div key={row.id}><div><strong>{row.name_ar}</strong><span>{row.active === false ? "مؤرشفة" : "فعالة"}</span></div><div className="row-actions"><button className="table-action" onClick={() => edit(row)}>تعديل</button>{row.active !== false && <button className="table-action danger" onClick={async () => { try { await api.archiveOtherIncomeCategory(row.id); await onChanged?.(); } catch (err) { setError(err.message); } }}>أرشفة</button>}</div></div>) : <Empty text="أضف فئات مثل بيع ماكينة قهوة أو بيع كبسولة." />}</div></div>;
}
function Expenses(p) {
  return <CrudPage {...p} title="المصروفات" subtitle="هرمية: قسم رئيسي ← قسم فرعي ← مصروف فعلي" entity="expenses" columns={[["date", "التاريخ"], ["category_name", "القسم الرئيسي"], ["subcategory_name", "القسم الفرعي"], ["description", "الوصف"], ["amount", "المبلغ", money], ["payment_status", "حالة الدفع", (v) => ({ paid: "مدفوع بالكامل", partial: "مدفوع جزئيًا", unpaid: "آجل / غير مدفوع" }[v] || v)], ["payment_method", "الدفع"], ["created_by_name", "الموظف"]]} action="إضافة مصروف" pageId="expenses" form={({ onDone, initial }) => <ExpenseForm onDone={onDone} initial={initial} isMonthClosed={p.isMonthClosed} />} />;
}
function ExpenseForm({ onDone, initial, isMonthClosed = false }) {
  const [form, setForm] = useState({ date: today(), payment_status: "paid", paid_amount: "", payment_method: "cash", ...initial });
  const [error, setError] = useState("");
  const total = Math.max(0, Number(form.amount || 0));
  const status = form.payment_status || "paid";
  const paid = status === "paid" ? total : status === "unpaid" ? 0 : Math.min(total, Math.max(0, Number(form.paid_amount || 0)));
  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const chooseStatus = (value) => setForm((old) => ({ ...old, payment_status: value, paid_amount: value === "paid" ? String(Number(old.amount || 0)) : value === "unpaid" ? "0" : old.paid_amount }));
  const save = async (event) => {
    event.preventDefault();
    try {
      if (isMonthClosed) throw new Error("هذا الشهر مغلق. أعد فتح الشهر أولاً للتعديل.");
      if (!total || paid > total) throw new Error("مبلغ المصروف أو المدفوع غير صحيح.");
      const payload = { ...form, paid_amount: paid, remaining_amount: total - paid, payment_status: status };
      const saved = form.id ? await api.update("expenses", form.id, payload) : await api.create("expenses", payload);
      onDone(saved || payload);
    } catch (e) { setError(e.message || "تعذر حفظ المصروف."); }
  };
  return <form className="smart-form expense-form" onSubmit={save}>
    <label><span>التاريخ</span><input required type="date" value={form.date || ""} onChange={(e) => set("date", e.target.value)} /></label>
    <label><span>المبلغ</span><input required type="number" min="0" value={form.amount || ""} onChange={(e) => set("amount", e.target.value)} /></label>
    <label><span>القسم الرئيسي</span><input value={form.category_name || ""} onChange={(e) => set("category_name", e.target.value)} /></label>
    <label><span>القسم الفرعي</span><input value={form.subcategory_name || ""} onChange={(e) => set("subcategory_name", e.target.value)} /></label>
    <label className="wide"><span>الوصف</span><input required value={form.description || ""} onChange={(e) => set("description", e.target.value)} /></label>
    <fieldset className="wide payment-state"><legend>حالة الدفع</legend><div className="filter-pills">{[["paid", "مدفوع بالكامل"], ["partial", "مدفوع جزئيًا"], ["unpaid", "آجل / غير مدفوع"]].map(([value, label]) => <button type="button" key={value} className={status === value ? "active" : ""} onClick={() => chooseStatus(value)}>{label}</button>)}</div></fieldset>
    <label><span>المبلغ المدفوع الآن</span><input type="number" min="0" max={total || undefined} value={paid} disabled={status !== "partial"} onChange={(e) => set("paid_amount", e.target.value)} /></label>
    <label><span>المتبقي</span><input readOnly value={Math.max(0, total - paid)} /></label>
    <label><span>طريقة الدفع</span><select value={form.payment_method || "cash"} onChange={(e) => set("payment_method", e.target.value)}>{PAYMENT_METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label><span>تاريخ الاستحقاق</span><input type="date" value={form.due_date || ""} onChange={(e) => set("due_date", e.target.value)} /></label>
    <label><span>الجهة المستلمة</span><input value={form.beneficiary || ""} onChange={(e) => set("beneficiary", e.target.value)} /></label>
    <label className="wide"><span>ملاحظات</span><textarea value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} /></label>
    {error && <div className="error wide" role="alert">{error}</div>}
    <button className="primary wide" disabled={isMonthClosed}><Plus size={17} /> {form.id ? "تحديث السجل" : "حفظ العملية"}</button>
  </form>;
}
function InventoryDetails({ item, categories, movements, analytics, onClose }) {
  const [recipes, setRecipes] = React.useState([]);
  const [products, setProducts] = React.useState([]);
  React.useEffect(() => {
    Promise.all([api.list("product_recipes").catch(()=>[]), api.list("products").catch(()=>[])]).then(([r, p]) => {
      setRecipes(r);
      setProducts(p);
    });
  }, []);
  const consumed = movementConsumptionBySource(movements, item.id);
  const qty = inventoryQuantity(item), eq = packageEquivalent(item), size = packageSize(item);
  const category = categories.find((x) => x.id === item.category_id);
  const linkedRecipes = recipes.filter(r => r.items && r.items.some(i => i.inventory_item_id === item.id));
  const productConsumptionMap = {};
  if (analytics && analytics.products) {
    analytics.products.forEach(p => {
      productConsumptionMap[p.product_id] = {
        name: p.product_name || p.product_id,
        units: p.units,
        consumption: p.consumption,
        percentage: p.percentage
      };
    });
  }
  return <div className="details-panel"><div className="details-grid">
    <section><h3>معلومات المادة</h3><p><b>الاسم:</b> {item.name_ar || item.name || "—"}</p><p><b>القسم:</b> {category?.name_ar || item.category_name || "—"}</p><p><b>الوحدة:</b> {unitLabel(item.base_unit || item.unit)}</p><p><b>الحالة:</b> {item.active === false ? "مؤرشف" : isAmbiguousInventoryUnit(item) ? "راجع وحدة المادة" : "فعال"}</p></section>
    <section><h3>بطاقة المخزون</h3><p><b>الكمية الحالية:</b> {qty.toLocaleString("en-US")} {unitLabel(item.base_unit || item.unit)}</p><p><b>إجمالي المستهلك:</b> {analytics?.consumption ? analytics.consumption.toLocaleString("en-US") : "0"} {unitLabel(item.base_unit || item.unit)}</p><p><b>الحد الأدنى:</b> {item.min_stock || "0"} {unitLabel(item.base_unit || item.unit)}</p><p><b>حالة المخزون:</b> {lowStockStatus(item) === "out" ? "نفد" : lowStockStatus(item) === "low" ? "منخفض" : "متوفر"}</p><p><b>قيمة المخزون:</b> {money(inventoryValue(item))}</p><p><b>المتبقي يعادل تقريبًا:</b> {eq === null ? "—" : `${eq.toLocaleString("en-US", { maximumFractionDigits: 2 })} عبوة`}</p><p><b>يكفي لـ:</b> {item.usage_per_serving ? `${Math.floor(qty / Number(item.usage_per_serving))} حصة تقريبًا` : "—"}</p></section>
    <section><h3>استهلاك المادة</h3>{Object.keys(productConsumptionMap).length > 0 ? <div className="table-wrap"><table><thead><tr><th>المنتج</th><th>عدد الحصص/المبيعات</th><th>الكمية المستهلكة</th><th>الوحدة</th><th>نسبة الاستهلاك</th></tr></thead><tbody>{Object.values(productConsumptionMap).map((row, i) => <tr key={i}><td>{row.name}</td><td>{row.units.toLocaleString("en-US")} حصة</td><td>{row.consumption.toLocaleString("en-US")}</td><td>{unitLabel(item.base_unit || item.unit)}</td><td>{Number.isFinite(Number(row.percentage)) ? `${row.percentage.toFixed(1)}%` : "0.0%"}</td></tr>)}</tbody></table></div> : <p>لا توجد تفاصيل استهلاك مسجلة للفترة السابقة</p>}</section>
    <section><h3>المنتجات المرتبطة بالمادة</h3>{linkedRecipes.length > 0 ? <ul>{linkedRecipes.map((r, i) => {
      const p = products.find(x => String(x.id) === String(r.product_id));
      const iRow = r.items.find(x => x.inventory_item_id === item.id);
      return <li key={i}>{p?.name_ar || p?.name || r.product_id} — {iRow.quantity} {unitLabel(item.base_unit || item.unit)} لكل حصة</li>;
    })}</ul> : <p>لا توجد منتجات مرتبطة حالياً</p>}</section>
  </div><div className="details-history-section"><h3>سجل الحركات</h3><ItemHistory item={item} movements={movements} embedded={true} /></div></div>;
}const servingCostText = (item) => item.usage_per_serving && inventoryBaseUnitCost(item) != null ? money(Number(item.usage_per_serving) * inventoryBaseUnitCost(item)) : "—";
function Inventory(p) {
  const { can = () => false } = p;
  const canEditItems = can("materials.edit");
  const canDeleteItems = can("materials.delete");
  const canCreateItems = can("materials.create");
  const canMoveStock = can("inventory.adjust") || can("stock_in.create") || can("stock_out.create");
  const canViewMoves = can("stock_movements.view");
  const [tab, setTab] = useState("items"),
    [items, setItems] = useState([]),
    [moves, setMoves] = useState([]), [cats, setCats] = useState([]), [batches,setBatches]=useState([]), [locations,setLocations]=useState([]), [sales,setSales]=useState([]), [recipes,setRecipes]=useState([]), [products,setProducts]=useState([]), [lowFilter,setLowFilter]=useState("all"), [expiryFilter,setExpiryFilter]=useState("all"),
    [show, setShow] = useState(false), [showArchived, setShowArchived] = useState(false), [barcode, setBarcode] = useState(""), [query, setQuery] = useState(""), [categoryFilter, setCategoryFilter] = useState("all"),
    [toast, setToast] = useState("");
  const applyInventoryData = ({ items: nextItems = [], movements = [], categories = [], batches = [], locations = [], sales = [], recipes = [], products = [] }) => {
    setItems(nextItems);
    setMoves(canViewMoves ? movements : []);
    setCats(categories);
    setBatches(batches);
    setLocations(locations.length ? locations : [{ id: "main_storage", name_ar: "المخزن الرئيسي", type: "storage", active: true }, { id: "coffee_bar", name_ar: "بار الكوفي", type: "bar", active: true }]);
    setSales(sales); setRecipes(recipes); setProducts(products);
  };
  const load = () => Promise.all([api.list("inventory_items"), canViewMoves ? api.list("inventory_movements") : Promise.resolve([]), api.list("inventory_categories"), api.list("inventory_batches").catch(() => []), api.list("inventory_locations").catch(() => []), api.list("sales").catch(() => []), api.list("product_recipes").catch(() => []), api.list("products").catch(() => [])])
    .then(([items, movements, categories, batches, locations, sales, recipes, products]) => applyInventoryData({ items, movements, categories, batches, locations, sales, recipes, products }))
    .catch(() => {});
  useEffect(() => {
    let mounted = true;
    const unsubscribe = api.subscribeInventoryData(
      (next) => { if (mounted) applyInventoryData(next); },
      () => { if (mounted) load(); },
    );
    return () => { mounted = false; if (typeof unsubscribe === "function") unsubscribe(); };
  }, [canViewMoves]);
  useEffect(() => {
    const handleNewAction = (event) => {
      if (event.detail !== "inventory") return;
      setShow("actionPicker");
    };
    document.addEventListener("app:new-action", handleNewAction);
    return () => document.removeEventListener("app:new-action", handleNewAction);
  }, []);
  const analytics = buildInventorySalesAnalytics({ items, movements: moves, sales, recipes, products, range: p.reportRange || { mode: "month", month: p.selectedMonth || "all" } });
  useEffect(() => { if (p.alertTarget?.materialId) { const item = items.find((row) => row.id === p.alertTarget.materialId); if (item) { setTab("items"); setShow({ detailsItem: item }); } } }, [p.alertTarget?.materialId, items]);
  const displayMoves = sortHistory(moves).map((row) => normalizeInventoryMovement(row, { items, products, sales }));
  const visibleItems = sortLowStock(items.filter((item) => showArchived ? item.active === false : item.active !== false).filter((item) => categoryFilter === "all" || item.category_id === categoryFilter || item.categoryId === categoryFilter).filter((item) => { const text = `${item.name_ar||item.name||""} ${item.barcode||""} ${item.sku||""} ${item.category_name||""}`.toLowerCase(); return !query.trim() || text.includes(query.trim().toLowerCase()); })).filter(x=>showArchived || (lowFilter==="all"||lowFilter==="missing"?lowFilter!=="missing"||lowStockStatus(x)!=="available":lowStockStatus(x)===lowFilter));
  return (
    <div className="screen-stack">
      <Panel
        title="المخزون"
        action="الأصناف والأرصدة وحركات الإدخال والإخراج والتسوية"
      >
        <div className="settings-tabs">
          <button
            className={tab === "items" ? "active" : ""}
            onClick={() => setTab("items")}
          >
            الأصناف والأرصدة
          </button>
          {canViewMoves && <button
            className={tab === "moves" ? "active" : ""}
            onClick={() => setTab("moves")}
          >
            الحركات ({moves.length})
          </button>}
          <button className={tab === "expiry" ? "active" : ""} onClick={() => setTab("expiry")}>الصلاحية والدفعات</button>
          <button className={tab === "locations" ? "active" : ""} onClick={() => setTab("locations")}>مواقع المخزون</button>
        </div>
        {tab === "items" ? (
          <>
            <div className="toolbar inventory-toolbar">
              <div className="table-search inventory-search"><Search size={17} /><input aria-label="بحث في المواد" placeholder="بحث بالمادة أو الباركود أو SKU أو القسم" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
              {can("inventory.scan") && <form className="table-search" onSubmit={async (event) => { event.preventDefault(); const code = normalizeBarcode(barcode); if (!code) return; try { const found = await api.lookupBarcode(code); setShow(found || { unknownBarcode: code }); setBarcode(""); } catch (error) { setToast(error.message); } }}><Search size={17} /><input aria-label="مسح باركود" placeholder="مسح / إدخال باركود" value={barcode} onChange={(e) => setBarcode(e.target.value)} /><button className="secondary">بحث</button></form>}
              {can("inventory.scan") && <button className="secondary" onClick={() => setShow("camera")}><Search size={17} /> مسح بالكاميرا</button>}
              {canCreateItems && <button className="primary" onClick={() => setShow(true)}>
                <Plus size={17} /> إضافة مادة
              </button>}
              {can("materials.delete") && <button className="secondary" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "المواد الفعالة" : "المواد المؤرشفة"}</button>}
              {can("materials.create") && <button className="secondary" onClick={async () => { try { setCats(await api.ensureInventoryCategories()); setToast("تم تجهيز أقسام المخزون الأساسية"); } catch (e) { setToast(e.message); } }}>تجهيز أقسام المخزون ({cats.length})</button>}
              {(canMoveStock || can("inventory.waste") || can("inventory.stocktake") || can("inventory.transfer")) && <details className="toolbar-menu"><summary>عمليات المخزون</summary><div className="toolbar-menu-items">{canMoveStock && <button className="secondary" onClick={() => setTab("moves")}><Layers size={17} /> حركة مخزون</button>}{can("inventory.waste") && <button className="secondary" onClick={() => setShow("waste")}>تسجيل هدر</button>}{can("inventory.stocktake") && <button className="secondary" onClick={() => setShow("stocktake")}>جرد المخزون</button>}{can("inventory.transfer") && <button className="secondary" onClick={() => setShow("transfer")}>نقل مخزون</button>}</div></details>}
            </div>
            <div className="inventory-summary-grid">{[["قيمة المخزون الحالية",money(items.filter(x=>x.active!==false).reduce((n,x)=>n+inventoryValue(x),0))],["مواد قاربت على النفاد",items.filter(x=>x.active!==false&&lowStockStatus(x)==="low").length],["مواد نافدة",items.filter(x=>x.active!==false&&lowStockStatus(x)==="out").length],["استهلاك هذه الفترة",`${analytics.materials.reduce((n,row)=>n+Number(row.consumption||0),0).toLocaleString("en-US")} وحدة`],["أكثر المواد استهلاكًا",analytics.materials.slice().sort((a,b)=>Number(b.consumption||0)-Number(a.consumption||0))[0] ? (items.find((item)=>item.id===analytics.materials.slice().sort((a,b)=>Number(b.consumption||0)-Number(a.consumption||0))[0].item_id)?.name_ar || "—") : "لا توجد بيانات"]].map(([label,value])=><div className="summary-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
            <div className="inventory-filters"><div className="filter-pills">{[["all","الكل"],["missing","الناقصة"],["out","نافد"],["low","قارب ينفد"]].map(([v,l])=><button key={v} className={lowFilter===v?"active" : ""} onClick={()=>setLowFilter(v)}>{l}</button>)}</div><div className="filter-pills">{[["all","كل الأقسام"],...cats.map(c=>[c.id,c.name_ar||c.nameAr||c.name])].map(([v,l])=><button key={v} className={categoryFilter===v?"active":""} onClick={()=>setCategoryFilter(v)}>{l}</button>)}</div></div>
            <div className="inventory-mobile-cards">{visibleItems.map((item) => <article className="inventory-mobile-card" key={item.id}><div><strong>{item.name_ar || item.name || "—"}</strong><small>{cats.find((x) => x.id === item.category_id)?.name_ar || item.category_name || "—"}</small></div><p><span>المتوفر</span><b>{inventoryQuantity(item).toLocaleString("en-US")} {unitLabel(item.base_unit || item.unit)}</b>{packageEquivalent(item) !== null && <small>{packageEquivalent(item).toLocaleString("en-US", { maximumFractionDigits: 6 })} {unitLabel(item.purchase_unit || item.unit)}</small>}</p><div className="inventory-mobile-meta"><span>العبوة<br/><b>{unitLabel(item.purchase_unit || item.unit)} × {packageSize(item) || "—"}</b></span><span>سعر العبوة<br/><b>{money(item.purchase_price ?? item.last_purchase_price)}</b></span><span>الاستخدام<br/><b>{item.usage_per_serving ? `${item.usage_per_serving} ${unitLabel(item.base_unit || item.unit)}` : "—"}</b></span></div><button className="secondary" onClick={() => setShow({detailsItem:item})}>التفاصيل</button></article>)}</div>
            <DataTable
              rows={visibleItems}
              columns={[
                ["name_ar", "المادة", (v, r) => v || r.name || r.nameAr || "—"],
                ["category_id", "القسم", (v) => cats.find((x) => x.id === v)?.name_ar || v || "—"],
                ["quantity", "المتوفر", (v, r) => <span className="quantity-display"><strong>{inventoryQuantity(r).toLocaleString("en-US")} {unitLabel(r.base_unit || r.unit)}</strong>{packageEquivalent(r) !== null && <small>{packageEquivalent(r).toLocaleString("en-US", { maximumFractionDigits: 6 })} {unitLabel(r.purchase_unit || r.unit)}</small>}</span>],
                ["package", "العبوة", (v, r) => `${unitLabel(r.purchase_unit || r.unit)} × ${packageSize(r) || "—"} ${unitLabel(r.base_unit || r.unit)}`],
                ["purchase_price", "سعر العبوة", (v, r) => money(v ?? r.last_purchase_price)],
                ["usage_per_serving", "الاستهلاك", (v,r) => v ? `${Number(v).toLocaleString("en-US")} ${unitLabel(r.base_unit || r.unit)} / حصة` : "—"],
                ["inventory_value", "قيمة المخزون", (v, r) => money(inventoryValue(r))],
                ["status", "الحالة", (v, r) => r.active === false ? "مؤرشف" : (isAmbiguousInventoryUnit(r) ? "يحتاج مراجعة الوحدة" : ({out:"نفد",low:"منخفض",available:"متوفر"}[lowStockStatus(r)]))],
              ]}
              rowActions={(r)=><><button className="table-action text-action" onClick={()=>setShow({detailsItem:r})}>التفاصيل</button><button className="table-action text-action" onClick={()=>setShow({historyItem:r})}>الحركات</button>{showArchived && <button className="table-action" onClick={async()=>{try{await api.restoreInventoryItem(r.id);setItems((rows)=>rows.map((item)=>item.id===r.id?{...item,active:true}:item));}catch(error){setToast(error.message);}}}>استعادة المادة</button>}</>}
              onEdit={canEditItems ? (r) => {
                setShow(r);
              } : undefined}
              onDelete={!showArchived && canDeleteItems ? async (r) => {
                if (window.confirm("سيتم إخفاء المادة من المخزون مع الاحتفاظ بسجل الحركات والمشتريات السابقة.")) {
                  try { await api.archiveInventoryItem(r.id); setItems((rows) => rows.map((item) => item.id === r.id ? { ...item, active: false } : item)); } catch (error) { setToast(error.message); }
                }
              } : undefined}
            />
          </>
        ) : tab === "expiry" ? <><div className="filter-pills">{[["all","الكل"],["expired","منتهي"],["7","خلال 7 أيام"],["14","خلال 14 يوم"],["30","خلال 30 يوم"]].map(([v,l])=><button key={v} className={expiryFilter===v?"active":""} onClick={()=>setExpiryFilter(v)}>{l}</button>)}</div><DataTable rows={filterExpiry({batches,filter:expiryFilter})} columns={[["item_id","المادة",v=>items.find(x=>x.id===v)?.name_ar||v],["batch_number","الدفعة"],["remaining_quantity","المتبقي"],["base_unit","الوحدة",unitLabel],["received_date","تاريخ الاستلام"],["expiry_date","تاريخ الانتهاء"],["days","الأيام المتبقية"],["status","الحالة",(v,r)=>({expired:"منتهي",very_soon:"قريب جداً",soon:"قريب",healthy:"سليم"}[expiryStatus(r.days)])]]} rowActions={(r)=><button className="table-action" onClick={()=>setShow({wasteBatch:r})}>تسجيل هدر</button>}/></> : tab === "locations" ? <LocationsPanel locations={locations} setLocations={setLocations} /> : (
          <>
            <div className="toolbar">
              {canMoveStock && <button className="primary" onClick={() => setShow("movement")}>
                <Plus size={17} /> تسجيل حركة
              </button>}
            </div>
            <div className="inventory-movement-mobile-cards">{displayMoves.map((row, index) => <article className="inventory-movement-card" key={row.id || index}><div className="inventory-movement-head"><strong>{row.materialName}</strong><span>{row.movementType}</span></div><p><b>التاريخ:</b> {row.createdAt}</p><p><b>الكمية:</b> {row.quantity}</p><p><b>السبب:</b> {row.reason}</p><p><b>المنتج:</b> {row.productName}</p><p><b>المرجع:</b> {row.saleReference}</p><p><b>قبل / بعد:</b> {row.beforeQuantity ?? "—"} / {row.afterQuantity ?? "—"} {unitLabel(row.unit)}</p></article>)}</div>
            <div className="inventory-movement-table"><DataTable
              rows={displayMoves}
              columns={[
                ["createdAt", "التاريخ"],
                ["movementType", "النوع"],
                ["materialName", "المادة"],
                ["quantity", "الكمية"],
                ["reason", "السبب"],
                ["productName", "المنتج"],
                ["saleReference", "المرجع"],
                ["beforeQuantity", "قبل", (v, r) => `${v ?? "—"} ${unitLabel(r.unit)}`],
                ["afterQuantity", "بعد", (v, r) => `${v ?? "—"} ${unitLabel(r.unit)}`],
              ]}
            /></div>
          </>
        )}
      </Panel>
      {show && (
        <Modal
          title={
            show === "movement"
              ? "تسجيل حركة مخزون"
              : show === "camera" ? "مسح باركود بالكاميرا"
              : show?.unknownBarcode ? "باركود غير مسجل"
              : show === "waste" ? "تسجيل هدر"
              : show === "stocktake" ? "جرد المخزون"
              : show === "transfer" ? "نقل مخزون" : show?.wasteBatch ? "تسجيل هدر من دفعة" : show?.detailsItem ? `تفاصيل وتحليل المادة — ${show.detailsItem.name_ar||show.detailsItem.name}` : show?.historyItem ? `سجل حركة — ${show.historyItem.name_ar||show.historyItem.name}`
              : show === "actionPicker" ? "اختر نوع العملية"
              : show?.id
                ? "تعديل مادة"
                : "إضافة مادة"
          }
          onClose={() => setShow(false)}
        >
          {show === "actionPicker" ? (
            <div style={{ display: 'grid', gap: '15px', padding: '10px 0' }}>
              <button
                className="primary"
                style={{ padding: '15px', fontSize: '15px' }}
                onClick={() => { setTab("items"); setShow(true); }}
              >
                إضافة مادة جديدة
              </button>
              <button
                className="primary"
                style={{ padding: '15px', fontSize: '15px', background: '#e6f3e9', color: '#1b7959' }}
                onClick={() => { setTab("moves"); setShow("movement"); }}
              >
                تسجيل حركة مخزون
              </button>
            </div>
          ) : show === "camera" ? <CameraScanner onFound={async (code) => { try { const found = await api.lookupBarcode(code); setShow(found || { unknownBarcode: normalizeBarcode(code) }); } catch (error) { setToast(error.message); setShow(false); } }} /> : show?.unknownBarcode ? <UnknownBarcode code={show.unknownBarcode} onAdd={() => setShow({ barcode: show.unknownBarcode })} onClose={() => setShow(false)} /> : show?.detailsItem ? <InventoryDetails item={show.detailsItem} categories={cats} movements={moves} analytics={analytics.materials.find((row) => row.item_id === show.detailsItem.id)} onClose={() => setShow(false)} /> : show === "waste" ? <WasteForm items={items} onDone={() => { setShow(false); load(); }} /> : show?.wasteBatch ? <WasteForm items={items} initialBatchId={show.wasteBatch.id} onDone={() => { setShow(false); load(); }} /> : show?.historyItem ? <ItemHistory item={show.historyItem} movements={moves}/> : show === "stocktake" ? <StocktakeForm items={items} onDone={() => { setShow(false); load(); }} /> : show === "transfer" ? <TransferForm items={items} onDone={() => { setShow(false); load(); }} /> : show === "movement" ? (
            <StockForm
              items={items}
              onDone={(message, saved) => {
                setShow(false);
                if (saved?.id) {
                  setItems((rows) => rows.map((item) => item.id === saved.materialId ? { ...item, quantity: saved.afterQuantity } : item));
                  setMoves((rows) => rows.some((row) => row.id === saved.id) ? rows : [saved, ...rows]);
                }
                setToast(message || "تم حفظ حركة المخزون بنجاح");
                load();
              }}
            />
          ) : (
            <InventoryItemForm
              initial={show?.id || show?.barcode ? show : null}
              categories={cats}
              onDone={() => { setShow(false); load(); }}
            />
          )}
        </Modal>
      )}
    </div>
  );
}
function Products(p) {
  const { can = () => false } = p;
  const [rows, setRows] = useState([]), [cats, setCats] = useState([]), [recipes, setRecipes] = useState([]), [q, setQ] = useState(""), [cat, setCat] = useState(""), [recipeFilter, setRecipeFilter] = useState("all"), [show, setShow] = useState(false), [editing, setEditing] = useState(null), [recipeProduct, setRecipeProduct] = useState(null);
  const load = () => Promise.all([api.list("products"), api.list("product_categories"), api.list("product_recipes").catch(() => [])]).then(([a, b, c]) => { setRows(a); setCats(b); setRecipes(c); });
  useEffect(() => { load(); }, []);
  useEffect(() => { const products = api.subscribeCollection("products", setRows); const recipes = api.subscribeCollection("product_recipes", setRecipes, () => setRecipes([])); return () => { products(); recipes(); }; }, []);
  useEffect(() => { if (p.alertTarget?.productId) { const product = rows.find((row) => row.id === p.alertTarget.productId); if (product && can("recipes.manage")) setRecipeProduct(product); } }, [p.alertTarget?.productId, rows]);
  useEffect(() => {
    const handleNewAction = (event) => {
      if (event.detail !== "products") return;
      if (can("products.create") && !p.isMonthClosed) { setEditing(null); setShow(true); }
    };
    document.addEventListener("app:new-action", handleNewAction);
    return () => document.removeEventListener("app:new-action", handleNewAction);
  }, [can, p.isMonthClosed]);
  const categoryName = (id) => cats.find((x) => x.id === id)?.name_ar || cats.find((x) => x.id === id)?.nameAr || "—";
  const hasRecipe = (product) => recipes.some((recipe) => String(recipe.product_id || recipe.id) === String(product.id) && recipe.items?.length);
  const filtered = rows.filter((x) => (!cat || x.category_id === cat || x.categoryId === cat) && (!q || `${x.name_ar || x.nameAr} ${x.name_en || x.nameEn}`.toLowerCase().includes(q.toLowerCase())) && (recipeFilter === "all" || (recipeFilter === "missing" && !hasRecipe(x))));
  return <div className="screen-stack"><Panel title="المنتجات" action="المنتج المباع يختلف عن مادة المخزون"><div className="toolbar"><div className="table-search"><Search size={17} /><input placeholder="بحث في المنتجات..." value={q} onChange={(e) => setQ(e.target.value)} /></div><select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">كل الأقسام</option>{cats.map((x) => <option key={x.id} value={x.id}>{x.name_ar || x.nameAr}</option>)}</select>{can("excel.export") && <button className="secondary" onClick={() => api.exportExcel("products")}> <FileSpreadsheet size={17} /> تصدير Excel</button>}</div><div className="filter-pills"><button className={recipeFilter === "all" ? "active" : ""} onClick={() => setRecipeFilter("all")}>كل المنتجات</button><button className={recipeFilter === "missing" ? "active" : ""} onClick={() => setRecipeFilter("missing")}>منتجات تحتاج وصفة ({rows.filter(r => !hasRecipe(r)).length})</button></div><DataTable rows={filtered} columns={[["name_ar", "الاسم العربي", (v, r) => v || r.nameAr], ["name_en", "الإنجليزي", (v, r) => v || r.nameEn], ["category_id", "القسم", categoryName], ["selling_price", "السعر", (v, r) => money(v ?? r.sellingPrice)], ["recipe", "الوصفة", (_v, r) => hasRecipe(r) ? "محددة" : "الوصفة غير محددة"], ["active", "الحالة", (v) => v === false ? "متوقف" : "فعال"]]} rowActions={(r) => can("recipes.manage") && <button className="table-action text-action" onClick={() => setRecipeProduct(r)}>الوصفة</button>} onEdit={can("products.edit") ? (r) => { setEditing(r); setShow(true); } : undefined} />{can("products.create") && <div className="panel-footer"><button className="primary" onClick={() => { setEditing(null); setShow(true); }}><Plus size={17} /> إضافة منتج</button></div>}</Panel>{show && <Modal title={editing ? "تعديل المنتج" : "إضافة منتج"} onClose={() => setShow(false)}><SmartForm entity="products" initial={editing || { active: true }} lockedFields={[]} onDone={() => { setShow(false); load(); p.setToast?.("تم حفظ المنتج بنجاح"); }} fields={[["name_ar", "الاسم بالعربي"], ["name_en", "الاسم بالإنجليزي"], ["category_id", "القسم", "select", cats.map((x) => [x.id, x.name_ar || x.nameAr])], ["description_ar", "وصف عربي — اختياري", "textarea"], ["description_en", "وصف إنجليزي — اختياري", "textarea"], ["selling_price", "السعر", "number"], ["active", "فعال", "checkbox"]]} /></Modal>}{recipeProduct && <Modal title={`وصفة المكونات — ${recipeProduct.name_ar || recipeProduct.nameAr}`} onClose={() => setRecipeProduct(null)} className="wide-modal"><RecipeEditor product={recipeProduct} /></Modal>}</div>;
}
function RecipeEditor({ product }) { const [inventory,setInventory]=useState([]),[rows,setRows]=useState([]),[metrics,setMetrics]=useState(null),[error,setError]=useState(""); useEffect(()=>{const load=()=>Promise.all([api.list("inventory_items"),api.get(`product_recipes/${product.id}`),api.recipeMetrics(product.id).catch(()=>null)]).then(([i,r,m])=>{setInventory(i);setRows(r?.items||[]);setMetrics(m);}).catch(e=>setError(e.message));load();return api.subscribeCollection("inventory_items",(items)=>setInventory(items),()=>{});},[product.id]); const save=async()=>{try{await api.saveRecipe({product_id:product.id,items:rows});setMetrics(await api.recipeMetrics(product.id));setError(rows.length?"تم حفظ الوصفة":"تمت إزالة الوصفة");}catch(e){setError(e.message)}}; return <div className="screen-stack"><div className="table-wrap"><table><thead><tr><th>اسم المادة</th><th>الكمية لكل حصة</th><th>الوحدة</th><th>التكلفة</th><th>المخزون المتاح</th><th/></tr></thead><tbody>{rows.map((r,i)=>{const item=inventory.find(x=>x.id===r.inventory_item_id);return <tr key={i}><td><select value={r.inventory_item_id||""} onChange={e=>setRows(x=>x.map((v,n)=>n===i?{...v,inventory_item_id:e.target.value}:v))}><option value="">اختر مادة فعالة</option>{inventory.filter(x=>x.active!==false||x.id===r.inventory_item_id).map(x=><option key={x.id} value={x.id}>{x.name_ar||x.name}{x.active===false?" (مؤرشفة)":""}</option>)}</select></td><td><input type="number" min="0.001" value={r.quantity||""} onChange={e=>setRows(x=>x.map((v,n)=>n===i?{...v,quantity:e.target.value}:v))}/></td><td>{unitLabel(item?.base_unit||item?.unit)}</td><td>{money(Number(r.quantity||0)*inventoryBaseUnitCost(item))}</td><td>{inventoryQuantity(item)}</td><td><button className="table-action danger" onClick={()=>setRows(x=>x.filter((_,n)=>n!==i))}>×</button></td></tr>})}</tbody></table></div><button className="secondary" onClick={()=>setRows(x=>[...x,{inventory_item_id:"",quantity:""}])}>إضافة مكوّن</button>{metrics?<div className="notice">الكمية المتاحة تقريباً: <strong>{metrics.available_servings ?? "الوصفة غير مكتملة"}</strong><br/>سعر البيع: {money(metrics.selling_price)} · تكلفة الوصفة: {money(metrics.cost)} · الربح الإجمالي: {money(metrics.gross_profit)} · هامش الربح: {metrics.gross_margin===null?"—":`${Math.round(metrics.gross_margin)}%`}</div>:<div className="notice">{rows.length?"الوصفة غير مكتملة":"الوصفة غير محددة"}</div>}{error&&<div className="notice">{error}</div>}<div className="toolbar"><button className="primary" onClick={save}>حفظ الوصفة</button></div></div>; }
function RecipeConsumption({ product, metrics, onClose }) { const [quantity,setQuantity]=useState(""),[date,setDate]=useState(today()),[notes,setNotes]=useState(""),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(""); const amount=Number(quantity||0), lines=(metrics?.ingredients||[]).map(x=>({...x,required:Number(x.base_quantity||0)*amount,remaining:Number(x.available_quantity||0)-Number(x.base_quantity||0)*amount})); const insufficient=lines.find(x=>x.remaining<0); const submit=async()=>{try{const operation_id=crypto.randomUUID?.()||`${Date.now()}`; const source_key=`manual_recipe_consumption:${operation_id}`; await api.consumeRecipe(product.id,amount,{operation_id,source_type:"manual_recipe_consumption",source_id:operation_id,source_key,month:date.slice(0,7),notes});onClose();}catch(e){setError(e.message)}}; return <section className="notice"><div className="smart-form"><label><span>المنتج</span><input readOnly value={product.name_ar||product.name}/></label><label><span>الكمية</span><input type="number" min="0.01" value={quantity} onChange={e=>{setQuantity(e.target.value);setConfirmed(false)}}/></label><label><span>التاريخ</span><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label><span>ملاحظات</span><input value={notes} onChange={e=>setNotes(e.target.value)}/></label>{amount>0&&<div className="wide"><strong>معاينة الاستهلاك</strong>{lines.map(x=><div key={x.inventory_item_id}>{x.item_name}: الحالي {Number(x.available_quantity||0)} {x.base_unit} · المطلوب -{x.required} · المتبقي {x.remaining}</div>)}{insufficient&&<div className="error">المخزون غير كافٍ: {insufficient.item_name}</div>}</div>}{error&&<div className="error wide">{error}</div>}<div className="wide toolbar">{!confirmed?<button type="button" className="secondary" disabled={!amount||!!insufficient} onClick={()=>setConfirmed(true)}>مراجعة قبل الخصم</button>:<button type="button" className="primary" onClick={submit}>تأكيد الاستهلاك</button>}<button type="button" className="secondary" onClick={onClose}>إلغاء</button></div></div></section>; }
function Suppliers(p) {
  const [rows, setRows] = useState([]), [query, setQuery] = useState(""), [type, setType] = useState(""), [status, setStatus] = useState(""), [show, setShow] = useState(false), [editing, setEditing] = useState(null), [profile, setProfile] = useState(null);
  const load = () => api.list("suppliers").then(setRows).catch(() => setRows([])); useEffect(() => { load(); }, []);
  useEffect(() => {
    const handleNewAction = (event) => {
      if (event.detail !== "suppliers") return;
      if (p.can("suppliers.create") && !p.isMonthClosed) { setEditing(null); setShow(true); }
    };
    document.addEventListener("app:new-action", handleNewAction);
    return () => document.removeEventListener("app:new-action", handleNewAction);
  }, [p.can, p.isMonthClosed]);
  const filtered = rows.filter((row) => (!type || row.type === type) && (!status || (row.status || "active") === status) && `${row.name || ""} ${row.phone || ""}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="screen-stack"><Panel title="التجار والشركات" action="إدارة السجلات المرتبطة بالمشتريات"><div className="toolbar"><div className="table-search"><Search size={17} /><input placeholder="بحث بالاسم أو رقم الهاتف..." value={query} onChange={(e) => setQuery(e.target.value)} /></div><select aria-label="النوع" value={type} onChange={(e) => setType(e.target.value)}><option value="">كل الأنواع</option><option value="trader">تجار</option><option value="company">شركات</option></select><select aria-label="الحالة" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">كل الحالات</option><option value="active">فعال</option><option value="inactive">غير فعال</option></select>{p.can("suppliers.create") && <button className="primary" onClick={() => { setEditing(null); setShow(true); }}><Plus size={17} /> إضافة تاجر أو شركة</button>}</div>{filtered.length ? <DataTable rows={filtered} columns={[["name", "الاسم"], ["type", "النوع", (v) => v === "company" ? "شركة" : "تاجر"], ["phone", "رقم الهاتف"], ["address", "العنوان"], ["status", "الحالة", (v) => v === "inactive" ? "غير فعال" : "فعال"]]} rowActions={(row) => <button className="table-action" onClick={() => setProfile(row)}>عرض</button>} onEdit={p.can("suppliers.edit") ? (row) => { setEditing(row); setShow(true); } : undefined} /> : <div className="empty"><strong>لا توجد بيانات بعد</strong><span>أضف تاجرًا أو شركة لربطها بالمشتريات.</span>{p.can("suppliers.create") && <button className="primary" onClick={() => setShow(true)}>إضافة تاجر أو شركة</button>}</div>}</Panel>{show && <Modal title={editing ? "تعديل التاجر / الشركة" : "إضافة تاجر / شركة"} onClose={() => setShow(false)}><SupplierForm initial={editing || { status: "active" }} onDone={(saved) => { setShow(false); load(); p.setToast?.(editing ? "تم تحديث التاجر/الشركة بنجاح" : "تم إنشاء التاجر/الشركة بنجاح"); }} /></Modal>}{profile && <SupplierProfile supplier={profile} onClose={() => setProfile(null)} />}</div>;
}
function SupplierForm({ initial = {}, onDone }) {
  const [form, setForm] = useState({ status: "active", type: "trader", ...initial });
  const [categories, setCategories] = useState([]), [error, setError] = useState("");
  useEffect(() => { api.list("inventory_categories").then(setCategories).catch((e) => setError(e.message)); }, []);
  const rawSelected = form.inventory_category_ids ?? form.category_ids ?? form.specialty_category_ids ?? [];
  const selected = (Array.isArray(rawSelected) ? rawSelected : rawSelected ? [rawSelected] : []).map(String);
  const toggle = (id) => setForm((old) => ({ ...old, inventory_category_ids: selected.includes(String(id)) ? selected.filter((x) => x !== String(id)) : [...selected, String(id)] }));
  const save = async (event) => { event.preventDefault(); try { const payload = { ...form, inventory_category_ids: selected }; const saved = form.id ? await api.update("suppliers", form.id, payload) : await api.create("suppliers", payload); onDone(saved); } catch (e) { setError(e.message); } };
  return <form className="smart-form" onSubmit={save}>{[["name", "الاسم"], ["phone", "رقم الهاتف"], ["address", "العنوان"], ["notes", "ملاحظات"]].map(([key, label]) => <label key={key}><span>{label}</span><input required={key === "name"} value={form[key] || ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>)}<SelectField label="النوع" value={form.type} onChange={(v) => setForm({ ...form, type: v })}><option value="trader">تاجر</option><option value="company">شركة</option></SelectField><SelectField label="الحالة" value={form.status} onChange={(v) => setForm({ ...form, status: v })}><option value="active">فعال</option><option value="inactive">غير فعال</option></SelectField><fieldset className="wide"><legend>اختصاص التاجر — أقسام مواد المخزون</legend>{categories.length ? <div className="check-grid">{categories.filter((category) => category.active !== false).map((category) => <label className="check-label" key={category.id}><input type="checkbox" checked={selected.includes(String(category.id))} onChange={() => toggle(category.id)} /><span>{category.name_ar || category.nameAr || category.name}</span></label>)}</div> : <small>لا توجد أقسام مخزون متاحة.</small>}</fieldset>{error && <div className="error wide">{error}</div>}<button className="primary wide"><Check size={17} /> حفظ التاجر والاختصاص</button></form>;
}
function SupplierProfile({ supplier, onClose }) { const [purchases, setPurchases] = useState([]); useEffect(() => { api.list("purchases").then((rows) => setPurchases(rows.filter((row) => row.supplier_id === supplier.id))).catch(() => setPurchases([])); }, [supplier.id]); return <Modal title={`ملف — ${supplier.name || ""}`} onClose={onClose}><div className="profile-grid">{[["الاسم", supplier.name], ["رقم الهاتف", supplier.phone], ["النوع", supplier.type === "company" ? "شركة" : "تاجر"], ["العنوان", supplier.address], ["الحالة", supplier.status === "inactive" ? "غير فعال" : "فعال"], ["الملاحظات", supplier.notes]].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value || "—"}</strong></div>)}</div><Panel title="المشتريات المرتبطة">{purchases.length ? <DataTable rows={purchases} columns={[["date", "التاريخ"], ["item_name", "الوصف", (v, r) => r.product_name || r.inventory_item_name || v || "—"], ["total_after_discount", "المبلغ", money], ["payment_method", "طريقة الدفع"]]} /> : <Empty text="لا توجد مشتريات مرتبطة بهذا السجل" />}</Panel></Modal>; }
function LegacyLinkHost({ setToast }) {
  const [row, setRow] = useState(null), [employees, setEmployees] = useState([]), [query, setQuery] = useState(""), [selected, setSelected] = useState(null), [creating, setCreating] = useState(false), [similar, setSimilar] = useState([]);
  useEffect(() => { const open = (event) => { setRow(event.detail); setSelected(null); setCreating(false); setQuery(""); api.list("employees").then(setEmployees).catch(() => setEmployees([])); }; window.addEventListener("legacy:link", open); return () => window.removeEventListener("legacy:link", open); }, []);
  useEffect(() => { const created = async (event) => { if (!row || !event.detail?.id) return; try { await api.linkLegacyEmployee({ entity: "payroll", id: row.id, employeeId: event.detail.id }); setToast?.("تم إنشاء ملف الموظف وربطه بنجاح"); window.dispatchEvent(new CustomEvent("legacy:linked")); setRow(null); } catch { setToast?.("تعذر ربط السجل بملف الموظف"); } }; window.addEventListener("employee:created", created); return () => window.removeEventListener("employee:created", created); }, [row]);
  if (!row) return null;
  const normalized = (value) => String(value || "").trim().toLowerCase().replace(/[ًٌٍَُِّْـ]/g, "").replace(/[إأآ]/g, "ا").replace(/\s+/g, " ");
  const results = employees.filter((employee) => `${employee.name || ""} ${employee.phone || ""}`.toLowerCase().includes(query.toLowerCase()));
  const close = () => setRow(null);
  const link = async (employee) => { try { await api.linkLegacyEmployee({ entity: "payroll", id: row.id, employeeId: employee.id }); setToast?.("تم ربط السجل بملف الموظف بنجاح"); window.dispatchEvent(new CustomEvent("legacy:linked")); close(); } catch { setToast?.("تعذر ربط السجل بملف الموظف"); } };
  const create = async (form) => { const matches = employees.filter((employee) => normalized(employee.name) === normalized(form.name)); if (matches.length && !similar.length) { setSimilar(matches); return; } try { const employee = await api.create("employees", { ...form, status: form.status || "active" }); await link(employee); } catch { setToast?.("تعذر إنشاء ملف الموظف"); } };
  return <Modal title="ربط بملف موظف" onClose={close}>{!creating && !similar.length && <><div className="legacy-summary"><strong>{row.employee_name || row.employee || "موظف Legacy"}</strong><span>الشهر: {row.month || "—"}</span><span>القيمة التاريخية: {row.base_salary || row.net || "غير متاحة"}</span></div><label className="legacy-search"><span>ابحث بالاسم أو رقم الهاتف</span><input value={query} onChange={(e) => setQuery(e.target.value)} /></label><div className="profile-list">{results.map((employee) => <div key={employee.id}><div><strong>{employee.name}</strong><span>{employee.phone || "—"} · {employee.job_title || "—"} · {money(employee.base_salary)}</span></div><button className="primary" onClick={() => setSelected(employee)}>اختيار</button></div>)}</div>{selected && <div className="notice"><div><strong>سيتم ربط السجل التاريخي بـ {selected.name}</strong><span>لن يتم تغيير البيانات التاريخية القديمة.</span></div><button className="primary" onClick={() => link(selected)}>تأكيد الربط</button></div>}<button className="secondary wide" onClick={() => setCreating(true)}>إنشاء ملف موظف جديد</button></>}{similar.length > 0 && <div className="duplicate-warning"><strong>يوجد موظف مشابه مسجل مسبقاً</strong>{similar.map((employee) => <div className="profile-list" key={employee.id}><div><strong>{employee.name}</strong><span>{employee.phone || "—"} · {employee.job_title || "—"} · {money(employee.base_salary)}</span></div><button className="primary" onClick={() => { setSimilar([]); link(employee); }}>استخدام الموظف الموجود</button></div>)}<button className="secondary" onClick={() => setSimilar([])}>إنشاء ملف جديد رغم ذلك</button></div>}{creating && <SmartForm entity="employees" initial={{ name: row.employee_name || row.employee || "", status: "active" }} onDone={async () => { setCreating(false); setToast?.("تم إنشاء ملف الموظف وربطه بنجاح"); close(); }} fields={[["name", "الاسم"], ["phone", "رقم الهاتف"], ["address", "العنوان"], ["job_title", "المسمى الوظيفي"], ["department", "القسم"], ["base_salary", "الراتب الأساسي"], ["hire_date", "تاريخ المباشرة", "date"], ["status", "الحالة", "select", [["active", "فعال"], ["inactive", "غير فعال"]]], ["notes", "الملاحظات"]]} />}</Modal>;
}
function Assets(p) {
  return page(
    p,
    "الأصول",
    "المعدات والأثاث والأجهزة",
    "assets",
    [
      ["name", "الأصل"],
      ["category", "التصنيف"],
      ["purchase_date", "تاريخ الشراء"],
      ["purchase_price", "سعر الشراء", money],
      ["status", "الحالة"],
    ],
    [
      ["name", "اسم الأصل"],
      ["category", "التصنيف"],
      ["purchase_date", "تاريخ الشراء", "date"],
      ["purchase_price", "سعر الشراء"],
      ["status", "الحالة"],
    ],
    "إضافة أصل",
  );
}
function Cash(p) {
  const { selectedMonth = currentMonth(), can = () => false, setToast } = p;
  const [review, setReview] = useState(null);
  const [ownerModal, setOwnerModal] = useState(null);
  const loadReview = () => api.cashMonthReview(selectedMonth).then(setReview).catch((error) => setToast?.(error.message));
  useEffect(() => { loadReview(); }, [selectedMonth]);
  const ownerSave = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const payload = { amount: form.get('amount'), date: form.get('date'), month: selectedMonth, notes: form.get('notes') };
      if (ownerModal === 'deposit') await api.createOwnerDeposit(payload); else await api.createOwnerWithdrawal(payload);
      setOwnerModal(null); await loadReview(); setToast?.(ownerModal === 'deposit' ? 'تم تسجيل إيداع مالك' : 'تم تسجيل سحب مالك');
    } catch (error) { setToast?.(error.message); }
  };
  return <div className="screen-stack">
    {review && <Panel title="رصيد الصندوق" action={`الفترة: ${selectedMonth}`}><div className="report-summary-grid cash-balance-cards">
      {[['الرصيد الافتتاحي', review.openingCash], ['الوارد النقدي', review.cashIn], ['الخارج النقدي', review.cashOut], ['رصيد الصندوق المتوقع', review.expectedClosingCash], ['صافي النقد', review.cashIn - review.cashOut]].map(([label, value]) => <div className="report-summary-card" key={label}><span>{label}</span><strong>{money(value)}</strong></div>)}
    </div><div className="toolbar"><span className="muted">الإلكتروني والبطاقات لا تغيّر الرصيد الفيزيائي.</span>{can('cash.owner_deposit') && <button className="secondary" onClick={() => setOwnerModal('deposit')}>إيداع مالك</button>}{can('cash.owner_withdrawal') && <button className="secondary" onClick={() => setOwnerModal('withdrawal')}>سحب مالك</button>}</div></Panel>}
    {review && <Panel title="مراجعة إغلاق الشهر"><div className="review-list"><div>الرصيد المرحّل: <b>{money(review.carriedForward)}</b></div><div>الفرق المسجل: <b>{review.difference == null ? '—' : money(review.difference)}</b></div></div></Panel>}
    {ownerModal && <Modal title={ownerModal === 'deposit' ? 'إيداع مالك' : 'سحب مالك'} onClose={() => setOwnerModal(null)}><form className="smart-form" onSubmit={ownerSave}><label><span>المبلغ</span><input name="amount" type="number" min="1" required /></label><label><span>التاريخ</span><input name="date" type="date" defaultValue={today()} required /></label><label className="wide"><span>ملاحظات</span><input name="notes" /></label><button className="primary wide">حفظ العملية</button></form></Modal>}
    {page(
    { ...p, pageId: "cash" },
    "حركة الصندوق",
    "الإدخال والإخراج النقدي",
    "cash_movements",
    [
      ["date", "التاريخ"],
      ["type", "النوع", (value) => cashTypeLabel(value)],
      ["amount", "المبلغ", money],
      ["reason", "السبب"],
      ["payment_method", "طريقة الدفع", (value) => paymentMethodLabel(value)],
    ],
    [
      ["date", "التاريخ", "date"],
      ["type", "النوع", (value) => cashTypeLabel(value)],
      ["amount", "المبلغ"],
      ["reason", "السبب"],
      ["payment_method", "طريقة الدفع", (value) => paymentMethodLabel(value)],
    ],
    "إضافة حركة",
  )}</div>;
}
function Payroll(p) {
  const { selectedMonth = currentMonth(), can = () => false, setToast, isMonthClosed = false } = p;
  const [rows, setRows] = useState([]), [adjustments, setAdjustments] = useState([]), [payments, setPayments] = useState([]), [legacyAdvances, setLegacyAdvances] = useState([]), [debts, setDebts] = useState([]), [filter, setFilter] = useState("all"), [query, setQuery] = useState(""), [modal, setModal] = useState(null), [busy, setBusy] = useState(false);
  const load = async () => { try { const [payroll, adj, pay, legacy, employees, debtRows] = await Promise.all([api.list("payroll"), api.list("payroll_adjustments").catch(() => []), api.list("payroll_payments").catch(() => []), api.list("employee_advances").catch(() => []), api.list("employees").catch(() => []), api.list("employee_debts").catch(() => [])]); const employeeById = new Map(employees.map((employee) => [employee.id || employee.employee_id, employee])); const allRows = buildPayrollRows({ payroll, employees, month: selectedMonth }); setRows(await Promise.all(allRows.map((row) => api.calculatePayrollWithDebts({ payroll: row, adjustments: adj, payments: pay, debts: debtRows, employee: employeeById.get(row.employee_id || row.employee), month: selectedMonth })))); setAdjustments(adj); setPayments(pay); setDebts(debtRows); setLegacyAdvances(recordsForMonth(legacy, selectedMonth)); } catch (e) { setRows([]); setToast?.(e.message); } };
  useEffect(() => { load(); }, [selectedMonth]);
  useEffect(() => { const handler = (event) => setModal({ type: 'link', row: event.detail }); document.addEventListener('legacy:link', handler); return () => document.removeEventListener('legacy:link', handler); }, []);
  const totals = rows.reduce((a, row) => ({ base: a.base + Number(row.base_salary_snapshot || 0), additions: a.additions + row.additions_total, bonuses: a.bonuses + row.bonuses_total, deductions: a.deductions + row.deductions_total, advances: a.advances + row.advances_total, net: a.net + row.net_salary, paid: a.paid + row.paid_amount, remaining: a.remaining + row.remaining_amount }), { base: 0, additions: 0, bonuses: 0, deductions: 0, advances: 0, net: 0, paid: 0, remaining: 0 });
  const visible = rows.filter((row) => (filter === "all" || row.status === filter) && (!query || String(row.employee_name || row.employee || "").toLowerCase().includes(query.toLowerCase())));
  const action = (row, type) => setModal({ type, row });
  const unlinkedAction = (row, type) => setModal({ type, row });
  return <div className="screen-stack"><Panel title="رواتب الموظفين" action={`كشف ${monthLabel(selectedMonth)}`}><div className="toolbar"><div className="table-search"><Search size={17} /><input placeholder="بحث باسم الموظف..." value={query} onChange={(e) => setQuery(e.target.value)} /></div>{can("payroll.create") && <button className="primary" disabled={busy || isMonthClosed} onClick={async () => { setBusy(true); try { const count = await api.createPayrollForMonth(selectedMonth); setToast?.(`تم إنشاء ${count} كشف راتب`); await load(); } catch (e) { setToast?.(e.message); } finally { setBusy(false); } }}><Plus size={17} /> إنشاء كشف الشهر</button>}</div><div className="filter-pills"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>كل الموظفين</button><button className={filter === "unpaid" ? "active" : ""} onClick={() => setFilter("unpaid")}>لم يستلم</button><button className={filter === "partial" ? "active" : ""} onClick={() => setFilter("partial")}>استلام جزئي</button><button className={filter === "paid" ? "active" : ""} onClick={() => setFilter("paid")}>تم الاستلام</button></div><div className="payroll-cards">{[["الأساسية", totals.base], ["المكافآت", totals.bonuses], ["الخصومات", totals.deductions], ["الديون", rows.reduce((n, r) => n + r.debts_total, 0)], ["المستحق", totals.net], ["المدفوع", totals.paid], ["المتبقي", totals.remaining]].map(([label, value]) => <div className="payroll-card" key={label}><span>{label}</span><strong>{money(value)}</strong></div>)}</div><DataTable rows={visible} columns={[["employee_name", "الموظف", (v, r) => <span>{v || r.employee || "—"}{r.virtual ? <small className="unlinked-employee">كشف افتراضي — اضغط «إنشاء كشف الشهر» لتثبيت Snapshot</small> : !r.employee_id && <small className="unlinked-employee">غير مربوط بملف موظف</small>}</span>],["resolved_base_salary", "الأساسي", (v, r) => <span title={`المصدر: ${salarySourceLabel(r.base_salary_source)}`}>{money(v)}</span>],["bonuses_total", "مكافآت", money],["deductions_total", "خصومات", money],["debts_total", "الديون", money],["net_salary", "المستحق", money],["paid_amount", "المدفوع", money],["remaining_amount", "المتبقي", money],["status", "الحالة", (v) => <span className={`status-badge status-${v}`}>{statusLabel(v)}</span>]]} actionsDisabled={isMonthClosed} rowActions={(row) => <div className="payroll-actions">{can("payroll.add_bonus") && <button className="table-action action-bonus" onClick={() => action(row, "bonus")}>+ مكافأة</button>}{can("payroll.add_deduction") && <button className="table-action action-deduction" onClick={() => action(row, "deduction")}>- خصم</button>}{can("employee_debts.create") && <button className="table-action action-debt" onClick={() => action(row, "debt")}>دين</button>}{can("payroll.pay") && <button className="table-action action-payment" disabled={!row.employee_id || row.virtual} onClick={() => row.employee_id && !row.virtual && action(row, "payment")}>{row.virtual ? "ثبّت الكشف أولاً" : row.employee_id ? (row.remaining_amount > 0 ? "تم الاستلام" : "دفع المتبقي") : "غير مربوط"}</button>}<button className="table-action action-history" onClick={() => action(row, "history")}>عرض الحركات</button></div>} /></Panel>{modal && <Modal title={modal.type === "history" ? `حركات راتب — ${modal.row.employee_name || modal.row.employee || "الموظف"}` : `${actionLabel(modal.type)} — ${modal.row.employee_name || modal.row.employee || "الموظف"}`} onClose={() => setModal(null)}>{modal.type === "history" ? <PayrollTimeline row={modal.row} adjustments={adjustments} payments={payments} legacyAdvances={legacyAdvances} debts={debts} /> : <PayrollActionForm modal={modal} selectedMonth={selectedMonth} isMonthClosed={isMonthClosed} onDone={async () => { setModal(null); await load(); setToast?.("تم حفظ حركة الراتب"); }} />}</Modal>}</div>;
}
const statusLabel = (status) => ({ unpaid: "لم يستلم", partial: "استلام جزئي", paid: "تم الاستلام" }[status] || "لم يستلم");
const salarySourceLabel = (source) => ({ employee: "راتب الموظف الحالي", snapshot: "Snapshot الشهر", legacy: "Legacy تاريخي", unavailable: "غير متاح" }[source] || "غير متاح");
const actionLabel = (type) => ({ bonus: "مكافأة", deduction: "خصم", debt: "دين", payment: "دفع راتب" }[type] || "حركة راتب");
function PayrollActionForm({ modal, selectedMonth, onDone, isMonthClosed = false }) { const [form, setForm] = useState({ date: today(), amount: modal.type === "payment" ? modal.row.remaining_amount : "", payment_method: "cash", reason: "", notes: "" }); const set = (key, value) => setForm((old) => ({ ...old, [key]: value })); const save = async (e) => { e.preventDefault(); try { if (isMonthClosed) throw new Error("هذا الشهر مغلق. أعد فتح الشهر أولاً للتعديل."); if (!modal.row.employee_id) throw new Error("تعذر حفظ الحركة لأن الموظف غير مربوط بملف موظف."); if (modal.type === "payment") await api.addPayrollPayment({ payroll_id: modal.row.id, employee_id: modal.row.employee_id, month: selectedMonth, ...form }); else if (modal.type === "debt") await api.addEmployeeDebt({ employee_id: modal.row.employee_id, month: selectedMonth, ...form }); else await api.addPayrollAdjustment({ payroll_id: modal.row.id, employee_id: modal.row.employee_id, employee_name: modal.row.employee_name, month: selectedMonth, type: modal.type, source: "manual", ...form }); onDone(); } catch (error) { alert(error.message); } }; return <form className="smart-form" onSubmit={save}><label><span>المبلغ</span><input required type="number" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} /></label><label><span>التاريخ</span><input required type="date" value={form.date} onChange={(e) => set("date", e.target.value)} /></label>{(modal.type === "payment" || modal.type === "debt") && <label><span>طريقة الدفع</span><select value={form.payment_method} onChange={(e) => set("payment_method", e.target.value)}>{PAYMENT_METHODS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}<label className="wide"><span>{modal.type === "payment" ? "ملاحظات" : "السبب"}</span><input value={modal.type === "payment" ? form.notes : form.reason} onChange={(e) => set(modal.type === "payment" ? "notes" : "reason", e.target.value)} /></label><button className="primary wide" disabled={isMonthClosed}><Check size={17} /> حفظ</button></form>; }
function PayrollTimeline({ row, adjustments, payments, legacyAdvances, debts = [] }) { const name = String(row.employee_name || row.employee || ""); const events = [{ type: "base", label: "الراتب الأساسي", amount: Number(row.base_salary_snapshot || row.base_salary || 0), date: `${row.month}-01`, reason: "Snapshot الشهر" }, ...adjustments.filter((item) => item.payroll_id === row.id || (item.employee_id === row.employee_id && item.month === row.month)).map((item) => ({ type: item.type, label: actionLabel(item.type), amount: item.type === "deduction" ? -Number(item.amount || 0) : Number(item.amount || 0), date: item.date || item.created_at, reason: item.reason, user: item.created_by })), ...debts.filter((item) => item.employee_id === row.employee_id).map((item) => ({ type: "debt", label: item.status === "settled" ? "تسوية دين" : "دين", amount: -Number(item.amount || 0), date: item.date || item.created_at, reason: item.reason, user: item.created_by })), ...payments.filter((item) => item.payroll_id === row.id).map((item) => ({ type: "payment", label: "دفعة راتب", amount: Number(item.amount || 0), date: item.date || item.created_at, reason: item.notes, payment_method: item.payment_method, user: item.created_by })), ...legacyAdvances.filter((item) => !item.source_id && String(item.employee_id || item.employee || item.employee_name || "") === String(row.employee_id || name)).map((item) => ({ type: "advance", label: "سحب قديم / Legacy", amount: -Number(item.amount ?? item.advance ?? 0), date: item.date, reason: "Legacy employee withdrawal", user: item.created_by }))].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))); return <div className="payroll-timeline">{events.map((event, index) => <div className={`timeline-item timeline-${event.type}`} key={`${event.type}-${event.date}-${event.amount}-${index}`}><span className="timeline-dot" /><div><strong>{event.label}</strong><b>{event.amount > 0 ? "+" : ""}{money(event.amount)}</b><small>{event.date || "—"}{event.reason ? ` · السبب: ${event.reason}` : ""}{event.payment_method ? ` · ${event.payment_method}` : ""}{event.user ? ` · المستخدم: ${event.user}` : ""}</small></div></div>)}</div>; }
function Reports({ setToast, reportRange = { mode: "month", month: currentMonth() } }) {
  const [data, setData] = useState(null);
  useEffect(() => { let mounted = true; api.reportRange(reportRange).then((next) => mounted && setData(next)).catch((e) => { if (mounted) setToast(e.message); }); return () => { mounted = false; }; }, [JSON.stringify(reportRange)]);
  const label = reportRange.mode === "custom" ? `${reportRange.fromDate} — ${reportRange.toDate}` : monthLabel(reportRange.month);
  const summary = data?.summary || {};
  const exportReport = async (entity) => { try { await api.exportExcel(entity, reportRange); setToast("تم تنزيل ملف Excel مبسط"); } catch (e) { setToast(e.message); } };
  return (
    <div className="screen-stack">
      <section className="panel report-period-panel"><div><p className="eyebrow">الفترة المحددة</p><h2>{label}</h2></div><span>من تاريخ البداية إلى تاريخ النهاية — الحدود شاملة</span></section>
      {data && <Panel title="ملخص الفترة" action="البيانات الفعلية داخل الفترة المحددة"><div className="report-summary-grid">{[["الوارد الكلي", summary.netSales], ["المشتريات", summary.purchases], ["المصروفات", summary.expenses], ["الإيرادات الأخرى", summary.otherIncome], ["مدفوعات الرواتب خلال الفترة", summary.payrollPayments], ["إجمالي الديون عليّ", summary.debtsPayable], ["إجمالي الديون إليّ", summary.debtsReceivable], ["المتأخر عليّ", summary.overduePayable], ["المتأخر إليّ", summary.overdueReceivable], ["المسدد خلال الفترة", summary.debtSettledDuringRange], ["صافي النتيجة للفترة", summary.netResult]].map(([title, value]) => <div className="report-summary-card" key={title}><span>{title}</span><strong>{money(value)}</strong></div>)}</div></Panel>}
      <Panel title="التقارير" action="تقارير مالية ومخزون وموظفين">
        <div className="report-grid">
          {[
            ["المبيعات", "sales"], ["المشتريات", "purchases"], ["المصروفات", "expenses"], ["المخزون", "inventory"], ["الرواتب", "payroll"], ["الديون عليّ وإليّ", "debts"], ["تسويات الديون", "debtPayments"], ["تقرير الفترة الكامل", "all"],
          ].map(([x, entity]) => (
            <button
              key={x}
              className="report-card"
              onClick={() => {
                exportReport(entity);
              }}
            >
              <FileSpreadsheet size={22} />
              <strong>{x}</strong>
              <span>تصدير XLSX</span>
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}
function Imports({ setToast }) {
  const [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [importType, setImportType] = useState("auto");
  const normalizeLegacy = (value) => String(value ?? "").trim().toLowerCase().replace(/[\u064B-\u065F]/g, "").replace(/\s+/g, " ");
  const excelDate = (value) => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
    if (typeof value === "number" && Number.isFinite(value)) {
      const wholeDays = Math.floor(value);
      // Excel's serial epoch, with the 1900 leap-year compatibility offset.
      // Use UTC only so the local timezone cannot shift the displayed day.
      const date = new Date(Date.UTC(1899, 11, 30 + wholeDays));
      if (!Number.isNaN(date.getTime())) return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    }
    const match = String(value ?? "").trim().match(/(\d{4})[-\/]([01]?\d)[-\/]([0-3]?\d)/);
    return match ? `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}` : "";
  };
  const numberValue = (value) => { if (value === "" || value == null) return null; const n = Number(String(value).replace(/,/g, "").trim()); return Number.isFinite(n) ? n : null; };
  const headerText = (value) => normalizeLegacy(value).replace(/\u0640/g, "");
  const findHeader = (rows, expected) => rows.findIndex((row) => expected.every((header) => row.some((cell) => headerText(cell) === headerText(header))));
  const legacyPreview = async (file, wb) => {
    const raw = Object.fromEntries(wb.SheetNames.map((name) => [name, XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: true })]));
    const s1 = raw["ورقة1"] || [], s2 = raw["ورقة2"] || [], s3 = raw["ورقة3"] || [];
    const h1 = findHeader(s1, ["التاريخ", "المبلغ", "خصم", "ايرادات"]), h2 = findHeader(s2, ["التاريخ", "القسم", "تفاصيل", "السعر"]), h3 = findHeader(s3, ["الراتب الاسمي", "عدد الايام", "الاجازات", "السحب"]);
    if (h1 < 0 || h2 < 0 || h3 < 0) return null;
    const rowsFor = (rows, headerRow) => rows.slice(headerRow + 1).map((row, index) => ({ row, source_row: headerRow + index + 2 }));
    const readCell = (row, headers, name) => { const index = headers.findIndex((header) => headerText(header) === headerText(name)); return index >= 0 ? row[index] ?? "" : name === "اسم الموظف" ? row[0] ?? "" : ""; };
    const headers1 = s1[h1], headers2 = s2[h2], headers3 = s3[h3];
    const raw1 = rowsFor(s1, h1), raw2 = rowsFor(s2, h2), raw3 = rowsFor(s3, h3);
    const carry = raw1.find(({ row }) => String(readCell(row, headers1, "التاريخ")).trim() === "المتبقي من الشهر السابق");
    const carryoverValue = s1.slice(0, h1).flat().map(numberValue).find((value) => value != null) ?? (carry ? numberValue(readCell(carry.row, headers1, "المجموع")) : null);
    const hasContent = (row) => row.some((cell) => cell instanceof Date || (typeof cell === "number" ? cell !== 0 : String(cell ?? "").trim() !== ""));
    const summaryRows = raw1.map(({ row, source_row }) => ({ source_row, date: excelDate(readCell(row, headers1, "التاريخ")), amount: numberValue(readCell(row, headers1, "المبلغ")), discount: numberValue(readCell(row, headers1, "خصم")), revenue: numberValue(readCell(row, headers1, "ايرادات")), electronic: numberValue(readCell(row, headers1, "الكتروني")), purchases: numberValue(readCell(row, headers1, "مشتريات")), payroll: numberValue(readCell(row, headers1, "رواتب")), total: numberValue(readCell(row, headers1, "المجموع")) })).filter((row) => row.date);
    const detailRows = raw2.map(({ row, source_row }) => ({ source_row, date: excelDate(readCell(row, headers2, "التاريخ")), source_category: String(readCell(row, headers2, "القسم")).trim(), source_details: String(readCell(row, headers2, "تفاصيل")).trim(), amount: numberValue(readCell(row, headers2, "السعر")) })).filter((row) => row.date || row.source_category || row.source_details || row.amount != null);
    const payrollRows = raw3.map(({ row, source_row }) => ({ source_row, employee_name: String(readCell(row, headers3, "اسم الموظف")).trim(), base_salary: numberValue(readCell(row, headers3, "الراتب الاسمي")), days: numberValue(readCell(row, headers3, "عدد الايام")), leave_days: numberValue(readCell(row, headers3, "الاجازات")), advance: numberValue(readCell(row, headers3, "السحب")), deductions: numberValue(readCell(row, headers3, "خصم")), net: numberValue(readCell(row, headers3, "الصافي")) })).filter((row) => row.employee_name);
    const dates = summaryRows.concat(detailRows).map((row) => row.date).filter(Boolean).sort();
    const month = dates[0]?.slice(0, 7) || "";
    const duplicateRows = (rows, key) => { const keys = rows.map(key).filter(Boolean); return keys.length - new Set(keys).size; };
    const invalidDetails = (rows, predicate, reason) => rows.filter(({ row }) => hasContent(row) && !predicate(row)).map(({ row, source_row }) => ({ source_row, reason: reason(row) }));
    const summaryValid = (row) => {
      const date = excelDate(readCell(row, headers1, "التاريخ"));
      const carryover = String(readCell(row, headers1, "التاريخ")).trim() === "المتبقي من الشهر السابق";
      const hasPrimaryAmount = ["المبلغ", "ايرادات", "المجموع"].some((field) => numberValue(readCell(row, headers1, field)) != null);
      return carryover || (date && hasPrimaryAmount);
    };
    const summaryInvalid = invalidDetails(raw1, summaryValid, () => "يجب توفر التاريخ ومبلغ أو إيرادات أو مجموع");
    const detailInvalid = invalidDetails(raw2, (row) => { const date = excelDate(readCell(row, headers2, "التاريخ")); return date && String(readCell(row, headers2, "القسم")).trim() && String(readCell(row, headers2, "تفاصيل")).trim() && numberValue(readCell(row, headers2, "السعر")) != null; }, () => "يجب توفر التاريخ والقسم والتفاصيل والسعر");
    const payrollInvalid = invalidDetails(raw3, (row) => String(readCell(row, headers3, "اسم الموظف")).trim(), () => "اسم الموظف مفقود");
    const data = { filename: file.name, import_type: "legacy_monthly_finance", month, carryover: carryoverValue, sheets: [
      { name: "ورقة1", kind: "summary", rows: summaryRows, valid: summaryRows.filter((row) => [row.amount, row.revenue, row.total].some((value) => value != null)).length, invalid: summaryInvalid.length, invalidDetails: summaryInvalid, duplicateRows: duplicateRows(summaryRows, (r) => r.date), mapping: [["التاريخ", "date"], ["المبلغ", "amount"], ["خصم", "discount"], ["ايرادات", "revenue"], ["الكتروني", "electronic"], ["مشتريات", "purchases"], ["رواتب", "payroll"], ["المجموع", "total"]] },
      { name: "ورقة2", kind: "details", rows: detailRows, valid: detailRows.filter((r) => r.date && r.source_category && r.source_details && r.amount != null).length, invalid: detailInvalid.length, invalidDetails: detailInvalid, duplicateRows: duplicateRows(detailRows, (r) => r.date && `${r.date}|${normalizeLegacy(r.source_category)}|${normalizeLegacy(r.source_details)}|${r.amount}`), mapping: [["التاريخ", "date"], ["القسم", "category_name"], ["تفاصيل", "details"], ["السعر", "amount"]] },
      { name: "ورقة3", kind: "payroll", rows: payrollRows, valid: payrollRows.length, invalid: payrollInvalid.length, invalidDetails: payrollInvalid, duplicateRows: duplicateRows(payrollRows, (r) => `${month}|${normalizeLegacy(r.employee_name)}`), mapping: [["اسم الموظف", "employee_name"], ["الراتب الاسمي", "base_salary"], ["عدد الايام", "days"], ["الاجازات", "leave_days"], ["السحب", "advance"], ["خصم", "deductions"], ["الصافي", "net"]] },
    ] };
    try { data.duplicates = await api.previewLegacyMonthlyImport(data); } catch { data.duplicates = { summary: 0, details: 0, payroll: 0, available: false }; }
    return data;
  };
  const read = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      // Keep legacy serials as numbers; parsing them ourselves avoids SheetJS timezone shifts.
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const legacy = importType === "legacy_monthly_finance" || importType === "auto" ? await legacyPreview(file, wb) : null;
      if (legacy) { setPreview(legacy); return; }
      const sheets = wb.SheetNames.map((name) => {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: "" });
        const headers = rows[0] ? Object.keys(rows[0]) : [];
        const nameKey = headers.find((h) =>
          /الصنف|اسم|name|منتج|product/i.test(h),
        );
        const nameEnKey = headers.find((h) => /إنجليزية|english/i.test(h));
        const categoryKey = headers.find((h) => /القسم|category/i.test(h));
        const priceKey = headers.find((h) => /سعر|price|قيمة/i.test(h));
        const labelKey = nameKey || categoryKey;
        const valid = rows.filter((r) =>
          String(r[labelKey] || "").trim(),
        ).length;
        const names = rows
          .map((r) =>
            String(r[labelKey] || "")
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean);
        const duplicateRows = names.length - new Set(names).size;
        return {
          name,
          rows,
          headers,
          valid,
          invalid: rows.length - valid,
          nameKey: nameKey || (!priceKey ? categoryKey : null),
          nameEnKey,
          categoryKey,
          priceKey,
          duplicateRows,
          isCategorySheet: !priceKey && !!categoryKey,
        };
      });
      setPreview({ file: file.name, sheets, entity: "products" });
    } catch (err) {
      setToast(`تعذر قراءة الملف: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (preview?.import_type === "legacy_monthly_finance") {
      try {
        const result = await api.importLegacyMonthlyBatch(preview);
        setToast(`تم استيراد الشهر ${result.month}: ${result.rows_inserted} جديد، ${result.rows_skipped} مكرر، ${result.rows_invalid} غير صالح`);
        setPreview(null);
      } catch (e) { setToast(e.message); }
      return;
    }
    const s =
      preview?.sheets?.find((x) => !x.isCategorySheet) || preview?.sheets?.[0];
    const c = preview?.sheets?.find((x) => x.isCategorySheet);
    if (!s) return;
    const mapping = {};
    if (s.nameKey) mapping[s.nameKey] = "name_ar";
    if (s.nameEnKey) mapping[s.nameEnKey] = "name_en";
    if (s.categoryKey) mapping[s.categoryKey] = "category";
    if (s.priceKey) mapping[s.priceKey] = "selling_price";
    const descriptionKey = s.headers.find((h) => /وصف|description/i.test(h));
    if (descriptionKey) mapping[descriptionKey] = "description";
    const categoryMapping = c
      ? {
          name: c.nameKey || c.categoryKey,
          nameAr: c.nameKey || c.categoryKey,
          nameEn: c.nameEnKey,
          sortOrder: c.headers.find((h) => /ترتيب|sort/i.test(h)),
        }
      : {};
    try {
      const result = await api.importBatch({
        filename: preview.file,
        sheet: s.name,
        entity: preview.entity,
        mapping,
        rows: s.rows,
        categoryRows: c?.rows || [],
        categoryMapping,
      });
      setToast(
        `تم الاستيراد: ${result.inserted_rows} جديد، ${result.skipped_rows} مكرر، ${result.invalid_rows} غير صالح`,
      );
      setPreview(null);
    } catch (e) {
      setToast(e.message);
    }
  };
  return (
    <Panel
      title="استيراد وتصدير Excel"
      action="معاينة، Mapping، Validation، Duplicate Detection ثم تأكيد"
    >
      <div className="import-drop">
        <FileSpreadsheet size={38} />
        <h3>ارفع ملف المنتجات أو البيانات</h3>
        <p>يدعم XLSX و XLS و CSV. لا يتم الحفظ قبل التأكيد.</p>
        <label className="import-type-label" htmlFor="excel-import-type">نوع الملف</label>
        <select id="excel-import-type" value={importType} onChange={(e) => setImportType(e.target.value)}>
          <option value="auto">اكتشاف تلقائي</option>
          <option value="products">منتجات</option>
          <option value="categories">أقسام</option>
          <option value="purchases">مشتريات</option>
          <option value="sales">مبيعات</option>
          <option value="expenses">مصروفات</option>
          <option value="payroll">رواتب</option>
          <option value="legacy_monthly_finance">شهر مالي قديم / Legacy Monthly Finance</option>
        </select>
        <input
          id="excel-file"
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={read}
        />
        <label htmlFor="excel-file" className="secondary">
          {busy ? "جارٍ القراءة..." : "اختيار ملف"}
        </label>
      </div>
      {preview && (
        <div className="preview-box">
          <div className="panel-head">
            <div>
              <h2>Preview: {preview.file}</h2>
              <p className="muted">
                Mapping محفوظ قبل التأكيد، والتكرار يُحسب داخل الملف وعند مقارنة
                Firebase.
              </p>
            </div>
            <button className="icon-btn" onClick={() => setPreview(null)}>
              <X />
            </button>
          </div>
          {preview.import_type === "legacy_monthly_finance" && <div className="legacy-summary"><strong>استيراد شهر مالي قديم</strong><span>الشهر المكتشف: {preview.month} · ورقة1: {preview.sheets[0].rows.length} · ورقة2: {preview.sheets[1].rows.length} · ورقة3: {preview.sheets[2].rows.length}</span><span>المتبقي من الشهر السابق: {money(preview.carryover || 0)}</span></div>}
          {preview.sheets.map((s) => (
            <div className="sheet-preview" key={s.name}>
              <strong>{s.name}</strong>
              <span>
                الصفوف: {s.rows.length} · صالح: {s.valid} · غير صالح:{" "}
                {s.invalid} · مكرر داخل الملف: {s.duplicateRows} · مكرر موجود: {preview.duplicates?.[s.kind] ?? "غير متاح"}
              </span>
              {s.mapping && <div className="mapping-list">{s.mapping.map(([from, to]) => <span key={from}>{from} → {to}</span>)}</div>}
              <div className="preview-table">
                {s.rows.slice(0, 10).map((r, i) => (
                  <div key={i}>{Object.values(r).slice(0, 5).join(" · ")}</div>
                ))}
              </div>
              {s.invalidDetails?.length > 0 && <div className="muted">أخطاء: {s.invalidDetails.map((item) => `صف ${item.source_row}: ${item.reason}`).join("، ")}</div>}
            </div>
          ))}
          <button className="primary" onClick={confirm}>
            تأكيد الاستيراد
          </button>
        </div>
      )}
    </Panel>
  );
}
function Categories({ setToast }) {
  return (
    <CrudPage
      title="إدارة الأقسام"
      subtitle="الأقسام الرئيسية والفرعية للمنتجات والمصروفات"
      entity="product_categories"
      columns={[
        ["name_ar", "الاسم العربي", (v, r) => v || r.nameAr],
        ["name_en", "الاسم الإنجليزي", (v, r) => v || r.nameEn],
        ["sort_order", "الترتيب", (v, r) => v ?? r.sortOrder],
        ["active", "الحالة", (v) => (v ? "فعال" : "متوقف")],
      ]}
      setToast={setToast}
      pageId="categories"
      action="إضافة قسم"
      form={({ onDone, initial }) => (
        <SmartForm
        entity="product_categories"
          initial={initial}
          onDone={onDone}
          fields={[
            ["name_ar", "الاسم العربي"],
            ["name_en", "الاسم الإنجليزي"],
            ["sort_order", "الترتيب"],
            ["active", "فعال"],
            ["icon", "الأيقونة"],
          ]}
        />
      )}
    />
  );
}
function Employees({ can = () => false, setToast }) {
  const [rows, setRows] = useState([]), [query, setQuery] = useState(""), [show, setShow] = useState(false), [editing, setEditing] = useState(null), [profile, setProfile] = useState(null);
  const load = () => api.list("employees").then(setRows).catch(() => setRows([])); useEffect(() => { load(); }, []);
  useEffect(() => {
    const handleNewAction = (event) => {
      if (event.detail !== "employees") return;
      if (can("employees.create")) { setEditing(null); setShow(true); }
    };
    document.addEventListener("app:new-action", handleNewAction);
    return () => document.removeEventListener("app:new-action", handleNewAction);
  }, [can]);
  useEffect(() => api.subscribeEmployees(setRows, () => setRows([])), []);
  const filtered = rows.filter((row) => `${row.name || ""} ${row.phone || ""}`.toLowerCase().includes(query.toLowerCase()));
  const fields = [["name", "الاسم"], ["phone", "رقم الهاتف"], ["address", "العنوان"], ["job_title", "المسمى الوظيفي"], ["department", "القسم"], ["base_salary", "الراتب الأساسي"], ["hire_date", "تاريخ المباشرة", "date"], ["status", "الحالة", "select", [["active", "فعال"], ["inactive", "غير فعال"]]], ["notes", "الملاحظات"]];
  const liveProfile = profile ? rows.find((row) => row.id === profile.id) || profile : null;
  return <div className="screen-stack"><Panel title="ملفات الموظفين" action="البيانات الشخصية والمالية المرتبطة بملف الموظف"><div className="toolbar"><div className="table-search"><Search size={17} /><input placeholder="بحث بالاسم أو رقم الهاتف..." value={query} onChange={(e) => setQuery(e.target.value)} /></div>{can("employees.create") && <button className="primary" onClick={() => { setEditing(null); setShow(true); }}><Plus size={17} /> إضافة موظف</button>}</div><DataTable rows={filtered} columns={[["name", "الاسم"], ["phone", "الهاتف"], ["job_title", "المسمى الوظيفي"], ["department", "القسم"], ["base_salary", "الراتب الأساسي", money], ["status", "الحالة", (v) => v === "inactive" ? "غير فعال" : "فعال"]]} rowActions={(row) => <button className="table-action" onClick={() => setProfile(row)}>عرض الملف</button>} onEdit={can("employees.edit") ? (row) => { setEditing(row); setShow(true); } : undefined} /></Panel>{show && <Modal title={editing ? "تعديل ملف موظف" : "إضافة موظف"} onClose={() => setShow(false)}><SmartForm entity="employees" initial={editing || { status: "active" }} onDone={() => { setShow(false); load(); setToast?.(editing ? "تم تحديث الموظف بنجاح" : "تم حفظ الموظف بنجاح"); }} fields={fields} /></Modal>}{liveProfile && <EmployeeProfile employee={liveProfile} can={can} onClose={() => setProfile(null)} />}</div>;
}
function EmployeeProfile({ employee, can = () => false, onClose }) {
  const [tab, setTab] = useState("personal"), [data, setData] = useState({ payroll: [], adjustments: [], debts: [], payments: [] });
  useEffect(() => { Promise.all([api.list("payroll").catch(() => []), api.list("payroll_adjustments").catch(() => []), api.list("employee_debts").catch(() => []), api.list("payroll_payments").catch(() => [])]).then(([payroll, adjustments, debts, payments]) => setData({ payroll: payroll.filter((x) => x.employee_id === employee.id), adjustments: adjustments.filter((x) => x.employee_id === employee.id), debts: debts.filter((x) => x.employee_id === employee.id), payments: payments.filter((x) => x.employee_id === employee.id) })); }, [employee.id]);
  const tabs = [["personal", "البيانات الشخصية"], ["salary", "الراتب"], ["adjustments", "المكافآت والخصومات"], ["debts", "الديون"], ["payments", "دفعات الراتب"], ["history", "سجل الحركات"]];
  return <Modal title={`ملف الموظف — ${employee.name || ""}`} onClose={onClose}><div className="settings-tabs profile-tabs">{tabs.map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}</div>{tab === "personal" && <div className="profile-grid">{[["الاسم", employee.name], ["الهاتف", employee.phone], ["العنوان", employee.address], ["المسمى الوظيفي", employee.job_title], ["القسم", employee.department], ["الراتب الأساسي", money(employee.base_salary)], ["تاريخ المباشرة", employee.hire_date], ["الحالة", employee.status === "inactive" ? "غير فعال" : "فعال"], ["الملاحظات", employee.notes]].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value || "—"}</strong></div>)}</div>}{tab === "salary" && <div className="profile-list">{data.payroll.length ? data.payroll.map((row) => <div key={row.id}><strong>{row.month}</strong><span>{money(row.base_salary_snapshot)}</span></div>) : <Empty text="لا توجد كشوف راتب مرتبطة" />}</div>}{tab === "adjustments" && <div className="profile-list">{data.adjustments.length ? data.adjustments.map((row) => <div key={row.id}><strong>{row.type === "bonus" ? "مكافأة" : "خصم"}</strong><span>{money(row.amount)} · {row.month || row.date || "—"}</span></div>) : <Empty text="لا توجد مكافآت أو خصومات" />}</div>}{tab === "debts" && <div className="profile-list">{data.debts.length ? data.debts.map((row) => <div key={row.id}><strong>{row.status === "settled" ? "مسدد" : "مفتوح"}</strong><span>{money(row.amount)} · {row.date || "—"}</span></div>) : <Empty text="لا توجد ديون مرتبطة" />}</div>}{tab === "payments" && <div className="profile-list">{data.payments.length ? data.payments.map((row) => <div key={row.id}><strong>{money(row.amount)}</strong><span>{row.date || "—"} · {row.payment_method || "—"}</span></div>) : <Empty text="لا توجد دفعات مرتبطة" />}</div>}{tab === "history" && <div className="profile-list">{[...data.adjustments, ...data.debts, ...data.payments].length ? [...data.adjustments, ...data.debts, ...data.payments].map((row) => <div key={row.id}><strong>{row.type || (row.status ? "دين" : "دفعة راتب")}</strong><span>{money(row.amount)} · {row.date || row.month || "—"}</span></div>) : <Empty text="لا يوجد سجل حركات" />}</div>}</Modal>;
}
function UsersPage({ setToast }) {
  const [rows, setRows] = useState([]),
    [show, setShow] = useState(false),
    [editing, setEditing] = useState(null);
  const load = () =>
    api
      .listAuthorizedUsers()
      .then(setRows)
      .catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    const handleNewAction = (event) => {
      if (event.detail !== "users") return;
      setEditing(null);
      setShow(true);
    };
    document.addEventListener("app:new-action", handleNewAction);
    return () => document.removeEventListener("app:new-action", handleNewAction);
  }, []);
  return (
    <div className="screen-stack">
      <Panel
        title="الموظفون والصلاحيات"
        action="المستخدمون المخولون ومصفوفة الصلاحيات"
      >
        <div className="toolbar">
          <button
            className="primary"
            onClick={() => {
              setEditing(null);
              setShow(true);
            }}
          >
            <Plus size={17} /> إضافة موظف مخول
          </button>
          <span className="permission-note">
            <ShieldCheck size={17} /> الصلاحيات تحفظ في authorized_users
          </span>
        </div>
        <DataTable
          rows={rows}
          columns={[
            ["name", "الاسم"],
            ["email", "البريد الإلكتروني"],
            ["base_salary", "الراتب الأساسي", (v) => v == null || v === "" ? "غير محدد" : money(v)],
            ["role", "الدور", roleLabel],
            ["active", "الحالة", (v) => (v === false ? "موقوف" : "فعال")],
          ]}
          onEdit={(r) => {
            setEditing(r);
            setShow(true);
          }}
        />
        {show && (
          <Modal
            title={editing ? "تعديل الصلاحيات" : "إضافة موظف مخول"}
            onClose={() => setShow(false)}
          >
            <EmployeeForm
              initial={editing}
              onDone={() => {
                setShow(false);
                load();
                setToast("تم حفظ الموظف والصلاحيات");
              }}
            />
          </Modal>
        )}
      </Panel>
    </div>
  );
}
function EmployeeForm({ initial, onDone }) {
  const [form, setForm] = useState(() => {
    const next = { name: "", email: "", role: "employee", active: true, permissions: {}, ...initial };
    if (!initial && next.role === "cashier") next.permissions = getPermissionPreset("cashier");
    return next;
  });
  const toggle = (p) =>
    setForm({
      ...form,
      permissions: { ...form.permissions, [p]: !form.permissions?.[p] },
    });
  return (
    <form
      className="smart-form"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await api.authorizeUser(form);
          onDone();
        } catch (err) {
          alert(err.message);
        }
      }}
    >
      <label>
        <span>الاسم</span>
        <input
          required
          value={form.name || ""}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </label>
      <label>
        <span>البريد الإلكتروني</span>
        <input
          required
          type="email"
          value={form.email || ""}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </label>
      <label><span>رقم الهاتف</span><input value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
      <label><span>العنوان</span><input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
      <label><span>المسمى الوظيفي</span><input value={form.job_title || ""} onChange={(e) => setForm({ ...form, job_title: e.target.value })} /></label>
      <label><span>القسم</span><input value={form.department || ""} onChange={(e) => setForm({ ...form, department: e.target.value })} /></label>
      <label>
        <span>الراتب الأساسي الثابت</span>
        <input type="number" min="0" value={form.base_salary ?? ""} onChange={(e) => setForm({ ...form, base_salary: e.target.value })} />
      </label>
      <label><span>تاريخ المباشرة</span><input type="date" value={form.hire_date || ""} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} /></label>
      <label className="wide"><span>ملاحظات</span><textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
      <label>
        <span>الدور</span>
        <select
          value={form.role}
          onChange={(e) => {
            const role = e.target.value;
            setForm({ ...form, role, permissions: role === "cashier" || role === "super_admin" ? getPermissionPreset(role) : form.permissions });
          }}
        >
          <option value="employee">موظف</option>
          <option value="supervisor">مشرف</option>
          <option value="cashier">كاشير</option>
          <option value="manager">مدير</option>
          <option value="viewer">مشاهدة فقط</option>
          <option value="super_admin">سوبر أدمن</option>
        </select>
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={form.active !== false}
          onChange={(e) => setForm({ ...form, active: e.target.checked })}
        />
        <span>الحساب فعال</span>
      </label>
      <div className="permission-matrix wide">
        <strong>مصفوفة الصلاحيات</strong>
        <p className="permission-note">تُطبّق صلاحيات الكاشير الافتراضية تلقائياً، ويمكن للسوبر أدمن تخصيصها قبل الحفظ.</p>
        {Object.entries(permissionGroups).map(([group, perms]) => (
          <section className="permission-group" key={group}>
            <h3>{permissionGroupLabels[group]}</h3>
            <div className="permission-group-grid">
              {perms.map((p) => (
                <label key={p} className="permission-item">
                  <input
                    type="checkbox"
                    checked={!!form.permissions?.[p]}
                    onChange={() => toggle(p)}
                  />
                  <span>{getPermissionLabel(p)}</span>
                </label>
              ))}
            </div>
          </section>
        ))}
      </div>
      <button className="primary wide">
        <Check size={17} /> حفظ الموظف والصلاحيات
      </button>
    </form>
  );
}
function SettingsPage({ setToast }) {
  const [section, setSection] = useState("general");
  const [form, setForm] = useState({
    system_name: "101 COFFEE Finance",
    coffee_name: "101 COFFEE HOUSE",
    currency: "IQD",
    timezone: "Asia/Baghdad",
    date_format: "YYYY-MM-DD",
    allow_negative_stock: false,
    low_stock_alerts: true,
    max_pinned_cards: 4,
    duplicate_strategy: "skip",
  });
  useEffect(() => {
    api
      .get(`settings/${section}`)
      .then((v) => v && setForm((x) => ({ ...x, ...v })))
      .catch(() => {});
  }, [section]);
  const save = async (e) => {
    e.preventDefault();
    try {
      await api.saveSettings(section, {
        ...form,
        max_pinned_cards: Math.min(4, Number(form.max_pinned_cards || 4)),
      });
      setToast("تم حفظ الإعدادات في Firebase");
    } catch (err) {
      setToast(err.message);
    }
  };
  return (
    <div className="settings-grid">
      <Panel title="الإعدادات" action="تغييرات فعلية على settings/{section}">
        <div className="settings-tabs">
          {["general", "finance", "inventory", "ui", "import_export"].map(
            (x) => (
              <button
                type="button"
                className={section === x ? "active" : ""}
                key={x}
                onClick={() => setSection(x)}
              >
                {x}
              </button>
            ),
          )}
        </div>
        <form className="smart-form" onSubmit={save}>
          <label>
            <span>اسم النظام</span>
            <input
              value={form.system_name || ""}
              onChange={(e) =>
                setForm({ ...form, system_name: e.target.value })
              }
            />
          </label>
          <label>
            <span>اسم الكوفي</span>
            <input
              value={form.coffee_name || ""}
              onChange={(e) =>
                setForm({ ...form, coffee_name: e.target.value })
              }
            />
          </label>
          <label>
            <span>العملة</span>
            <input
              value={form.currency || ""}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
            />
          </label>
          <label>
            <span>المنطقة الزمنية</span>
            <input
              value={form.timezone || ""}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
            />
          </label>
          <label>
            <span>تاريخ افتتاح الكوفي</span>
            <input
              type="date"
              value={form.opening_date || ""}
              onChange={(e) => setForm({ ...form, opening_date: e.target.value })}
            />
          </label>
          <label>
            <span>استراتيجية التكرار</span>
            <select
              value={form.duplicate_strategy || "skip"}
              onChange={(e) =>
                setForm({ ...form, duplicate_strategy: e.target.value })
              }
            >
              <option value="skip">تخطي التكرار</option>
              <option value="report">تسجيل للمراجعة</option>
            </select>
          </label>
          <label>
            <span>حد المربعات المثبتة (أقصاه 4)</span>
            <input
              type="number"
              min="1"
              max="4"
              value={form.max_pinned_cards || 4}
              onChange={(e) =>
                setForm({
                  ...form,
                  max_pinned_cards: Math.min(4, e.target.value),
                })
              }
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={!!form.allow_negative_stock}
              onChange={(e) =>
                setForm({ ...form, allow_negative_stock: e.target.checked })
              }
            />
            <span>السماح برصيد سالب</span>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={form.low_stock_alerts !== false}
              onChange={(e) =>
                setForm({ ...form, low_stock_alerts: e.target.checked })
              }
            />
            <span>تنبيهات الحد الأدنى للمخزون</span>
          </label>
          <button className="primary wide">
            <Check size={17} /> حفظ الإعدادات
          </button>
        </form>
      </Panel>
      <Panel title="سلامة البيانات">
        <div className="notice">
          <Zap size={21} />
          <div>
            <strong>Firebase Realtime Database</strong>
            <span>لا يتم تعديل الرصيد مباشرة؛ الحركات هي مصدر التغيير.</span>
          </div>
        </div>
      </Panel>
    </div>
  );
}
function StockForm({ items, onDone }) {
  const [form, setForm] = useState({
      date: today(),
      type: "IN",
      quantity: "",
      item_id: "",
      reason: "",
      notes: "", unit: "",
    }),
    [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const operationKey = useRef(crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`);
  const selected = items.find((x) => x.id === form.item_id);
  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  return (
    <form
      className="smart-form"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          if (saving) return;
          setSaving(true);
          const item = items.find((x) => x.id === form.item_id);
          if (!item) throw new Error("اختر مادة المخزون.");
          const saved = await api.stockMovement({
            itemId: form.item_id,
            itemName: item?.name_ar || item?.name || item?.nameAr || "",
            type: form.type,
            quantity: form.quantity,
            unit: form.unit || item.base_unit || item.unit,
            reason: form.reason,
            date: form.date,
            notes: form.notes,
            operation_key: operationKey.current,
          });
          onDone("تم حفظ حركة المخزون بنجاح", saved?.already_processed ? null : { ...saved, materialId: item.id });
        } catch (err) {
          setError(err.message);
        } finally { setSaving(false); }
      }}
    >
      <label>
        <span>المادة</span>
        <select
          required
          value={form.item_id}
          onChange={(e) => { const item = items.find((x) => x.id === e.target.value); setForm({ ...form, item_id: e.target.value, unit: item?.base_unit || item?.unit || "" }); }}
        >
          <option value="">اختر مادة</option>
          {items.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name_ar || x.name || x.nameAr || "—"}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>الوحدة</span>
        <select required value={form.unit} onChange={(e) => set("unit", e.target.value)}>
          <option value="">اختر الوحدة</option>
          {[selected?.base_unit || selected?.unit, selected?.purchase_unit, (selected?.base_unit || selected?.unit) === 'ml' ? 'L' : ((selected?.base_unit || selected?.unit) === 'g' ? 'kg' : null)].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).map((unit) => <option key={unit} value={unit}>{unitLabel(unit)}</option>)}
        </select>
      </label>
      <label>
        <span>نوع الحركة</span>
        <select
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value })}
        >
          <option value="IN">IN — إدخال</option>
          <option value="OUT">OUT — إخراج</option>
          <option value="ADJUSTMENT">Adjustment — تسوية</option>
        </select>
      </label>
      <label>
        <span>الكمية / الرصيد الجديد</span>
        <input
          required
          type="number"
          min="0.000001"
          value={form.quantity}
          onChange={(e) => setForm({ ...form, quantity: e.target.value })}
        />
      </label>
      <label>
        <span>التاريخ</span>
        <input
          type="date"
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
        />
      </label>
      <label className="wide">
        <span>السبب</span>
        <input
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
      </label>
      <label className="wide">
        <span>ملاحظات</span>
        <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </label>
      {error && <div className="error wide">{error}</div>}
      <button className="primary wide" disabled={saving}>
        <Check size={17} /> حفظ الحركة
      </button>
    </form>
  );
}
function SmartForm({ entity, fields, onDone, initial, lockedFields = [], isMonthClosed = false }) {
  const [form, setForm] = useState({ date: today(), ...initial }),
    [error, setError] = useState("");
  const save = async (e) => {
    e.preventDefault();
    try {
      if (isMonthClosed) throw new Error("هذا الشهر مغلق. أعد فتح الشهر أولاً للتعديل.");
      for (const k of [
        "amount",
        "quantity",
        "unit_price",
        "discount_value",
        "base_salary",
        "bonus",
        "advance",
        "deduction",
        "purchase_price",
        "sellingPrice",
        "min_stock",
        "sortOrder",
      ])
        if (
          form[k] !== undefined &&
          form[k] !== "" &&
          (!Number.isFinite(Number(form[k])) || Number(form[k]) < 0)
        )
          throw Error("تحقق من القيم الرقمية وأدخل أرقاماً موجبة.");
      if (entity === "sales" || entity === "purchases") {
        const s = Number(form.quantity || 0) * Number(form.unit_price || 0),
          d = Number(form.discount_value || 0);
        form.subtotal = s;
        form.discount_amount =
          form.discount_type === "percent"
            ? (s * Math.min(100, d)) / 100
            : Math.min(s, d);
        form.total_after_discount = s - form.discount_amount;
      }
      const saved = form.id ? await api.update(entity, form.id, form) : await api.create(entity, form);
      onDone(saved || form);
      if (entity === "employees") window.dispatchEvent(new CustomEvent("employee:created", { detail: saved || form }));
    } catch (err) {
      setError(err.message || "تعذر حفظ العملية.");
    }
  };
  return (
    <form className="smart-form" onSubmit={save}>
      {fields.map(([k, l, t = "text", options = []]) => (
        <label key={k}>
          <span>{l}</span>
          {t === "select" ? <select disabled={lockedFields.includes(k)} value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })}><option value="">اختر</option>{options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select> : <input disabled={lockedFields.includes(k)} type={t} value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />}
        </label>
      ))}
      {error && <div className="error wide">{error}</div>}
      <button className="primary wide" disabled={isMonthClosed} title={isMonthClosed ? "هذا الشهر مغلق. أعد فتح الشهر أولاً للتعديل." : ""}>
        <Plus size={17} /> {form.id ? "تحديث السجل" : "حفظ العملية"}
      </button>
    </form>
  );
}
function LegacyCameraScanner({ onFound }) {
  const video = useRef(null), stream = useRef(null), timer = useRef(null), busy = useRef(false); const [state, setState] = useState("اضغط تشغيل المسح لمنح إذن الكاميرا.");
  const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = null; stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null; if (video.current) video.current.srcObject = null; };
  useEffect(() => { const halt=()=>stop(); window.addEventListener("pagehide",halt); return () => { window.removeEventListener("pagehide",halt); stop(); }; }, []);
  const start = async () => { try { if (!navigator.mediaDevices?.getUserMedia || !("BarcodeDetector" in window)) { setState("المتصفح لا يدعم المسح المباشر بالكاميرا، استخدم جهاز الباركود أو أدخل الرقم يدويًا."); return; } stop(); const all=typeof window.BarcodeDetector.getSupportedFormats==="function"?await window.BarcodeDetector.getSupportedFormats():[]; const wanted=["code_128","ean_13","ean_8","upc_a","upc_e","qr_code"], formats=all.length?wanted.filter(x=>all.includes(x)):undefined; stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }); video.current.srcObject = stream.current; await video.current.play(); const detector = new window.BarcodeDetector(formats?.length?{ formats }:undefined); setState("الكاميرا تعمل — وجّهها نحو الباركود."); timer.current = setInterval(async () => { if (busy.current) return; busy.current = true; try { const codes = await detector.detect(video.current); if (codes[0]?.rawValue) { const value = normalizeBarcode(codes[0].rawValue); stop(); onFound(value); } } catch {} finally { busy.current = false; } }, 350); } catch (error) { setState(error.name === "NotAllowedError" ? "تم رفض إذن الكاميرا. استخدم جهاز الباركود أو أدخل الرقم يدويًا." : "تعذر تشغيل الكاميرا. استخدم جهاز الباركود أو أدخل الرقم يدويًا."); stop(); } };
  return <div className="screen-stack"><video ref={video} muted playsInline className="scanner-video" aria-label="معاينة الكاميرا" /><p>{state}</p><div className="toolbar"><button type="button" className="primary" onClick={start}>تشغيل المسح</button><button type="button" className="secondary" onClick={() => { stop(); setState("تم إيقاف الكاميرا."); }}>إيقاف الكاميرا</button></div></div>;
}
function CameraScanner({ onFound }) {
  const video = useRef(null), onFoundRef = useRef(onFound), controller = useRef(null);
  const [state, setState] = useState(cameraMessages.ready);
  onFoundRef.current = onFound;
  useEffect(() => {
    controller.current = createBarcodeCameraController({ video: video.current, onFound: (value) => onFoundRef.current(value), onState: setState });
    const halt = () => controller.current?.stop();
    window.addEventListener("pagehide", halt);
    return () => { window.removeEventListener("pagehide", halt); controller.current?.stop(); controller.current = null; };
  }, []);
  return <div className="screen-stack"><video ref={video} muted autoPlay playsInline className="scanner-video" aria-label="معاينة الكاميرا" /><p>{state}</p><div className="toolbar"><button type="button" className="primary" onClick={() => controller.current?.start()}>تشغيل المسح</button><button type="button" className="secondary" onClick={() => { controller.current?.stop(); setState(cameraMessages.stopped); }}>إيقاف الكاميرا</button></div></div>;
}
function WasteForm({ items, onDone, initialBatchId = "" }) { const [form, setForm] = useState({ item_id: "", quantity: "", unit: "", reason: "expired", batch_id:initialBatchId, date: today(), notes: "", barcode: "" }), [batches,setBatches]=useState([]), [error, setError] = useState(""); const item = items.find((row) => row.id === form.item_id); useEffect(()=>{if(initialBatchId)api.get(`inventory_batches/${initialBatchId}`).then(b=>{const i=items.find(x=>x.id===b?.item_id);setForm(x=>({...x,item_id:b?.item_id||"",unit:i?.base_unit||i?.unit||""}));});},[initialBatchId,items]); useEffect(()=>{ if(item?.track_expiry) api.list("inventory_batches").then(x=>setBatches(x.filter(b=>b.item_id===item.id&&Number(b.remaining_quantity)>0))).catch(()=>setBatches([])); else setBatches([]);},[item?.id,item?.track_expiry]); const selectBarcode = async (code) => { const found = await api.lookupBarcode(code); if (!found) { setError("الباركود غير مسجل"); return; } setForm((x)=>({...x,item_id:found.id,unit:found.base_unit||found.unit||"",batch_id:"",barcode:code})); setError(""); }; const base = item && form.quantity ? Number(form.quantity) * ((form.unit === item.base_unit || form.unit === item.unit) ? 1 : Number(item.units_per_package || 1)) : 0; const save = async (e) => { e.preventDefault(); try { await api.recordWaste(form); onDone(); } catch (x) { setError(x.message); } }; return <form className="smart-form" onSubmit={save}><BarcodeInput label="Scan Barcode" value={form.barcode} onChange={(value)=>setForm(x=>({...x,barcode:value}))} onScan={selectBarcode}/><SelectField label="المادة" value={form.item_id} onChange={(v) => { const next = items.find((row) => row.id === v); setForm((x) => ({ ...x, item_id: v, unit: next?.base_unit || next?.unit || "", batch_id:"" })); }}><option value="">اختر مادة</option>{items.map((row) => <option key={row.id} value={row.id}>{row.name_ar || row.name}</option>)}</SelectField>{item?.track_expiry&&<SelectField label="الدفعة" value={form.batch_id} onChange={v=>setForm(x=>({...x,batch_id:v}))}><option value="">اختر دفعة</option>{batches.map(b=><option key={b.id} value={b.id}>{b.batch_number||b.id} — {b.expiry_date||"بدون تاريخ"} — المتبقي {b.remaining_quantity}</option>)}</SelectField>}<label><span>الكمية</span><input required type="number" min="0.01" step="0.01" value={form.quantity} onChange={(e) => setForm((x) => ({ ...x, quantity: e.target.value }))} /></label><label><span>الوحدة</span><input readOnly value={unitLabel(form.unit)} /></label><SelectField label="السبب" value={form.reason} onChange={(v) => setForm((x) => ({ ...x, reason: v }))}><option value="expired">منتهي الصلاحية</option><option value="spill">انسكاب</option><option value="damaged">تالف</option><option value="wrong_preparation">تحضير خاطئ</option><option value="breakage">كسر</option><option value="other">أخرى</option></SelectField><label><span>التاريخ</span><input type="date" value={form.date} onChange={(e) => setForm((x) => ({ ...x, date: e.target.value }))} /></label><label className="wide"><span>ملاحظات</span><textarea value={form.notes} onChange={(e) => setForm((x) => ({ ...x, notes: e.target.value }))} /></label>{item && <div className="notice wide">المخزون الحالي: {inventoryQuantity(item)} · سيُسحب: {base} · المتبقي: {Math.max(0, inventoryQuantity(item) - base)}</div>}{error && <div className="error wide">{error}</div>}<button className="primary wide">تأكيد الهدر</button></form>; }
function ItemHistory({ item, movements }) { const [filter,setFilter]=useState("all"); const types={all:[],purchases:["purchase"],consumption:["recipe_consumption"],waste:["waste"],stocktake:["stocktake_adjustment"],transfers:["transfer_in","transfer_out"],adjustments:["ADJUSTMENT","manual_adjustment"]}; const labels={purchase:"شراء",recipe_consumption:"استهلاك وصفة",waste:"هدر",stocktake_adjustment:"تسوية جرد",transfer_in:"نقل داخل",transfer_out:"نقل خارج",ADJUSTMENT:"تعديل يدوي",manual_adjustment:"تعديل يدوي"}; const rows=sortHistory(movements.filter(x=>x.item_id===item.id&&(filter==="all"||types[filter].includes(x.type)))); return <div className="screen-stack"><div className="notice">إجمالي الرصيد: {inventoryQuantity(item)} {unitLabel(item.base_unit||item.unit)}{Object.entries(locationBalances(item)).map(([id,value])=><div key={id}>{id}: {value}</div>)}</div><div className="filter-pills">{[["all","الكل"],["purchases","المشتريات"],["consumption","الاستهلاك"],["waste","الهدر"],["stocktake","الجرد"],["transfers","النقل"],["adjustments","التعديلات"]].map(([id,label])=><button key={id} className={filter===id?"active":""} onClick={()=>setFilter(id)}>{label}</button>)}</div><DataTable rows={rows} columns={[["date","التاريخ"],["type","النوع",v=>labels[v]||v],["quantity_delta","التغير"],["before_quantity","قبل"],["after_quantity","بعد"],["location_id","الموقع"],["source_id","المصدر"],["created_by","المستخدم"],["notes","ملاحظات"]]}/></div>; }
function LocationsPanel({ locations, setLocations }) { const [form,setForm]=useState(null),[error,setError]=useState(""); const save=async(e)=>{e.preventDefault();try{const code=String(form.code||"").trim().toLowerCase();if(!code)throw new Error("رمز الموقع مطلوب.");if(locations.some(x=>x.code===code&&x.id!==form.id))throw new Error("رمز الموقع مستخدم.");const payload={...form,code,active:form.active!==false};const saved=form.id?await api.update("inventory_locations",form.id,payload):await api.create("inventory_locations",payload);setLocations(x=>form.id?x.map(v=>v.id===form.id?{...v,...payload}:v):[...x,saved]);setForm(null);}catch(e){setError(e.message)}};return <div className="screen-stack"><div className="toolbar"><button className="primary" onClick={()=>setForm({name_ar:"",code:"",type:"storage",notes:"",active:true})}>إضافة موقع</button></div><DataTable rows={locations} columns={[["name_ar","الاسم"],["type","النوع",v=>({storage:"مخزن",bar:"بار",other:"أخرى"}[v]||v)],["active","الحالة",v=>v===false?"متوقف":"فعال"],["created_at","تاريخ الإنشاء"]]} rowActions={r=><button className="table-action" onClick={()=>setForm(r)}>تعديل</button>}/>{form&&<form className="smart-form" onSubmit={save}><label><span>الاسم</span><input required value={form.name_ar||""} onChange={e=>setForm(x=>({...x,name_ar:e.target.value}))}/></label><label><span>الرمز</span><input required value={form.code||""} onChange={e=>setForm(x=>({...x,code:e.target.value}))}/></label><SelectField label="النوع" value={form.type} onChange={v=>setForm(x=>({...x,type:v}))}><option value="storage">مخزن</option><option value="bar">بار</option><option value="other">أخرى</option></SelectField><label><span>ملاحظات</span><input value={form.notes||""} onChange={e=>setForm(x=>({...x,notes:e.target.value}))}/></label><label className="check-label wide"><input type="checkbox" checked={form.active!==false} onChange={e=>setForm(x=>({...x,active:e.target.checked}))}/><span>فعال</span></label>{error&&<div className="error wide">{error}</div>}<button className="primary wide">حفظ الموقع</button></form>}</div>; }
function StocktakeForm({ items, onDone }) { const [actual, setActual] = useState(Object.fromEntries(items.map((row) => [row.id, inventoryQuantity(row)]))), [previous,setPrevious]=useState([]), [query,setQuery]=useState(""), [error, setError] = useState(""); const load=()=>api.list("stocktakes").then(x=>setPrevious(x.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))))).catch(()=>{}); useEffect(load,[]); const barcode=async(code)=>{const row=await api.lookupBarcode(code); if(row){document.getElementById(`stocktake-${row.id}`)?.focus();setQuery("");setError("");}else setError("الباركود غير مسجل");}; const save = async (e) => { e.preventDefault(); try { await api.createStocktake({ date: today(), items: items.map((row) => ({ item_id: row.id, expected_quantity: inventoryQuantity(row), actual_quantity: Number(actual[row.id]) })) }); load(); } catch (x) { setError(x.message); } }; return <div className="screen-stack"><form onSubmit={save} className="smart-form"><p className="wide">المسودة لا تغيّر المخزون؛ عند الإرسال تقفل القيم، والاعتماد فقط ينشئ حركة التسوية.</p><BarcodeInput label="مسح باركود / بحث مادة" value={query} onChange={setQuery} onScan={barcode} />{items.map((row) => <label key={row.id}><span>{row.name_ar || row.name} (المتوقع {inventoryQuantity(row)})</span><input id={`stocktake-${row.id}`} type="number" min="0" step="0.01" value={actual[row.id]} onChange={(e) => setActual((x) => ({ ...x, [row.id]: e.target.value }))} /></label>)}{error && <div className="error wide">{error}</div>}<button className="primary wide">إنشاء مسودة الجرد</button></form><Panel title="عمليات الجرد السابقة"><DataTable rows={previous} columns={[["date","التاريخ"],["status","الحالة"],["created_by","بواسطة"],["submitted_at","أُرسل في"],["approved_at","اعتُمد في"]]} rowActions={(r)=><>{r.status==="draft"&&<button className="table-action" onClick={async()=>{try{await api.submitStocktake(r.id);load();}catch(e){setError(e.message)}}}>إرسال</button>}{r.status==="submitted"&&<button className="table-action" onClick={async()=>{try{await api.approveStocktake(r.id);load();onDone();}catch(e){setError(e.message)}}}>اعتماد</button>}</>}/></Panel></div>; }
function TransferForm({ items, onDone }) { const [locations, setLocations] = useState([]), [form, setForm] = useState({ item_id: "", from_location: "main_storage", to_location: "coffee_bar", quantity: "", unit: "", date: today(), notes: "" }), [error, setError] = useState(""); useEffect(() => { api.list("inventory_locations").then((rows) => setLocations(rows.length ? rows : [{ id: "main_storage", name_ar: "المخزن الرئيسي" }, { id: "coffee_bar", name_ar: "بار القهوة" }])).catch(() => setLocations([{ id: "main_storage", name_ar: "المخزن الرئيسي" }, { id: "coffee_bar", name_ar: "بار القهوة" }])); }, []); const save = async (e) => { e.preventDefault(); try { await api.createInventoryTransfer(form); onDone(); } catch (x) { setError(x.message); } }; return <form className="smart-form" onSubmit={save}><SelectField label="المادة" value={form.item_id} onChange={(v) => { const row = items.find((x) => x.id === v); setForm((x) => ({ ...x, item_id: v, unit: row?.base_unit || row?.unit || "" })); }}><option value="">اختر مادة</option>{items.map((row) => <option key={row.id} value={row.id}>{row.name_ar || row.name}</option>)}</SelectField><SelectField label="من موقع" value={form.from_location} onChange={(v) => setForm((x) => ({ ...x, from_location: v }))}>{locations.map((row) => <option key={row.id} value={row.id}>{row.name_ar || row.name}</option>)}</SelectField><SelectField label="إلى موقع" value={form.to_location} onChange={(v) => setForm((x) => ({ ...x, to_location: v }))}>{locations.map((row) => <option key={row.id} value={row.id}>{row.name_ar || row.name}</option>)}</SelectField><label><span>الكمية</span><input required type="number" min="0.01" value={form.quantity} onChange={(e) => setForm((x) => ({ ...x, quantity: e.target.value }))} /></label><label><span>الوحدة</span><input readOnly value={unitLabel(form.unit)} /></label>{error && <div className="error wide">{error}</div>}<button className="primary wide">تأكيد النقل</button></form>; }
function InventoryItemForm({ initial, onDone, categories }) {
  const [form, setForm] = useState({
    name_ar: initial?.name_ar || initial?.name || initial?.nameAr || "",
    category_id: initial?.category_id || initial?.categoryId || "",
    purchase_unit: initial?.purchase_unit || initial?.unit || "",
    dimension: initial?.base_unit === 'ml' || initial?.base_unit === 'L' ? 'volume' : (initial?.base_unit === 'g' || initial?.base_unit === 'kg' ? 'weight' : (initial?.base_unit === 'piece' ? 'count' : '')),
    barcode: initial?.barcode || "",
    sku: initial?.sku || "",
    package_size: initial?.units_per_package ?? initial?.package_size ?? "",
    track_expiry: initial?.track_expiry === true,
    current_packages: initial ? (Number(initial?.units_per_package || 1) > 1 ? inventoryQuantity(initial) / Number(initial.units_per_package) : inventoryQuantity(initial)) : "",
    purchase_price: initial?.purchase_price ?? initial?.last_purchase_price ?? "",
    selling_price: initial?.selling_price ?? "",
    min_stock: initial ? inventoryQuantity({ ...initial, quantity: initial.min_stock || 0 }) : "",
    usage_per_serving: initial?.usage_per_serving ?? initial?.quantity_per_serving ?? "",
    notes: initial?.notes ?? "",
  });

  const [internalCode, setInternalCode] = useState(initial?.internal_barcode || "");
  const [error, setError] = useState("");
  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  let packageSize = Number(form.package_size) || 1;
  const vol = form.dimension === 'volume';
  const mass = form.dimension === 'weight';
  if (vol && form.purchase_unit === 'L') packageSize = 1000;
  if (vol && form.purchase_unit === 'ml') packageSize = 1;
  if (mass && form.purchase_unit === 'kg') packageSize = 1000;
  if (mass && form.purchase_unit === 'g') packageSize = 1;
  const currentBaseQuantity = (Number(form.current_packages) || 0) * packageSize;
  const unitCost = Number(form.purchase_price) > 0 ? Number(form.purchase_price) / packageSize : 0;
  const servingUsage = Number(form.usage_per_serving);
  const servingsPerPackage = servingUsage > 0 ? Math.floor(packageSize / servingUsage) : null;
  const servingCost = servingUsage > 0 && unitCost > 0 ? servingUsage * unitCost : null;

  const baseUnitForDimension = { volume: 'ml', weight: 'g', count: 'piece' }[form.dimension] || '';
  const isChangingDimension = initial?.id && initial.base_unit && baseUnitForDimension && baseUnitForDimension !== initial.base_unit;

  const save = async (e) => {
    e.preventDefault();
    try {
      if (!String(form.name_ar).trim()) throw new Error("اسم المادة مطلوب.");
      if (!form.category_id) throw new Error("القسم مطلوب.");
      if (!PURCHASE_UNITS.some(([value]) => value === form.purchase_unit)) throw new Error("طريقة الشراء مطلوبة.");
      if (!form.dimension) throw new Error("البعد (النوع) مطلوب.");
      if (!Number.isFinite(packageSize) || packageSize <= 0) throw new Error("حجم العبوة يجب أن يكون أكبر من صفر.");
      const volume = ["ml", "L"], mass = ["g", "kg"];
      if ((volume.includes(form.purchase_unit) && form.dimension !== 'volume') || (mass.includes(form.purchase_unit) && form.dimension !== 'weight')) throw new Error("لا يمكن خلط اللتر/المل مع الغرام/الكيلو بدون تحويل محدد للمادة.");
      const numeric = [
        ["current_packages", "الكمية الموجودة"],
        ["purchase_price", "سعر الشراء"],
        ["selling_price", "سعر البيع"],
        ["min_stock", "الحد الأدنى"],
      ];
      const data = {};
      for (const [key, label] of numeric) {
        if (form[key] === "" || !Number.isFinite(Number(form[key])) || Number(form[key]) < 0) throw new Error(`${label} يجب أن يكون رقماً لا يقل عن صفر.`);
        data[key] = Number(form[key]);
      }
      const payload = { name_ar: String(form.name_ar).trim(), category_id: form.category_id, unit: form.purchase_unit, purchase_unit: form.purchase_unit, base_unit: baseUnitForDimension, barcode: String(form.barcode || "").trim(), sku: String(form.sku || "").trim(), units_per_package: packageSize, package_size: packageSize, track_expiry: form.track_expiry === true, ...data, quantity: currentBaseQuantity, usage_per_serving: servingUsage || undefined, average_unit_cost: unitCost, notes: String(form.notes || "").trim(), active: initial?.active !== false };
      if (initial?.id) await api.update("inventory_items", initial.id, payload);
      else await api.create("inventory_items", payload);
      onDone();
    } catch (err) {
      setError(err.message || "تعذر حفظ المادة.");
    }
  };

  return <form className="smart-form inventory-item-form" onSubmit={save}>
    <fieldset className="form-group"><legend>البيانات الأساسية</legend><label><span>اسم المادة</span><input required value={form.name_ar} onChange={(e) => set("name_ar", e.target.value)} /></label><SelectField label="القسم" value={form.category_id} onChange={(v) => set("category_id", v)}><option value="">اختر القسم</option>{categories.map((x) => <option key={x.id} value={x.id}>{x.name_ar || x.nameAr || x.name}</option>)}</SelectField></fieldset>
    <fieldset className="form-group"><legend>الشراء والقياس</legend><SelectField label="أشتريها شلون؟" value={form.purchase_unit} onChange={(v) => set("purchase_unit", v)}><option value="">اختر طريقة الشراء</option>{PURCHASE_UNITS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectField><label><span>حجم العبوة / معامل التحويل</span><input required type="number" min="0.001" step="0.001" value={form.package_size} onChange={(e) => set("package_size", e.target.value)} /><small>مثال: إذا القنينة 1 لتر، اكتب 1000 واختر النوع أدناه كحجم.</small></label>
    <SelectField label="البعد الفيزيائي للمادة (النوع)" value={form.dimension} onChange={(v) => set("dimension", v)}>
      <option value="">اختر بعد المادة</option>
      <option value="volume">حجم (سوائل)</option>
      <option value="weight">وزن (مواد صلبة)</option>
      <option value="count">عدد (حبات)</option>
    </SelectField>
    {form.dimension && <div className="notice" style={{marginTop: '0'}}>وحدة القياس الأساسية المعتمدة لحساب التكلفة والمخزون هي: <strong>{unitLabel(baseUnitForDimension)}</strong></div>}
    {isChangingDimension && <div className="alert-message warning" style={{marginTop: '10px'}}><strong>تنبيه:</strong> هذه المادة مستخدمة في المخزون أو الوصفات. تغيير نوع الوحدة قد يؤثر على الكميات والحسابات السابقة.</div>}
    <label><span>الاستخدام لكل كلاص</span><input type="number" min="0" step="0.001" value={form.usage_per_serving} onChange={(e) => set("usage_per_serving", e.target.value)} /><small>اختياري — مثال: تستخدم 20 مل سيروب لكل كلاص.</small></label>{servingsPerPackage !== null && <div className="notice form-calculation">{unitLabel(form.purchase_unit)} تكفي تقريبًا <strong>{servingsPerPackage} كلاص</strong>{servingCost !== null && <span>تكلفة المادة لكل كلاص: {money(servingCost)}</span>}</div>}</fieldset>
    <fieldset className="form-group"><legend>الأسعار والمخزون</legend><label><span>سعر شراء العبوة</span><input required type="number" min="0" step="0.01" value={form.purchase_price} onChange={(e) => set("purchase_price", e.target.value)} /><small>سعر العبوة الكاملة التي تشتريها.</small></label><label><span>سعر البيع</span><input required type="number" min="0" step="0.01" value={form.selling_price} onChange={(e) => set("selling_price", e.target.value)} /></label><label><span>الكمية الموجودة</span><input required type="number" min="0" step="0.001" value={form.current_packages} onChange={(e) => set("current_packages", e.target.value)} /><small>{currentBaseQuantity} {unitLabel(baseUnitForDimension)} بالمخزون</small></label><label><span>الحد الأدنى للمخزون</span><input required type="number" min="0" step="0.001" value={form.min_stock} onChange={(e) => set("min_stock", e.target.value)} /><small>بالـ {unitLabel(baseUnitForDimension)}</small></label></fieldset>
    <fieldset className="form-group"><legend>الباركود ومعلومات إضافية</legend><label><span>الباركود</span><input value={form.barcode} onChange={(e) => set("barcode", e.target.value)} /></label><label><span>SKU — اختياري</span><input value={form.sku} onChange={(e) => set("sku", e.target.value)} /></label><label className="check-label"><input type="checkbox" checked={form.track_expiry} onChange={(e) => set("track_expiry", e.target.checked)} /><span>تتبع الانتهاء</span></label><label><span>ملاحظات — اختياري</span><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} /></label></fieldset>
    {initial?.id && <div className="wide internal-code-card"><strong>الرمز الداخلي</strong>{internalCode ? <><code>{internalCode}</code><div className="toolbar"><button type="button" className="secondary" onClick={() => navigator.clipboard?.writeText(internalCode)}>نسخ الرمز</button><button type="button" className="secondary" onClick={() => window.print()}>طباعة الملصق</button></div><LabelCodes code={internalCode} itemName={initial.name_ar || initial.name}/><small>Barcode وQR حقيقيان يولّدان محلياً ولا يتم إرسال أي صورة للخادم.</small></> : <button type="button" className="secondary" onClick={async () => { try { setInternalCode(await api.assignInternalBarcode(initial.id)); } catch (e) { setError(e.message); } }}>إنشاء رمز داخلي</button>}</div>}
    {error && <div className="error wide">{error}</div>}
    <button className="primary wide"><Check size={17} /> {initial?.id ? "تحديث المادة" : "حفظ المادة"}</button>
  </form>;
}
function LabelCodes({ code, itemName }) { const svg=useRef(null),[qr,setQr]=useState(""); useEffect(()=>{ if(svg.current&&code) JsBarcode(svg.current,code,{format:"CODE128",displayValue:true,margin:4,height:46}); QRCode.toDataURL(code,{margin:1,width:130}).then(setQr).catch(()=>setQr("")); },[code]); return <div className="label-codes"><div><svg ref={svg}/><small>Barcode</small></div>{qr&&<div><img src={qr} alt={`QR ${code}`}/><small>QR</small></div>}<div className="print-label"><strong>101 COFFEE</strong><span>{itemName}</span><code>{code}</code></div></div>; }
function Modal({ title, children, onClose, className = "" }) {
  return (
    <div className="modal-backdrop">
      <section className={`modal ${className}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose}>
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
function Loader() {
  return (
    <div className="loader">
      <img className="splash-logo" src="/assets/logo.jpg" alt="101 COFFEE" />
      <strong>COFFEE 101</strong>
      <span>Finance System</span>
    </div>
  );
}
