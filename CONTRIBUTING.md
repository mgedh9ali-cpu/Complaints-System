# المساهمة في Complaints-System

شكراً لاهتمامك. هذا نظام **محلي** (loopback فقط) لإدارة الشكاوى بالعربية.

## المتطلبات

- Node.js **≥ 20.6**
- Git

## الإعداد المحلي

```bash
git clone https://github.com/mgedh9ali-cpu/Complaints-System.git
cd Complaints-System
npm install
cp .env.example .env   # أو اترك أول تشغيل ينشئ .env
npm test
npm start
```

افتح http://127.0.0.1:3000 وسجّل الدخول بحساب المدير من `.env`.

سطح المكتب (اختياري):

```bash
npm run start:desktop
```

## هيكل مهم

| مسار | دور |
|------|-----|
| `server.js` | Express + SQLite |
| `modules/` | وحدات API |
| `lib/` | أدوات مشتركة |
| `app.full.js` | واجهة المستخدم (مصدر مقروء) |
| `tests/` | اختبارات `node --test` |
| `desktop/` | غلاف Electron |

**لا** ترفع ملفات `.env` أو `data/` أو قواعد SQLite.

## الاختبار قبل الدفع

```bash
npm run check
npm test
```

## أسلوب التغييرات

1. فرع قصير الهدف أو دفع مباشر على `main` حسب سياسة المالك
2. رسائل commit واضحة (مثل `fix(ui): ...` / `feat(sync): ...`)
3. لا تُجزّئ الواجهة إلى Base64/Gzip — عدّل `app.full.js` أو أجزاء `app-p*.js` المقروءة فقط
4. أي مسار API جديد: صلاحية في مصفوفة الأدوار + اختبار إن أمكن

## الأمان

انظر [SECURITY.md](SECURITY.md). لا تفتح Issue عاماً بتفاصيل استغلال.
