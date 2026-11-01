# شعبة الاستفسارات والشكاوى

نظام عربي **محلي** لإدارة الشكاوى — SQLite + واجهة ويب + **ملف سطح مكتب واحد**.

**الإصدار: 0.7.8**

> تحذير: لا تُدخل بيانات مواطنين حقيقية قبل مراجعة أمنية. انظر [SECURITY.md](SECURITY.md).

## للمستخدم: ملف EXE واحد (بدون Node.js)

بعد بناء النسخة المحمولة ورفعها في Releases:

1. نزّل `complaints-system-*-portable.exe`
2. اضغط مرتين → يعمل
3. **لا يحتاج** تثبيت Node.js على الجهاز

البيانات تُحفظ في `%APPDATA%` — استبدال الـ exe لا يمسح الشكاوى.

التفاصيل: [docs/UPDATE_AND_DATA.md](docs/UPDATE_AND_DATA.md)

### بناء الملف (جهاز المطوّر — Windows)

```bash
git pull
npm install
npm run dist:win
```

المخرج: `dist-desktop/complaints-system-0.7.8-portable.exe`

## للمطوّر: تشغيل من المصدر

```bash
npm install
cp .env.example .env
npm start
```

→ http://127.0.0.1:3000

أو نافذة سطح مكتب للتطوير: `npm run start:desktop`

## الميزات

| الميزة | الحالة |
|--------|--------|
| EXE محمول بدون Node على جهاز المستخدم | ✅ |
| بيانات منفصلة عن ملف البرنامج | ✅ |
| مسودة / تعديل / حذف شكوى | ✅ |
| صلاحيات + CSRF | ✅ |
| مرفقات + تقارير CSV/Excel/PDF | ✅ |
| مزامنة يدوية + تدقيق متسلسل | ✅ |

## البنية

انظر [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## الأمان

[SECURITY.md](SECURITY.md) — الاستماع على `127.0.0.1` فقط.
