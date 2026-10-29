# خطة تطوير نظام الشكاوى — من Prototype إلى نظام قابل للتوسع

**الإصدار الحالي:** 0.7.0  
**الفرع:** main

---

## المرحلة 1 — الاستقرار ✅

- [x] Logger موحّد + فحص مرفقات (magic bytes)
- [x] طبقة service للشكاوى + آلة حالات
- [x] إصلاح مسار تغيير الحالة
- [x] مزامنة جدول complaints
- [x] ربط logger في server

## المرحلة 2 — تنظيم البنية ✅

- [x] نقل المصادقة والمستخدمين إلى `modules/auth`
- [x] نقل مسارات state/complaints/status إلى `modules/complaints`
- [x] استخراج attachments / reports / backup / audit / sync / health إلى modules
- [x] اختبارات وحدة للـ auth + فحص الهيكل المعياري
- [x] واجهة كاملة عبر أجزاء app-p01…p09 بدون eval (متوافقة مع CSP)
- [x] Developer Guide
- [ ] API versioning `/api/v1/...` (اختياري لاحقًا)

## المرحلة 3 — الارتقاء الوظيفي

- تقارير أدق، إشعارات، SLA، إحالات متقدمة

## المرحلة 4 — الإنتاج

- مراقبة health/metrics موسّعة، استراتيجية نسخ احتياطي موثقة ومختبرة
