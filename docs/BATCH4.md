# Batch 4 — استخراج attachments / reports / settings

**التاريخ:** 29 أكتوبر 2026  
**الإصدار:** 0.6.0

## ما تم

### modules/attachments
- `service.js` — غلاف حول `lib/attachments`
- `routes.js`:
  - `POST /api/attachments/:complaintId`
  - `GET /api/attachments/by-complaint/:complaintId`
  - `GET /api/attachments/:storedName`
  - `DELETE /api/attachments/:storedName`

### modules/reports
- `service.js` — CSV + Excel (كامل + شكوى واحدة)
- `routes.js`:
  - `GET /api/export/csv`
  - `GET /api/export/xlsx`
  - `GET /api/export/xlsx/:id`

### modules/settings
- `service.js` — قراءة/تطبيع/تحديث `state.settings` مع revision
- `routes.js`:
  - `GET /api/settings`
  - `PUT /api/settings` (admin + CSRF + X-State-Revision)

### server.js
- أزيلت مسارات attachments/export المضمّنة
- بقي: health, backup, static, error handler

## المتبقي
- modules/backup + modules/audit
- offline-sync إلى module
