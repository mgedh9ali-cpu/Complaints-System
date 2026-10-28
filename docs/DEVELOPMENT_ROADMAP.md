# خطة تطوير نظام الشكاوى — من Prototype إلى نظام قابل للتوسع

**الإصدار الحالي:** 0.6.0  
**الفرع:** `chore/phase2-modular-auth`

---

## المرحلة 1 — الاستقرار ✅

- [x] Logger موحّد + فحص مرفقات (magic bytes)
- [x] طبقة service للشكاوى + آلة حالات
- [x] إصلاح مسار تغيير الحالة
- [x] مزامنة جدول complaints
- [x] ربط logger في server

## المرحلة 2 — تنظيم البنية (جارية)

- [x] نقل المصادقة والمستخدمين إلى `modules/auth` (service + routes + middleware)
- [x] نقل مسارات state/complaints/status إلى `modules/complaints/routes`
- [x] إزالة تكرار requireAuth/requireRole/requireCsrf من server
- [x] اختبارات وحدة للـ auth service + فحص الهيكل المعياري
- [x] توسيع CI ليشمل فروع chore/fix/feat
- [ ] استخراج attachments / reports / backup إلى modules
- [ ] API versioning `/api/v1/...`
- [ ] Developer Guide

## المرحلة 3 — الارتقاء الوظيفي

- تقارير أدق، إشعارات، SLA، إحالات، قوائم قابلة للتخصيص

## المرحلة 4 — الإنتاج

- مراقبة health/metrics، استراتيجية نسخ احتياطي موثقة، صلاحيات أقوى

---

## الهيكل الحالي

```
modules/
  auth/
    middleware.js   # requireAuth, requireRole, requireCsrf
    service.js      # authenticate, createUser, setActive, bootstrap
    routes.js       # /csrf, /auth/*, /users/*
  complaints/
    service.js      # readState, saveState, changeStatus
    routes.js       # /state, /complaints, /complaints/:id/status
```

`server.js` يركّب الجلسة وقاعدة البيانات ويربط الـ routers، ويحتفظ مؤقتًا بمسارات المرفقات والمزامنة والنسخ الاحتياطي.
