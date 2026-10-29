# Batch 3 — المرحلة 3 (بداية)

**التاريخ:** 29 أكتوبر 2026  
**الإصدار:** 0.6.0 (phase 3 start)

## ما تم

### modules/roles
- `service.js` — تعريف الأدوار (`admin` / `staff` / `reviewer`) ومصفوفة الصلاحيات `PERMISSIONS`
- `can(role, action)` و `requirePermission(action)` للاستخدام من المسارات
- `routes.js`:
  - `GET /api/roles`
  - `GET /api/roles/:roleId`
  - `GET /api/roles/:roleId/permissions`

### modules/dashboard
- `service.js` — `buildSummary()` يحسب:
  - الإجمالي / المفتوحة / المتأخرة / بانتظار الاعتماد
  - عاجلة بلا مسؤول / سجلات ناقصة الحقول
  - توزيع حسب الحالة والأولوية والمحافظة
  - أحدث الشكاوى + قائمة المتأخرات
- `routes.js`:
  - `GET /api/dashboard/summary?recent=5`

### ربط في server.js
- إنشاء `rolesService` و `dashboardService`
- `app.use('/api', createRolesRouter(...))`
- `app.use('/api', createDashboardRouter(...))`

## التالي (تكملة المرحلة 3)
- استخراج attachments / reports / settings إلى modules
- إشعارات + SLA أدق
- قوائم قابلة للتخصيص (محافظات / جهات / تصنيفات)
