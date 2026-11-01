# بنية نظام الشكاوى المحلي

## نظرة عامة

نظام عربي محلي لإدارة الشكاوى والاستفسارات، يعمل على الجهاز نفسه عبر Node.js مع SQLite، مع واجهة ويب وغلاف سطح مكتب Electron. يركز على تسجيل الشكاوى، إدارة المستخدمين بالأدوار، المرفقات، التقارير، النسخ الاحتياطي، ومراجعة التدقيق عبر سلسلة hash.

## Stack

| الطبقة | التقنية |
|--------|----------|
| لغة | JavaScript، HTML، CSS |
| تشغيل | Node.js ≥ 20.6 + Express |
| قاعدة بيانات | SQLite عبر `better-sqlite3` |
| سطح مكتب | Electron |
| مكتبات بارزة | express-session، helmet، multer، exceljs، bcryptjs |

## التنظيم

```text
.
├── desktop/          غلاف سطح المكتب Electron
├── docs/             وثائق المشروع
├── lib/              منطق مشترك: تسجيل، validation، audit integrity، diff
├── modules/          وحدات التطبيق
│   ├── auth/         تسجيل الدخول، الجلسات، CSRF، المستخدمين
│   ├── roles/        أدوار وصلاحيات
│   ├── complaints/   إنشاء / تعديل / حذف / مسودة / حالات
│   ├── dashboard/    لوحات الإحصائيات
│   ├── attachments/  رفع / عرض / حذف المرفقات
│   ├── reports/      تقارير CSV / Excel / PDF
│   ├── settings/     المقاطعات، الجهات، الفئات، SLA
│   ├── backup/       نسخ احتياطي لقاعدة البيانات
│   ├── audit/        سجل التدقيق
│   ├── sync/         مزامنة يدوية مع كشف تعارضات
│   └── health/       فحص الحالة
├── scripts/          أدوات مساعدة
├── tests/            اختبارات Node
├── ui/               مصادر واجهة موزعة (15 ملفًا)
├── lib/ui-bundle.js  تجميع المصادر الآمن
├── app.js            محمّل الواجهة
├── server.js         الخادم + SQLite + الجلسات + الـ routers
├── index.html        نقطة دخول الواجهة
├── styles.css        التنسيق الأساسي
├── ui-enhancements.* تحسينات الواجهة وخط Thmanyah
└── package.json
```

## كيف يتكامل؟

`server.js` يهيئ SQLite والجلسات وCSRF، ثم يربط كل وحدة تحت `/api` عبر routers في `modules/*`. كل وحدة تعتمد على `service.js` لمنطقها. الواجهة تُحمَّل من 15 مصدرًا داخل `ui/` عبر دالة `assembleUiBundle()` ثم `/app.bundle.js`. لا يُقدَّم مسار `ui/` مباشرةً ولا تُستخدم `eval`. صفحة ملف الشكوى منفصلة ضمن واجهة SPA (الرابط المحلي `#complaint/:id`).

## التشغيل

```bash
npm install
cp .env.example .env
npm start                 # http://127.0.0.1:3000
npm run start:desktop     # نافذة Electron
```

على Windows: `start-windows.bat` أو `start-desktop.bat`.

## دورة حياة الشكوى

```text
draft ──► new ──► in_progress ──► awaiting_reply / awaiting_approval ──► closed
  │         │           │                                              cancelled
  └─────────┴───────────┴──────────────────────────────────────────────┘
```

- المسودة: حفظ غير منشور
- الإغلاق/الإلغاء: سبب إلزامي (≥ 3 أحرف)
- التعديل: للحالات غير المغلقة/الملغاة
- الحذف: للمسودة والجديدة والملغاة فقط
