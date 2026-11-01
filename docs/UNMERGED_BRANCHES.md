# أفرع غير مدموجة — قرار الحذف

**التاريخ:** 29 أكتوبر 2026  
**المستودع:** `mgedh9ali-cpu/Complaints-System`  
**فرع العمل الرسمي:** `main` (توجد فروع تاريخية إضافية على GitHub)

هذا الملف يوثّق الأفرع التي ظهرت في المحادثات السابقة وفي سجل GitHub Actions، ولم تُدمَج إلى `main` (أو كانت مؤقتة)، واتُخذ قرار بحذفها لتنظيف المستودع.

## الحالة الآن

عند آخر تحقق في 1 تشرين الثاني 2026، ظهرت فروع تاريخية أخرى إلى جانب `main`: `design/redesign-app-structure-v1`، `fix/complete-split-ui-bundle`، `fix/p0-critical-hardening`، `fix/restore-functional-app`، `fix/windows-fonts-data-integrity-20261101`، و`restore-ui-segments`. لا يعني وجودها اعتمادًا أو جاهزيتها للدمج.  
الأفرع أدناه إما حُذفت مسبقاً أو لم تعد ظاهرة كفروع بعيدة.

## قائمة الأفرع غير المدموجة (مرشّحة للحذف / محذوفة)

| # | اسم الفرع | ملاحظة من السجلات |
|---|-----------|-------------------|
| 1 | `chore/phase1-foundation` | مرحلة استقرار أولية (logger، مرفقات، أساس modules) |
| 2 | `chore/phase1-service-layer` | طبقة service للشكاوى + آلة الحالات (مذكور في roadmap 0.5.2) |
| 3 | `chore/phase2-modular-auth` | نقل auth/complaints إلى modules (مذكور في roadmap 0.6.0) |
| 4 | `feat/production-bundle` | حزمة الإنتاج 0.6.0 + CI بدون lockfile |
| 5 | `feat/attachments-excel-ui-polish` | تحسينات واجهة المرفقات وExcel |
| 6 | `feat/prevent-concurrent-state-overwrite` | منع الكتابة المتزامنة على state |
| 7 | `fix/attachment-content-validation` | التحقق من محتوى المرفقات |
| 8 | `fix/critical-complaint-state-and-settings` | إصلاحات حرجة للحالة والإعدادات |
| 9 | `fix/critical-state-v2` | متابعة إصلاحات الحالة |
| 10 | `fix/green-ci-restore-sync-routes` | إصلاح CI ومسارات المزامنة |
| 11 | `fix/pr-33-conflicts` | حل تعارضات PR 33 |
| 12 | `fix/pr41-remaining-on-main` | بقايا PR 41 |
| 13 | `revert-49-fix/pr41-remaining-on-main` | revert مرتبط بـ PR 41 |
| 14 | `local-sqlite-foundation` | مذكور في CI (`node-checks.yml`) كفرع قديم |

## فروع يُحتفظ بها

- **`main`** — الفرع الرسمي المعتمد للتطوير المباشر حاليًا؛ الفروع التاريخية المتبقية لا يُعمل عليها.

## قرار العمل

1. عدم إعادة إنشاء الأفرع أعلاه إلا إذا احتجنا محتوى تاريخياً محدداً من commit قديم.
2. كل عمل جديد يجري مباشرة على `main` حسب تعليمات مالك المشروع؛ لا تُنشأ فروع تطوير فرعية دون توجيه منه.
3. إن ظهر أحد هذه الأفرع مجدداً على البعيد ولم يُدمَج: يُحذف بعد التأكد أنه لا يحتوي commits غير موجودة في `main`.

## كيف تتحقق محلياً (اختياري)

```bash
git fetch --all --prune
git branch -r
# قد تظهر الفروع التاريخية المذكورة أعلاه حتى تُراجع وتحذف بإذن المالك
```

---
*أُنشئ تلقائياً من سجل Actions وملفات المشروع (roadmap، push payloads، CI) بعد قرار تنظيف الأفرع غير المدموجة.*
