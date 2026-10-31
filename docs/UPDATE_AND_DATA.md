# ملف EXE واحد بدون تثبيت Node.js

## الهدف

- تنزيل **ملف واحد** من المتصفح
- ضغط مزدوج → يعمل فوراً
- **لا يحتاج** تثبيت Node.js على جهاز المستخدم
- التحديث = استبدال الـ exe فقط، **البيانات تبقى**

## كيف يعمل؟

التطبيق مبني بـ **Electron**. Electron يحمل محرك Node داخله.
الخادم (Express + SQLite) يعمل **داخل** نفس العملية — لا يُستدعى `node` من النظام.

```text
complaints-system-0.7.6-portable.exe
        │
        ├─ واجهة النافذة (Chromium)
        └─ خادم الشكاوى (Node المدمج في Electron)
                 └─ البيانات → مجلد AppData (خارج الـ exe)
```

## بناء الملف (مرة على جهاز المطوّر)

يحتاج المطوّر Node فقط أثناء البناء:

```bash
git pull
npm install
npm run dist:win
```

المخرج:

```text
dist-desktop/complaints-system-0.7.6-portable.exe
```

ارفع هذا الملف في **GitHub → Releases**.

> يُفضّل البناء على Windows x64. `better-sqlite3` يُعاد بناؤه تلقائياً ليتوافق مع Electron.

## المستخدم النهائي

1. ينزّل الـ `.exe` من صفحة الإصدارات
2. يشغّله
3. لا يثبّت Node ولا يفك مجلدات

## أين البيانات؟

```text
%APPDATA%\complaints-local-system\
  ├── .env
  └── data\
        ├── complaints.sqlite   ← الشكاوى
        ├── sessions\
        └── instance-id
```

| العملية | البيانات |
|---------|----------|
| استبدال الـ exe بنسخة أحدث | **تبقى** |
| حذف مجلد AppData | تُمسح (متعمد) |
| نسخ احتياطي من داخل النظام | يحفظ قاعدة البيانات |

## التحديث

```text
المطوّر: تعديل المستودع → npm run dist:win → رفع Release
المستخدم: تنزيل exe جديد → تشغيله (أو استبدال القديم)
النتيجة: نفس الشكاوى والمستخدمين
```

## للمطوّرين فقط (ليس للمستخدم)

```bash
npm start                 # متصفح على :3000 (يحتاج Node)
npm run start:desktop     # نافذة Electron للتطوير
```
