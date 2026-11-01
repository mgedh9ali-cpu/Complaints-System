# مصادر خط ثمانية (Thmanyah Sans)

الواجهة مربوطة بخط **Thmanyah Sans** عبر:
- `thmanyah-fonts.css`
- `ui-enhancements.css` (`--ui-font`)
- `index.html`
- `server.js` → `ensureThmanyahFonts()` عند الإقلاع + خدمة `/fonts`

## إعادة البناء

```bash
npm run fonts
```

أو تلقائياً عند `postinstall` / تشغيل الخادم.

الملفات المصدرية: أجزاء base64 `*.pN.b64` + ملف `*.parts`.

الناتج في `fonts/`:
- `thmanyahsans-Regular.woff2`
- `thmanyahsans-Medium.woff2`
- `thmanyahsans-Bold.woff2`

> ملاحظة: رفع الأجزاء الثنائية يتم على دفعات بسبب حدود حجم ملفات GitHub API.

## حالة ملفات المصدر الحالية (تدقيق 2026-11-01)

لا يكفي وجود تعريفات CSS لاعتبار الخط مثبتًا. توجد أجزاء غير سليمة:
- Regular: يوجد ملف `.b64` قديم مقطوع؛ ومجموعة الأجزاء المحددة في `.parts` ليست Base64 صالحًا بطول مضاعف لأربعة.
- Medium: مجموعة الأجزاء في `.parts` غير مكتملة.
- Bold: بعض الأجزاء المرجعية في `.parts` غير موجودة.

يقوم `ensure-thmanyah-font.js` الآن باستبعاد الملفات المقطوعة بدل تقديمها للمتصفح.
يستلزم تفعيل الأوزان الثلاثة إيداع ملفات WOFF2 الأصلية الكاملة والمسموح باستخدامها، والتحقق من عرضها داخل تطبيق Windows.
