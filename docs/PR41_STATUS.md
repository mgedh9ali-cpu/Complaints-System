# حالة PR #41 بالنسبة لـ main الحالي

**تاريخ المراجعة:** 2026-10-28

## الخلاصة

معظم أهداف PR #41 **موجودة أصلًا في `main` الحالي**. دمج الفرع القديم كما هو قد يسبب تعارضًا أو تراجعًا عن تحسينات لاحقة على `server.js`.

| الهدف | حالة main | إجراء |
|--------|-----------|--------|
| مسارات `/api/sync/export` و `/api/sync/import` | موجودة | لا حاجة لإعادة الإضافة |
| CSRF على الاستيراد + اختبارات users/offline-sync | موجودة (ترسل `X-CSRF-Token`) | لا حاجة |
| خريطة أولوية Excel `normal → عادية` | موجودة | اختبار انحدار أُضيف |
| حماية prototype pollution في validation | جزئية | **قُوّيت في هذا الفرع** |

## ما يقدّمه الفرع `fix/pr41-remaining-on-main`

1. `lib/validation.js` — فحص `Object.getOwnPropertyNames` + `Reflect.ownKeys` + prototype
2. `tests/validation-security.test.cjs` — تأكيد رفض التلوث والحقول غير الصالحة
3. `tests/excel-export.test.cjs` — منع انحدار ترجمة الأولوية

## توصية الدمج

- ادمج **`fix/pr41-remaining-on-main`** في `main`.
- أغلق **PR #41** مع تعليق: «المسارات واختبارات CSRF دخلت main؛ المتبقي في PR لاحق».
