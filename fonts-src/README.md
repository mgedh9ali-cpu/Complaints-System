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
