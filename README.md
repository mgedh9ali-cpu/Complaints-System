# شعبة الاستفسارات والشكاوى

نظام عربي **محلي** لإدارة الشكاوى — SQLite، جلسات محفوظة، مرفقات، تقارير Excel، ومزامنة يدوية بملف.

**الإصدار: 0.7.2**

[![Node](https://img.shields.io/badge/node-%3E%3D20.6-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-private-lightgrey)](#)

> تحذير: لا تُدخل بيانات مواطنين حقيقية قبل مراجعة أمنية. انظر [SECURITY.md](SECURITY.md).

## التشغيل السريع

### سطح مكتب (Windows)

```bash
npm install
start-desktop.bat
```

أو: `npm run start:desktop`

### متصفح

```bash
npm install
npm start
```

ثم افتح http://127.0.0.1:3000 — أو استخدم `start-windows.bat`.

### بناء محمول

```bash
npm run dist:win
```

المخرج في `dist-desktop/`.

### متغيرات البيئة

انسخ `.env.example` إلى `.env` أو دع أول تشغيل ينشئه تلقائياً.

```
SESSION_SECRET=...          # 32 حرفاً على الأقل
ADMIN_USERNAME=admin
ADMIN_PASSWORD=...
AUTO_BACKUP_HOURS=6
```

## بنية المشروع

| المسار | الوظيفة |
|--------|----------|
| `server.js` | نقطة دخول Express + SQLite |
| `modules/` | وحدات: auth، complaints، attachments، reports، backup، audit، sync، … |
| `lib/` | أدوات مشتركة (logger، validation، offline-sync، …) |
| `app.full.js` | واجهة المستخدم الكاملة (مصدر مقروء) |
| `app.js` | محمّل خفيف يطلب `/app.bundle.js` |
| `desktop/` | غلاف Electron لنافذة سطح المكتب |
| `tests/` | اختبارات Node مدمجة |
| `scripts/` | إعداد محلي، نسخ احتياطي، تحقق تدقيق |
| `docs/` | وثائق التطوير والقبول |

واجهة المستخدم تُقدَّم من **`app.full.js`** (مع احتياطي `app-p01.js`…). لم تعد تُستخدم أجزاء Base64/Gzip المجزّأة.

## واجهة API (ملخص)

كل المسارات تحت `/api` وتتطلب جلسة حيث يُشار لذلك.

| المجموعة | أمثلة |
|----------|--------|
| صحة | `GET /api/health` |
| مصادقة | `POST /api/auth/login`، تغيير كلمة المرور، خروج |
| شكاوى | إنشاء/تحديث/تغيير حالة |
| مرفقات | رفع/تنزيل/حذف |
| تقارير | `GET /api/export/csv`، `/api/export/xlsx`، ملخص |
| مزامنة | `GET /api/sync/export`، `POST /api/sync/import` |
| نسخ احتياطي وتدقيق | مسارات تحت backup و audit |

التفاصيل في الكود داخل `modules/*/routes.js`.

## الميزات

| الميزة | الحالة |
|--------|--------|
| نافذة سطح مكتب (Electron) | ✅ |
| صلاحيات دقيقة + CSRF | ✅ |
| مرفقات مع فحص المحتوى | ✅ |
| تقارير CSV / Excel | ✅ |
| مزامنة يدوية + تعارضات | ✅ |
| سجل تدقيق متسلسل | ✅ |
| أدوار admin / staff / reviewer | ✅ |

## الاختبار

```bash
npm test
npm run check
```

## الأمان

انظر [SECURITY.md](SECURITY.md). النظام يستمع على `127.0.0.1` فقط.
