# تصحيح مسارات GitHub Actions (لا يمكن تطبيقه من داخل التطبيق)

الموصل الذي ينفّذ هذه المهمة يرفض الكتابة داخل `.github/workflows/` — حماية مقصودة تمنع الوكيل من تعديل ملفات تنفيذ
الخطوات الآلية. لذلك رُفعت بقية التغييرات كاملة، وبقي هذا التصحيح ليدخله مالك المستودع بنفسه.

## 1. بوابة التدقيق (سطر واحد لكل ملف)

في `.github/workflows/ci.yml` و`.github/workflows/node-checks.yml` و`.github/workflows/windows-portable.yml`
استبدل السطر:

```yaml
      - name: Audit every dependency finding
        run: npm audit --audit-level=high || true --audit-level=low
```

بـ:

```yaml
      - name: Audit every dependency finding
        run: npm audit --audit-level=low
```

السطر القديم يمرّر `--audit-level=high` أولًا، ثم يعيد كتابة الخيار بـ`--audit-level=low`، فيعطّل الفحص فعليًا.

**حتى قبل تطبيق هذا التصحيح** لا يُسمح بدمج شجرة ناقصة: `npm run check` — وهو أمر تشغّله كل المسارات — صار يشغّل
`scripts/check-dependency-policy.js`، وهي بوابة بلا إنترنت تفشل إذا:
- كان إصدار مُسجَّل في `package-lock.json` لا يطابق الحزمة التي يثبّتها فعليًا؛
- أو كان إصدار مثبَّت داخل نطاق ثغرة معروفة (glob، minimatch، brace-expansion، uuid).

## 2. رفع المثبّت مع النسخة المحمولة

في `.github/workflows/windows-portable.yml`:

**(أ)** غيّر خطوة البناء:

```yaml
      - name: Build portable EXE and installer
        run: npm run dist:win
```

**(ب)** أضف بعد خطوة اختبار الحزمة المحمولة:

```yaml
      - name: Confirm the installer was produced
        shell: pwsh
        run: |
          $installer = (Get-ChildItem dist-desktop/*-setup.exe | Select-Object -First 1).FullName
          if (-not $installer) { throw "Installer executable is missing" }
          Write-Output "Installer: $installer"
```

**(ج)** في خطوة الإسناد (attestation) استعمل قائمة المسارات:

```yaml
        subject-path: |
          dist-desktop/*-portable.exe
          dist-desktop/*-setup.exe
```

**(د)** في خطوة رفع الملفات أضف سطر المثبّت:

```yaml
          path: |
            dist-desktop/*-portable.exe
            dist-desktop/*-setup.exe
            dist-desktop/SHA256SUMS.txt
            dist-desktop/build-manifest.json
```

## سلوك النشر قبل هذا التصحيح وبعده

`scripts/publish-release.js` لا يفترض قائمة ملفات ثابتة: يقرأ `build-manifest.json`، ويتحقق من بصمة كل ملف **قبل**
أول طلب شبكة، ويرفع ما وصل إلى مرحلة النشر. إن لم يصل المثبّت إلى المرحلة (لأن قائمة الرفع لم تُحدَّث بعد) تُنشر
النسخة المحمولة فقط، مع تحذير في سجل التشغيل وذكر الملف الناقص في نص الإصدار — لا نشر صامت لناقص.

بعد تطبيق التصحيح (د) يصل المثبّت تلقائيًا إلى الإصدار دون أي تعديل إضافي في الشيفرة.

## التحقق بعد التطبيق

```bash
npm run check          # فحص المصادر + بوابة التبعيات
npm run check:security # بوابة التبعيات وحدها
npm run check:registry # فحص السجل الحي (يحتاج إنترنت)
npm test
```
