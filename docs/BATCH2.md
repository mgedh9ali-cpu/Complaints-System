# Batch 2 — الهيكل المعياري (0.6.0)

**التاريخ:** 29 أكتوبر 2026  
**الحالة:** مكتمل على main

## ما تم دفعه

- `modules/auth/routes.js`
- `modules/complaints/service.js` — readState / saveState / changeStatus + آلة الحالات
- `modules/complaints/routes.js` — /state, /complaints, /complaints/:id/status
- `server.js` — يركّب الجلسة وقاعدة البيانات ويربط الـ routers تحت `/api`
- اختبارات: `tests/auth-module.test.cjs`, `tests/modular-structure.test.cjs`
- `package.json` → 0.6.0
- CI موسّع

## الواجهة (دفعة 1 مكتملة)

- `app.js` محمّل gzip+base64 من `app-b64-t00.txt` … `app-b64-t16.txt`
- إصلاح CSS زر تسجيل الدخول
