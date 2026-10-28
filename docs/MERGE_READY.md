# جاهز للدمج — فرع واحد

**الفرع:** `fix/pr41-remaining-on-main`  
**PR:** #49  
**الأساس:** `main` الحالي (`61a3ac78`)

## ماذا يُدمج؟

- `lib/validation.js` — حماية أقوى من prototype pollution
- `tests/validation-security.test.cjs`
- `tests/excel-export.test.cjs`
- `docs/PR41_STATUS.md`

## ماذا لا يُدمج الآن؟

| PR | السبب |
|----|--------|
| #41 | معظم الإصلاحات في main؛ المتبقي هنا |
| #45 / #46 / #48 | مبنية على main قديم / تتعارض (modular refactor لاحقًا) |
| #33 / #47 | مسودة / تعارض جلسات |
| #36 | مثبّت ويندوز — ميزة منفصلة |

## أمر الدمج

1. انتظر CI أخضر على #49
2. Merge #49 إلى main
3. أغلق #41 مع إشارة إلى #49
4. أغلق #45 #46 #48 كعمل لاحق بعد استقرار main
