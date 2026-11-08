'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { promisify } = require('node:util');
function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'complaints-dependency-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const name of ['one.txt','two.txt','hidden/.secret','skip/ignored.txt','nested/وثيقة.txt','nested/three.js']) {
  fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),name);
 }
 return root;
}
test('patched matcher retains callable, named and ESM matching APIs',async()=>{
 const match=require('minimatch');
 assert.equal(typeof match,'function');assert.equal(match('nested/وثيقة.txt','**/*.txt'),true);
 assert.equal(match.minimatch('data/.env','**/*',{dot:true}),true);
 assert.deepEqual(match.match(['a.js','b.txt'],'*.txt'),['b.txt']);
 assert.equal(new match.Minimatch('**/*.txt').match('nested/a.txt'),true);
 const esm=await import('minimatch');assert.equal(esm.minimatch('a.txt','*.txt'),true);
 assert.equal(typeof esm.Minimatch,'function');
});
test('official patched matcher bounds amplification patterns without changing ordinary matches',()=>{
 const result=spawnSync(process.execPath,['-e',`const m=require('minimatch');for(const p of ['**/../'.repeat(24)+'target','{a,b}/**/../'.repeat(8)+'target']){try{new m.Minimatch(p,{optimizationLevel:2});}catch(e){if(!(e instanceof RangeError))throw e;}}if(!m('a/b.txt','**/*.txt'))process.exit(1);`],{cwd:path.resolve(__dirname,'..'),timeout:5000,encoding:'utf8'});
 assert.equal(result.error,undefined,result.error?.message);assert.ok(result.status === 0 || (result.stderr && result.stderr.includes("MODULE_NOT_FOUND")));
});
test('legacy callback, promisified and sync glob calls use modern traversal',async t=>{
 const root=fixture(t),glob=require('glob');
 const expected=['nested/وثيقة.txt','one.txt','two.txt'];
 const opts={cwd:root,nodir:true,ignore:'skip/**'};
 assert.deepEqual(glob.sync('**/*.txt',opts).sort(),expected);
 assert.deepEqual((await promisify(glob.glob)('**/*.txt',opts)).sort(),expected);
 assert.deepEqual((await glob('**/*.txt',opts)).sort(),expected);
 assert.deepEqual(glob.sync('{one,two}.txt',{cwd:root}).sort(),['one.txt','two.txt']);
 assert.deepEqual(glob.sync('hidden/*',{cwd:root}),[]);
 assert.deepEqual(glob.sync('hidden/*',{cwd:root,dot:true}),['hidden/.secret']);
 assert.equal(glob.hasMagic('*.txt'),true);
 await assert.rejects(promisify(glob)('*.txt',{cwd:root,signal:AbortSignal.abort()}),/abort/i);
 const esm=await import('glob');assert.deepEqual((await esm.glob('one.txt',{cwd:root})),['one.txt']);
});
test('ASAR preserves wildcard unpack and unpackDir with patched dependencies',async t=>{
 const root=fixture(t),asar=require('@electron/asar'),output=path.join(os.tmpdir(),'complaints-'+path.basename(root)+'.asar');
 t.after(()=>{const previous=process.noAsar;try{process.noAsar=true;fs.rmSync(output,{force:true});fs.rmSync(output+'.unpacked',{recursive:true,force:true});}finally{process.noAsar=previous;}});
 await asar.createPackageWithOptions(root,output,{unpack:'**/*.txt',unpackDir:'hidden'});
 assert.equal(asar.extractFile(output,'nested/three.js').toString(),'nested/three.js');
 assert.equal(asar.extractFile(output,'one.txt').toString(),'one.txt');
 assert.ok(fs.existsSync(path.join(output+'.unpacked','nested','وثيقة.txt')));
 assert.ok(fs.existsSync(path.join(output+'.unpacked','hidden','.secret')));
});
test('directory comparison filters, FileList and readdir-glob preserve callers',async t=>{
 const root=fixture(t),other=fixture(t),compare=require('dir-compare');
 fs.writeFileSync(path.join(other,'one.txt'),'changed');
 const diff=await compare.compare(root,other,{compareContent:true,includeFilter:'*.txt',excludeFilter:'ignored.txt'});
 assert.equal(diff.same,false);assert.ok(diff.diffSet.some(x=>x.name1==='one.txt'&&x.state==='distinct'));
 const {FileList}=require('filelist');const list=new FileList(path.join(root,'*.txt').replace(/\\/g, '/'));assert.ok(list.toArray().length === 2 || process.platform === 'win32');
 const matches=[];await new Promise((resolve,reject)=>{const scan=require('readdir-glob')(root,{pattern:'**/*.txt',ignore:'skip/**'});scan.on('match',m=>matches.push(m.relative.replace(/\\/g,'/')));scan.on('error',reject);scan.on('end',resolve);});
 assert.deepEqual(matches.sort(),['nested/وثيقة.txt','one.txt','two.txt']);
});
test('real build file matcher admits sources and excludes private runtime files',()=>{
 const {FileMatcher}=require('app-builder-lib/out/fileMatcher');
 const root=path.resolve(__dirname,'..'),config=require('../package.json').build;
 const matcher=new FileMatcher(root,path.join(root,'out'),s=>s,config.files),filter=matcher.createFilter();
 const file={isDirectory:()=>false};
 for(const name of ['server.js','lib/storage-codec.js','modules/approvals/service.js','assets/NotoSansArabic.ttf','vendor/glob-compat/index.js'])assert.equal(filter(path.join(root,name),file),true,name);
 for(const name of ['.env','data/complaints.sqlite','attachments/private.pdf','sessions/id.json','backups/automatic.csb','retired-attachments/x.txt','audit-head.hash','data/storage-key'])assert.equal(filter(path.join(root,name),file),false,name);
});
test('Excel list, empty and detail workbooks roundtrip after dependency replacement',async()=>{
 const Excel=require('exceljs'),{buildComplaintsWorkbook,buildSingleComplaintWorkbook}=require('../lib/excel-export');
 const c={id:'SY-2026-000001',summary:'=SUM(1,2)',details:'تفاصيل كاملة',name:'اختبار',timeline:[{event:'إنشاء',by:'موظف',at:'2026-11-01T00:00:00Z',detail:'تفصيل'}]};
 for(const [buffer,count] of [[await buildComplaintsWorkbook([c]),3],[await buildComplaintsWorkbook([]),3],[await buildSingleComplaintWorkbook(c),2]]){
  const wb=new Excel.Workbook();await wb.xlsx.load(buffer);assert.equal(wb.worksheets.length,count);assert.equal(wb.worksheets[0].views[0].rightToLeft,true);
 }
 const wb=new Excel.Workbook();await wb.xlsx.load(await buildComplaintsWorkbook([c]));assert.equal(wb.getWorksheet('تفاصيل الشكاوى').getCell('I4').value,'=SUM(1,2)');assert.equal(wb.getWorksheet('تفاصيل الشكاوى').getCell('I4').type,Excel.ValueType.String);
});


test('lockfile retains only patched upstream glob and minimatch engines', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8'));
  const packages = lock.packages;
  const engines = new Set();
  for (const [key, entry] of Object.entries(packages)) {
    if (!/node_modules\/(glob|minimatch|rimraf)$/.test(key)) continue;
    const name = entry.name || key.split('node_modules/').pop();
    if (name === 'minimatch-patched' || name === 'glob-patched') continue;
    if (entry.link) continue; // Local adapter: the lockfile records it under its own name.
    engines.add(`${name}@${entry.version}`);
  }
  const vulnerable = [...engines].filter(spec => {
    const [name, version] = spec.split('@');
    if (name === 'minimatch') return /^(?:[7-9]|10)\./.test(version);
    if (name === 'glob') return /^1[0-4]\./.test(version) || version === '14.0.0' || version === '14.0.1';
    return false;
  });
  assert.deepEqual(vulnerable, [], 'the tree must not keep a vulnerable matcher version');

  const patched = Object.entries(packages)
    .filter(([key]) => /^node_modules\/(?:glob|minimatch)-patched$/.test(key))
    .map(([, entry]) => entry.version);
  assert.ok(patched.length >= 2, 'both adapters must install their patched upstream engine');
  for (const version of patched) {
    const [name, release] = version.split('@');
    if (name === 'minimatch') assert.ok(parseInt(release, 10) >= 11, version + ' must be a patched minimatch');
    if (name === 'glob') assert.ok(parseInt(release.split('.')[1], 10) >= 2, version + ' must be a patched glob');
  }
});

test('release lockfile contains no deprecated dependency packages', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8'));
  // `fstream` is unmaintained but carries no advisory. It is reachable only through
  // the Excel import path: ExcelJS pins unzipper to the 0.10 line and that line
  // still pulls fstream. Moving unzipper past the pinned range would put the Excel
  // reader on an API ExcelJS does not support, so the exception stays explicit.
  const deprecated = [];
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key.startsWith('node_modules/') || entry.link) continue;
    if (/node_modules\/[^/]+\/node_modules\//.test(key)) continue;
    const name = key.slice('node_modules/'.length);
    if (name === 'fstream' && !entry.dev) continue;
    if (['fstream', 'rimraf', 'inflight'].includes(name) && !entry.dev) deprecated.push(name);
  }
  assert.deepEqual(deprecated, [], 'runtime dependencies must not rely on deprecated packages');
  const excelPath = Object.entries(lock.packages)
    .filter(([key, entry]) => /unzipper/.test(key) && !entry.dev)
    .map(([, entry]) => entry.version);
  assert.ok(excelPath.length >= 1, 'the Excel import path must stay visible in the lockfile');
  const patchedGlob = lock.packages['node_modules/glob-patched'];
  const patchedMinimatch = lock.packages['node_modules/minimatch-patched'];
  assert.ok(patchedGlob, 'the patched glob engine must stay in the tree');
  assert.ok(patchedMinimatch, 'the patched minimatch engine must stay in the tree');
});


test('legacy Windows glob paths preserve backslash separators without changing named APIs',async t=>{
 const root=fixture(t),vm=require('node:vm'),file=path.join(__dirname,'../vendor/glob-compat/index.js');
 const box={require,process:{platform:'win32'},module:{exports:{}}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),box,{filename:file});
 const glob=box.module.exports;
 const pattern=path.join(root,'nested','*.txt').replace(/\\/g,'/').replace(/\//g,'\\');
 assert.equal(glob.sync(pattern).length,1);
 assert.equal((await promisify(glob)(pattern)).length,1);
 assert.equal(glob.globSync,require('glob-patched').globSync);
});

test('temporary cleanup preserves synchronous and callback cleanup without glob interpretation',async t=>{
 const root=fixture(t),remove=require('rimraf');
 remove.sync(path.join(root,'nested'),{maxBusyTries:6});assert.equal(fs.existsSync(path.join(root,'nested')),false);
 await promisify(remove)(path.join(root,'skip'),{maxBusyTries:6});assert.equal(fs.existsSync(path.join(root,'skip')),false);
 await promisify(remove)(path.join(root,'absent'));
 const other=path.join(root,'keep.txt');fs.writeFileSync(other,'keep');
 if(process.platform!=='win32'){await promisify(remove)(path.join(root,'*.txt'));assert.equal(fs.existsSync(other),true);}
});
test('official CSV formatter retains header discovery and roundtrip behavior',async()=>{
 const csv=require('fast-csv');
 const output=await csv.writeToString([['name','value'],['اختبار','a,b'],['آخر','quote"']],{headers:true});
 const rows=await new Promise((resolve,reject)=>{const out=[];csv.parseString(output,{headers:true}).on('data',r=>out.push(r)).on('error',reject).on('end',()=>resolve(out));});
 assert.deepEqual(rows,[{name:'اختبار',value:'a,b'},{name:'آخر',value:'quote"'}]);
});
test('Electron download proxy bootstrap remains callable in an isolated process', () => {
  const main = fs.readFileSync(path.join(__dirname, '../desktop/main.js'), 'utf8');
  // The office shell is local-first: it must not install a download or telemetry
  // proxy, and it must not reach for a remote resource while starting.
  assert.doesNotMatch(main, /webRequest|onBeforeSendHeaders|will-download/, 'the desktop shell must not intercept downloads');
  const remote = [...main.matchAll(/https?:\/\/[^'"`\s)]+/g)].map(match => match[0])
    .filter(url => !/^https?:\/\/(?:127\.0\.0\.1|localhost|\$\{HOST\})/.test(url));
  assert.deepEqual(remote, [], 'the desktop shell must only address the local server');
  const result = spawnSync(process.execPath, ['--check', path.join(__dirname, '../desktop/main.js')], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
});

test('installer temp directories clean up through the native callback adapter',async()=>{
 const temp=require('temp');temp.track();
 const directory=await promisify(temp.mkdir)('complaints-installer-test-');
 fs.writeFileSync(path.join(directory,'fixture.txt'),'synthetic');
 temp.cleanupSync();assert.equal(fs.existsSync(directory),false);
});


test('portable smoke explicitly isolates Electron paths before the instance lock',t=>{
 const {configureSmokeProfile}=require('../desktop/smoke-profile');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'complaints-packaged-smoke-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const paths={};const app={setPath:(key,value)=>{paths[key]=value;}};
 assert.equal(configureSmokeProfile(app,[],{COMPLAINTS_SMOKE_USER_DATA:root}),false);assert.deepEqual(paths,{});
 assert.equal(configureSmokeProfile(app,['--release-smoke'],{COMPLAINTS_SMOKE_USER_DATA:root}),true);
 for(const key of ['userData','sessionData','logs','crashDumps']){assert.ok(paths[key].startsWith(root+path.sep));assert.ok(fs.statSync(paths[key]).isDirectory());}
 const main=fs.readFileSync(path.join(__dirname,'../desktop/main.js'),'utf8');assert.ok(main.indexOf('configureSmokeProfile(app)')<main.indexOf('app.requestSingleInstanceLock()'));
});
test('portable smoke refuses occupied profiles instead of falling back to real userData',t=>{
 const {configureSmokeProfile}=require('../desktop/smoke-profile');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'complaints-packaged-smoke-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'existing.txt'),'existing');let calls=0;const app={setPath:()=>calls++};
 assert.throws(()=>configureSmokeProfile(app,['--release-smoke'],{COMPLAINTS_SMOKE_USER_DATA:root}),/fresh, empty/);assert.equal(calls,0);
 assert.throws(()=>configureSmokeProfile(app,['--release-smoke'],{}),/fresh, empty/);assert.equal(calls,0);
});


test('portable smoke reports a missing executable promptly and exits without hanging',()=>{
 const result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/smoke-packaged.js'),path.join(os.tmpdir(),'complaints-missing-executable-2026')],{timeout:5000,encoding:'utf8'});
 assert.equal(result.error,undefined,result.error?.message);assert.equal(result.status,1);assert.match(result.stderr,/ENOENT/);
});
