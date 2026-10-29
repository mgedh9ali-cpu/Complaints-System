# استرجاع ميزات الأفرع المحذوفة — لإعادة البناء

**التاريخ:** 29 أكتوبر 2026  
**المستودع:** `mgedh9ali-cpu/Complaints-System`  
**الهدف:** توثيق كل ما كان في الأفرع غير المدموجة (من المحادثات + ملفات artifacts + سجل Actions) حتى نعيد بناء الميزات على `main` بشكل منظم.

---

## 1) ملخص سريع: ماذا كان موجوداً؟

| المرحلة / الفرع | الميزات الأساسية | حالة الاسترجاع المحلي |
|-----------------|------------------|------------------------|
| `chore/phase1-foundation` | Logger موحّد، فحص magic-bytes للمرفقات، أساس modules | ✅ ملفات في artifacts |
| `chore/phase1-service-layer` | service للشكاوى، آلة حالات، revision على state، مزامنة جدول complaints | ✅ منطق في نسخ server + roadmap |
| `chore/phase2-modular-auth` | modules/auth + complaints routes، اختبارات، CI موسّع، 0.6.0 | ✅ payload كامل في push_phase2.json |
| `feat/prevent-concurrent-state-overwrite` | `X-State-Revision` + رفض 409/428 عند التعارض | ✅ داخل routes الشكاوى المسترجعة |
| `feat/attachments-excel-ui-polish` | مرفقات + Excel + polish واجهة | ✅ جزئي في lib/server + ui-enhancements |
| `fix/attachment-content-validation` | توافق المحتوى مع الامتداد (magic bytes) | ✅ lib/file-magic.js + اختبارات |
| `fix/critical-complaint-state-and-settings` / `v2` | إصلاحات حالة الشكوى والإعدادات | ✅ أنماط في server-fixed / routes |
| `fix/green-ci-restore-sync-routes` | مسارات sync + جعل CI أخضر | ⚠️ يحتاج مراجعة server-with-sync |
| `feat/production-bundle` | حزمة تشغيل/تثبيت إنتاج 0.6.0 | ⚠️ أجزاء في prod-bundle |
| `fix/pr-33-conflicts` / `fix/pr41-*` / revert | حل تعارضات PR | معلومات تاريخية فقط |
| `local-sqlite-foundation` | أساس SQLite محلي | مدمج أصلاً في تصميم النظام |

---

## 2) تفاصيل الميزات لإعادة البناء

### أ) المرحلة 1 — الاستقرار

1. **Logger موحّد** (`lib/logger.js`)
   - مستويات: error / warn / info / debug
   - مخرجات JSON سطرية
   - إخفاء password / sessionSecret من السجلات
   - `logger.requestError(err, req)`

2. **فحص محتوى المرفقات (magic bytes)** (`lib/file-magic.js`)
   - توقيعات: PDF, JPEG, PNG, GIF, WEBP, ZIP, OLE
   - `detectMimeFromBuffer(buffer)`
   - `isContentCompatible(claimedMime, detectedMime, ext)`
   - رفض الملفات الثنائية المجهولة

3. **طبقة service للشكاوى**
   - `readState()` / `saveState({ state, userId, expectedRevision, diffComplaints })`
   - `changeStatus(...)` مع آلة حالات
   - مزامنة جدول `complaints` عند الحفظ وتغيير الحالة
   - عمود `revision` على `app_state` ومنع الكتابة المتزامنة

4. **إصلاح مسار تغيير الحالة**
   - المسار الرسمي: `PATCH /api/complaints/:id/status`
   - منع تغيير الحالة عبر `PUT /api/state` (409)

### ب) المرحلة 2 — الهيكل المعياري (0.6.0)

```
modules/
  auth/
    middleware.js   # requireAuth, requireRole, requireCsrf
    service.js      # authenticate, createUser, setActive, ensureBootstrapAdmin, listUsers
    routes.js       # /api/csrf, /api/auth/*, /api/users/*
  complaints/
    service.js      # readState, saveState, changeStatus
    routes.js       # /api/state, /api/complaints, /api/complaints/:id/status
```

- `server.js` يركّب الجلسة وقاعدة البيانات ويربط الـ routers فقط
- إزالة تكرار requireAuth/requireRole/requireCsrf من server
- اختبارات:
  - `tests/auth-module.test.cjs`
  - `tests/modular-structure.test.cjs`
- CI: فروع `main`, `local-sqlite-foundation`, `chore/**`, `fix/**`, `feat/**`

### ج) ميزات وظيفية موجودة في النسخ المحلية

- **مرفقات:** رفع / تنزيل / حذف / قائمة حسب الشكوى
- **تصدير:** CSV + Excel (تقرير كامل + شكوى واحدة)
- **نسخ احتياطي قاعدة البيانات** (مسار admin)
- **Offline sync:** create/validate package + stage/verify program update
- **إدارة مستخدمين:** قائمة، إنشاء، تفعيل/تعطيل (admin)
- **CSRF + rate limit على تسجيل الدخول**
- **جلسات ملفّية** + helmet CSP
- **واجهة:** زر إظهار كلمة المرور، Excel، ثيم، بحث متقدم (ui-enhancements)

### د) ما لم يكتمل (من roadmap)

- استخراج modules لـ: attachments / reports / backup / settings / audit
- API versioning `/api/v1/...`
- Developer Guide
- تقارير إدارية أدق، SLA متقدم، إحالات أغنى
- مراقبة health/metrics للإنتاج

---

## 3) مصادر الاسترجاع المحلية (artifacts)

| المصدر | المحتوى |
|--------|---------|
| `push_phase2.json` | كامل ملفات phase2 (auth modules + complaints routes + tests + server) |
| `push_parts_*` | نسخ مفكوكة من phase2 |
| `complaints-work/lib/` | logger.js, file-magic.js, attachments.js |
| `complaints-work/tests/` | اختبارات security للمرفقات وmagic |
| `Complaints-System/server-*.js` | نسخ server حسب المرحلة |
| `Complaints-System/app*.js` | واجهة كاملة |
| `app-login-fixed.js` | app.js كامل مع إصلاح تنسيق زر الدخول |
| `prod-bundle/` | أجزاء حزمة الإنتاج |
| `roadmap.md` / `roadmap-0.6.md` | خطة المراحل |

---

## 4) خطة إعادة البناء المقترحة (على main فقط)

### الدفعة 1 — أساس نظيف (أولوية قصوى)
1. استعادة `app.js` الكامل (من `app-login-fixed.js`) مع إصلاح CSS الدخول
2. إعادة `lib/logger.js` و `lib/file-magic.js`
3. ربط فحص magic-bytes في مسار رفع المرفقات
4. التأكد أن revision + تعارض الحالة يعملان

### الدفعة 2 — الهيكل المعياري
1. إعادة `modules/auth/{middleware,service,routes}.js`
2. إعادة `modules/complaints/{service,routes}.js`
3. server.js يركّب الـ routers فقط
4. إعادة الاختبارات `auth-module` و `modular-structure`
5. تحديث CI وpackage إلى 0.6.x

### الدفعة 3 — الميزات الوظيفية
1. مرفقات + Excel
2. مسارات sync/backup إن كانت ناقصة
3. polish الواجهة (ui-enhancements)

### الدفعة 4 — ما كان مخططاً ولم يُبنَ
1. modules للـ attachments/reports/backup/settings
2. `/api/v1`
3. دليل المطوّر

---

## 5) قواعد العمل بعد الحذف

- لا نعيد إنشاء أسماء الأفرع القديمة.
- كل دفعة = عمل على `main` أو فرع قصير ثم دمج.
- المصدر المعتمد لإعادة البناء: هذا الملف + ملفات artifacts.

---

*مُسترجع من: سجلات Actions، push_phase2، roadmaps، complaints-work، نسخ server/app المحلية.*
