# شعبة الاستفسارات والشكاوى

نظام عربي **محلي** لإدارة الشكاوى والاستفسارات — يعمل على الجهاز نفسه عبر Node.js وSQLite، مع واجهة ويب وغلاف سطح مكتب Electron.

**الإصدار: 0.7.4**

[![Node](https://img.shields.io/badge/node-%3E%3D20.6-brightgreen)](https://nodejs.org)

> تحذير: لا تُدخل بيانات مواطنين حقيقية قبل مراجعة أمنية. انظر [SECURITY.md](SECURITY.md).

## ماذا يفعل النظام؟

- تسجيل الشكاوى ودورة حياتها (مسودة → جديدة → معالجة → إغلاق)
- مستخدمون وأدوار: `admin` / `staff` / `reviewer`
- مرفقات مع فحص المحتوى
- تقارير CSV / Excel / PDF لشكوى واحدة
- نسخ احتياطي لقاعدة البيانات
- مزامنة يدوية بملف مع كشف تعارضات
- سجل تدقيق بسلسلة hash

## التشغيل

```bash
npm install
cp .env.example .env   # عدّل SESSION_SECRET وكلمة مرور المدير
npm start
```

ثم افتح: **http://127.0.0.1:3000**

### سطح مكتب

```bash
npm run start:desktop
```

أو على Windows: `start-desktop.bat` / `start-windows.bat`

### بناء محمول

```bash
npm run dist:win
```

المخرج في `dist-desktop/`.

### متغيرات `.env` الأساسية

```env
SESSION_SECRET=...          # 32 حرفاً على الأقل
ADMIN_USERNAME=admin
ADMIN_PASSWORD=...          # 12 حرفاً على الأقل
HOST=127.0.0.1
PORT=3000
DATABASE_PATH=./data/complaints.sqlite
```

## البنية

```text
.
├── desktop/          غلاف Electron
├── docs/             وثائق
├── lib/              أدوات مشتركة
├── modules/          وحدات API
│   ├── auth/
│   ├── roles/
│   ├── complaints/   إنشاء، تعديل، حذف، مسودة، حالات
│   ├── dashboard/
│   ├── attachments/
│   ├── reports/      CSV / Excel / PDF
│   ├── settings/
│   ├── backup/
│   ├── audit/
│   ├── sync/
│   └── health/
├── scripts/
├── tests/
├── fonts/            خط Thmanyah Sans (إن وُجد)
├── server.js
├── app.js / app.full.js
├── index.html
├── styles.css / ui-enhancements.css
└── package.json
```

التفاصيل: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## واجهة API (ملخص)

| المجموعة | أمثلة |
|----------|--------|
| صحة | `GET /api/health` |
| مصادقة | تسجيل دخول، خروج، تغيير كلمة المرور |
| شكاوى | `POST /api/complaints`، `PATCH /api/complaints/:id`، `DELETE /api/complaints/:id`، تغيير الحالة |
| مرفقات | رفع / تنزيل / حذف |
| تقارير | CSV، XLSX، `GET /api/export/pdf/:id` |
| مزامنة / نسخ / تدقيق | تحت `/api/sync`، `/api/backup`، `/api/audit` |

## الميزات

| الميزة | الحالة |
|--------|--------|
| سطح مكتب Electron | ✅ |
| مسودة / تعديل / حذف شكوى | ✅ |
| صلاحيات + CSRF | ✅ |
| مرفقات + فحص محتوى | ✅ |
| CSV / Excel / PDF | ✅ |
| مزامنة يدوية | ✅ |
| تدقيق متسلسل | ✅ |
| خط Thmanyah | ✅ (ضع ملفات woff2 في `fonts/`) |

## الاختبار

```bash
npm test
npm run check
```

## المساهمة والأمان

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md) — الاستماع على `127.0.0.1` فقط
