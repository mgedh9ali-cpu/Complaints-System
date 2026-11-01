# دليل المطوّر — نظام الشكاوى المحلي

**الإصدار:** 0.7.0  
**الهيكل:** معياري (modules/*)

## التشغيل المحلي

1. انسخ `.env.example` إلى `.env` واملأ `SESSION_SECRET` و`ADMIN_USERNAME` و`ADMIN_PASSWORD`.
2. `npm install`
3. `npm start` — يستمع على `http://127.0.0.1:3000` فقط (loopback).

## هيكل المشروع

```
server.js                 # تجميع Express + ربط الـ routers
modules/
  auth/                   # تسجيل الدخول، CSRF، المستخدمون
  complaints/             # state، الشكاوى، آلة الحالات، revision
  attachments/            # رفع/تنزيل المرفقات
  reports/                # CSV / Excel
  backup/                 # نسخ احتياطي لقاعدة SQLite
  audit/                  # سجل تدقيق متسلسل
  sync/                   # مزامنة يدوية بين نسختين
  health/                 # /api/health
  dashboard/ roles/ settings/
lib/                      # validation, logger, file-magic, excel-export, …
app.js                    # محمّل واجهة (يحمّل /app.bundle.js)
app-p01.js … app-p09.js   # أجزاء الواجهة (تُجمَّع بدون eval)
```

## الواجهة وCSP

- سياسة المحتوى تمنع `eval` و`unsafe-eval`.
- `app.js` يضيف `<script src="/app.bundle.js">` فقط.
- الخادم يقرأ `app-p01.js` … `app-p09.js` ويجمعها في الذاكرة عند الطلب.

## الاختبار

```bash
npm test
npm run check
```

اختبار تجميع الواجهة: `tests/app-bundle-regression.test.cjs`.

## إصدارات API

المسارات الحالية تحت `/api/*`. يُخطَّط لاحقًا لـ `/api/v1/*` دون كسر التوافق في إصدار انتقالي.

## الأمان

- جلسات ملفّية محلية، CSRF على العمليات الكتابية، صلاحيات admin/staff/reviewer.
- المرفقات: MIME + امتداد + magic bytes.
- revision على `app_state` لرفض الكتابة المتزامنة (409/428).


## البنية الجديدة لواجهة المستخدم

مصدر الواجهة موزّع إلى `ui/core`, `ui/components`, `ui/pages`, `ui/features` بدل `app.full.js`. يستخدم `lib/ui-bundle.js` قائمة ملفات ثابتة مرتبة، ويجمع محتواها كنص JavaScript واحد داخل نفس النطاق الأصلي؛ لذا لا تغيّر توقيع الوظائف أو ترتيب التهيئة دون تشغيل الاختبارات. لا يمكن تحميل ملفات `ui/` مباشرة عبر HTTP. استخدم `node scripts/check-ui-bundle.js` و`npm test` للتأكد من صحة التجميع. الانتقال إلى ES modules منفصلة بالكامل يحتاج إزالة الاعتماديات العامة بصورة مرحلية.
