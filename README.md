# 101 COFFEE - Cost & Finance Management System

نظام محلي بالكامل لإدارة محاسبة وتكاليف ومصاريف 101 COFFEE.

## التشغيل

```bash
npm install
npm start
```

الحساب الأولي:

- Username: `admin`
- Password: `admin123`
- Role: `Super Admin`

## بناء نسخة Windows

```bash
npm run build
npm run dist
```

سيتم إنشاء ملفات النسخة داخل مجلد `release`.

## قاعدة البيانات

النظام يستخدم SQLite محلياً عبر `better-sqlite3`.

موقع قاعدة البيانات محلي داخل مجلد المشروع:

`acc2/data/101coffee.db` (أو `%APPDATA%/101-coffee-cost-finance/data/101coffee.db` عند التثبيت كحزمة)

الجداول الأساسية:

- `users`
- `user_permission_overrides`
- `categories`
- `materials`
- `products`
- `recipe_items`
- `purchase_batches`
- `supplier_payments`
- `expenses`
- `sales`
- `employees`
- `payroll`
- `settings`
- `audit_log`

## الميزات المنفذة

- واجهة عربية RTL بهوية 101 COFFEE.
- العملة الافتراضية: الدينار العراقي `د.ع`.
- Dashboard يحذف القيم الحساسة إذا لم يملك المستخدم صلاحيتها.
- POS سريع لتسجيل المصاريف حسب الأقسام.
- إدارة مشتريات المواد مع حفظ كل دفعة Purchase Batch بشكل مستقل.
- حساب سعر الوحدة تلقائياً.
- حساب Weighted Average Cost للمخزون.
- عرض المخزون الحالي ومتوسط التكلفة وقيمة المخزون وآخر/أعلى/أقل سعر.
- إدارة مواد ومنتجات ووصفات.
- حساب COGS والربح الإجمالي للمبيعات من تكلفة الوصفة الحالية.
- مصاريف تشغيلية ومصاريف متكررة كبيانات قابلة للتسجيل.
- موظفون ورواتب: الراتب الأساسي، السلفة، الخصم، المكافأة، صافي المدفوع.
- موردون وديون: إجمالي المشتريات، المدفوع، المتبقي.
- Users & Permissions بنظام RBAC وأذونات تفصيلية.
- Custom permission overrides لكل مستخدم.
- حماية Super Admin، ويجب أن يبقى Super Admin فعال واحد على الأقل.
- Audit Log لتسجيل الدخول والتغييرات وتغييرات الصلاحيات.
- Backup لملف SQLite.
- Export Excel للجداول المسموحة حسب صلاحيات المستخدم.

## الصلاحيات

الأدوار الافتراضية:

- `super_admin`: كل الصلاحيات.
- `manager`: صلاحيات إدارية ومالية واسعة، بدون reset/restore حساس افتراضياً.
- `supervisor`: تشغيل ومخزون ومبيعات ومصاريف مع أرباح حسب الإعداد.
- `employee`: إدخال بيانات وعملياته فقط، بدون أرباح أو تقارير مالية حساسة.
- `viewer`: مشاهدة محدودة.

الصلاحيات الحساسة مثل:

- `financial.view_revenue`
- `financial.view_cogs`
- `financial.view_gross_profit`
- `financial.view_net_profit`
- `financial.view_profit_margin`

يتم التحقق منها في Electron main process قبل إرسال القيم للواجهة.

## الفحوصات المنفذة

```bash
npm run check
```

يتضمن:

- `node --check main.js`
- `node --check preload.js`
- `vite build`

النتيجة: نجح البناء.

## ملاحظات تحتاج بيانات حقيقية لاحقاً

- استيراد Excel القديم يحتاج ملف Excel فعلي داخل المشروع لتحليل الأعمدة وربطها.
- صور/PDF الفواتير لم تربط بعد بمجلد مرفقات محلي.
- Approval workflow موجود كبداية في حالة المصاريف الكبيرة، لكن شاشة الموافقات التفصيلية لم تفصل بعد.
- Monthly Closing و Undo Import و Restore Database تحتاج شاشات تأكيد وسجل عمليات أوسع قبل استخدامها في الإنتاج.
