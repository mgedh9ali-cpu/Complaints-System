# فرع production-bundle

يجمع الميزات الناقصة عن main دون إعادة كتابة modular auth/complaints ودون استبدال session-file-store.

## المحتوى
- `lib/logger.js`
- `lib/file-magic.js`
- `modules/README.md`
- `docs/DEVELOPMENT_ROADMAP.md`
- مثبت Windows: `installer/`, `start-installed-app.bat`, `scripts/open-browser-new-window.ps1`
- `POST /api/backup/verify` (مدير + CSRF) — يفحص ملف SQLite مؤقتًا دون استبدال القاعدة الحية

## غير مشمول (لاحقًا)
- modules/auth و modules/complaints
- جلسات SQLite بدل الملفات
