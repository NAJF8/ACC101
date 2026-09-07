# 101 COFFEE - Cost & Finance Management System

نظام إدارة محاسبة وتكاليف ومصاريف 101 COFFEE. تم تحديثه ليعمل بشكل سحابي باستخدام Firebase (Authentication + Realtime Database) ليكون المصدر الرئيسي للبيانات (Source of Truth) بدلاً من SQLite، مما يسمح بالتزامن الحي عبر أجهزة متعددة.

## التشغيل المحلي (Web)

```bash
npm install
npm run dev
```

## إعدادات Firebase

هذا المشروع يستخدم Firebase بشكل كامل. للتشغيل، تأكد من وجود ملف `.env` (الذي لا يُرفع إلى GitHub للأمان) يحتوي على:
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_DATABASE_URL=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

### الحساب الأولي (Super Admin)
بما أن النظام يعتمد على Firebase Auth، يجب عليك إنشاء الحساب الأولي من خلال لوحة تحكم Firebase Authentication وتفعيل Email/Password، ثم إضافة المستخدم إلى Realtime Database بصلاحيات `super_admin`:
```json
{
  "name": "Super Admin",
  "username": "admin@101coffee.local",
  "role": "super_admin",
  "status": "active"
}
```


## النشر والاستضافة (Deployment)

النظام مهيأ ليتم نشره على منصتين:

### 1. GitHub Pages
واجهة عرض فقط وتستضيف نسخة Frontend، وتبقى البيانات في Firebase.
يتم النشر تلقائياً عبر GitHub Actions عند الدفع إلى فرع `main`.

```bash
npm run build:github
# يقوم ببناء المشروع مع Base Path مخصص لـ GitHub Pages
```

### 2. Firebase Hosting
النسخة الإنتاجية الأساسية.

```bash
npm run build:firebase
firebase deploy --only hosting,database
```

## نظام الصلاحيات والأدوار (Roles & Permissions)

- `super_admin`: كل الصلاحيات.
- `manager`: صلاحيات إدارية ومالية واسعة.
- `supervisor`: إدارة عمليات وإدخال.
- `employee`: إدخال بيانات فقط، ولا يملك صلاحية رؤية الأرباح الحساسة.
- `viewer`: مشاهدة محدودة.

قواعد البيانات محصنة عبر `database.rules.json` بحيث لا يتمكن أي شخص غير مخول أو Employee من قراءة التقارير الحساسة من قاعدة البيانات، حتى من خلال Developer Tools.

## بناء نسخة Windows (Electron)

النظام لا يزال يدعم إصدار سطح المكتب، والذي سيستخدم نفس بيانات Firebase عندما يكون متصلاً بالإنترنت:

```bash
npm run build
npm run dist
```
سيتم إنشاء ملفات النسخة داخل مجلد `release`.

## التقارير (Reports)

يتم تصدير البيانات إلى Excel مباشرة من البيانات المستلمة عبر Firebase.
