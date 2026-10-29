# خطة تطوير نظام الشكاوى — من Prototype إلى نظام قابل للتوسع

**الإصدار الحالي:** 0.6.0  
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
- [x] إزالة تكرار requireAuth من server
- [x] اختبارات وحدة للـ auth + فحص الهيكل المعياري
- [x] توسيع CI ليشمل فروع chore/fix/feat
- [ ] استخراج attachments / reports / backup إلى modules
- [ ] API versioning `/api/v1/...`
- [ ] Developer Guide

## المرحلة 3 — الارتقاء الوظيفي

- تقارير أدق، إشعارات، SLA، إحالات

## المرحلة 4 — الإنتاج

- مراقبة health/metrics، استراتيجية نسخ احتياطي موثقة
