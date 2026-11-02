'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
test('Windows portable package excludes local secrets, citizen data and temporary backups',()=>{
 const pkg=require('../package.json');
 const patterns=pkg.build?.files||[];
 const required=['!.env','!.env.*','!data/**/*','!attachments/**/*','!sessions/**/*',
 '!backups/**/*','!*.sqlite','!*.sqlite-*','!*.sqlite3','!*.db','!*.csb','!*.enc',
 '!audit-head.hash','!dist-desktop/**/*','!.git/**/*'];
 for(const pattern of required)assert.ok(patterns.includes(pattern),'missing '+pattern);
 const files=fs.readFileSync(path.join(root,'desktop','main.js'),'utf8');
 assert.match(files,/app\.getPath\('userData'\)/,'runtime files must reside outside the app package');
 assert.match(files,/process\.env\.DATABASE_PATH = paths\.databasePath/);
});
test('release package keeps the modular UI and configuration initializer',()=>{
 const pkg=require('../package.json');
 assert.ok(!pkg.build.files.includes('**/*'),'packaging must use an explicit source allowlist');
 for(const include of ['ui/**/*.js','scripts/**/*.js','modules/**/*.js','assets/NotoSansArabic.ttf'])assert.ok(pkg.build.files.includes(include),include);
 assert.ok(!pkg.build.files.some(x=>/^!ui\//.test(x)));
 assert.ok(!pkg.build.files.some(x=>/^!scripts\//.test(x)));
 const init=require('node:fs').readFileSync(path.join(root,'desktop','main.js'),'utf8');
 assert.match(init,/initialize-local-config\.js/);
});
