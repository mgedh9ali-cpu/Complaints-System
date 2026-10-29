# استعادة app.js (مهم جداً)

تم استبدال `app.js` بالخطأ أثناء التحديث. لاستعادته نفّذ محلياً:

```bash
git fetch origin
git checkout d29072a4fca116590aaee4377a5cf18ca64cc2ea -- app.js
git add app.js
git commit -m "fix: restore full app.js from previous good commit"
git push
```

أو من واجهة GitHub:

1. افتح: https://github.com/mgedh9ali-cpu/Complaints-System/blob/d29072a4fca116590aaee4377a5cf18ca64cc2ea/app.js
2. انسخ المحتوى بالكامل
3. الصقه فوق `app.js` الحالي واحفظ

بعد الاستعادة، تأكد أن `index.html` يحمّل:

- `app.js`
- `ui-enhancements.js`
- `attachments-ui-bridge.js`

ثم:

```bash
npm install
npm start
```
