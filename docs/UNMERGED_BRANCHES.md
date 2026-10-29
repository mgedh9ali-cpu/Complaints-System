# أفرع غير مدموجة — قرار الحذف

**التاريخ:** 29 أكتوبر 2026  
**المستودع:** `mgedh9ali-cpu/Complaints-System`  
**الفرع الحالي الوحيد على GitHub:** `main`

هذا الملف يوثّق الأفرع التي ظهرت في المحادثات السابقة وفي سجل GitHub Actions، ولم تُدمَج إلى `main` (أو كانت مؤقتة)، واتُخذ قرار بحذفها لتنظيف المستودع.

## الحالة الآن

عند كتابة هذا الملف: لا يوجد على المستودع البعيد سوى فرع `main`.  
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

- **`main`** — الفرع الرسمي الوحيد.

## قرار العمل

1. عدم إعادة إنشاء الأفرع أعلاه إلا إذا احتجنا محتوى تاريخياً محدداً من commit قديم.
2. أي عمل جديد يبدأ من `main` بفرع قصير العمر ثم يُدمَج أو يُحذف.
3. إن ظهر أحد هذه الأفرع مجدداً على البعيد ولم يُدمَج: يُحذف بعد التأكد أنه لا يحتوي commits غير موجودة في `main`.

## كيف تتحقق محلياً (اختياري)

```bash
git fetch --all --prune
git branch -r
# يجب أن يظهر origin/main فقط (أو فروع عمل نشطة قصيرة)
```

---
*أُنشئ تلقائياً من سجل Actions وملفات المشروع (roadmap، push payloads، CI) بعد قرار تنظيف الأفرع غير المدموجة.*
