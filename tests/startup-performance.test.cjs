'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const {execFileSync}=require('node:child_process');

test('report service startup leaves Excel and PDF engines unloaded until export',()=>{
 const result=execFileSync(process.execPath,['-e',`
  const {createReportsService}=require('./modules/reports/service');
  const service=createReportsService({complaintsService:{readState:()=>({state:{complaints:[],settings:{}}})}});
  service.buildCsv();service.buildSummaryReport();
  console.log(JSON.stringify(Object.keys(require.cache).filter(p=>/[\\\\/]node_modules[\\\\/](exceljs|pdfkit)[\\\\/]/.test(p))));
 `],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
 assert.deepEqual(JSON.parse(result),[]);
});

async function desktopBoot(failSplash=false,pathApi=path){
 const events=[],runtime={backupService:{},startupPhasesMs:{moduleImports:1,database:2,attachmentProtection:3,auditVerification:4,total:10}},app=new EventEmitter();let timingRecord=null;
 Object.assign(app,{isPackaged:true,getAppPath:()=>'/project',getPath:()=>'/profile',whenReady:()=>Promise.resolve(),requestSingleInstanceLock:()=>true,quit:()=>events.push('quit')});
 class Window extends EventEmitter{
  constructor(){super();this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};
  this.webContents.session = { setPermissionCheckHandler() {}, setPermissionRequestHandler() {} };}
  loadFile(file){events.push('splash');assert.ok(file.endsWith('splash.html'));if(failSplash)return Promise.reject(new Error('missing splash'));queueMicrotask(()=>this.emit('ready-to-show'));return Promise.resolve();}
  loadURL(url){events.push('application');assert.equal(url,'http://127.0.0.1:3000');return Promise.resolve();}
  isDestroyed(){return false;}show(){events.push('visible');this.emit('show');}
 }
 class Socket extends EventEmitter{setTimeout(){}connect(_p,_h,callback){queueMicrotask(callback);}end(){}destroy(){}}
 class Tray{setToolTip(){}setContextMenu(){}on(){}}
 const image={isEmpty:()=>false};
 const electron={app,BrowserWindow:Window,Tray,nativeImage:{createEmpty:()=>image,createFromPath:()=>image},Menu:{buildFromTemplate:()=>({})},dialog:{showErrorBox:()=>events.push('error')},shell:{},Notification:{isSupported:()=>false}};
 const context={__dirname:'/project/desktop',console:{info(){}},process:{versions:{},env:{},argv:[],chdir(){}},setTimeout,queueMicrotask,require(name){
  if(name==='electron')return electron;
  if(name==='node:path')return pathApi;
  if(name==='node:net')return {Socket};
  if(name==='node:fs')return {existsSync:()=>true,mkdirSync(){},readFileSync:()=>'',writeFile(file,contents,options,done){
   timingRecord={file,contents,options};done();
  }};
  if(name==='./navigation')return {isLocalAppUrl:()=>true,isPermittedExternalUrl:()=>false};
  if(name==='./recovery')return {readOptions:()=>({})};
  if(name==='./smoke-profile')return {configureSmokeProfile(){}};
  if(name===pathApi.join('/project','server.js')){events.push('server');return runtime;}
  if(name==='./maintenance')return {installMaintenanceMenu(options){assert.equal(options.runtime,runtime);events.push('maintenance');}};
  if(name==='./updater')return {async completeUpdate(){events.push('update-confirmation');}};
  throw new Error('Unexpected import '+name);
 }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../desktop/main.js'),'utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 if(!failSplash){
  assert.ok(timingRecord);assert.ok(timingRecord.file.endsWith('startup-timings.json'));assert.equal(timingRecord.options.mode,0o600);
  const timing=JSON.parse(timingRecord.contents);
  assert.deepEqual(Object.keys(timing),['appReadyMs','windowVisibleMs','serverPhasesMs','serverReadyMs','loginPageLoadedMs']);
  assert.deepEqual(timing.serverPhasesMs,runtime.startupPhasesMs);
  assert.ok(timing.appReadyMs<=timing.windowVisibleMs);assert.ok(timing.windowVisibleMs<=timing.serverReadyMs);assert.ok(timing.serverReadyMs<=timing.loginPageLoadedMs);
 }
 return events;
}
test('desktop paints its local startup window before loading the server and attaches maintenance after readiness',async()=>{
 for(const pathApi of [path.posix,path.win32]){
  const events=await desktopBoot(false,pathApi);
  assert.deepEqual(events,['splash','visible','server','application','maintenance','update-confirmation']);
 }
});
test('missing startup page fails visibly without hanging or launching a hidden server',async()=>{
 assert.deepEqual(await desktopBoot(true),['splash','error','quit']);
});

test('desktop reloads reuse the assembled bundle while development reads fresh sources',()=>{
 const result=execFileSync(process.execPath,['-e',`
  const fs=require('node:fs');
  const {SOURCE_FILES,assembleUiBundle}=require('./lib/ui-bundle');
  const read=fs.readFileSync;let reads=0;
  fs.readFileSync=function(file,...args){const filename=String(file).split(require('node:path').sep).join('/');if(SOURCE_FILES.some(name=>filename.endsWith(name)))reads++;return read.call(this,file,...args);};
  process.env.ELECTRON_RUN='1';
  const first=assembleUiBundle(),initial=reads;
  const second=assembleUiBundle(),reloaded=reads;
  delete process.env.ELECTRON_RUN;
  const third=assembleUiBundle();
  console.log(JSON.stringify({same:first===second&&second===third,initial,reloaded,development:reads-initial,files:SOURCE_FILES.length}));
 `],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
 const check=JSON.parse(result);assert.equal(check.same,true);
 assert.equal(check.initial,check.files);assert.equal(check.reloaded,check.initial);
 assert.equal(check.development,check.files);
});

test('initial HTML discovers the deferred UI bundle without a loader round trip',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 assert.match(html,/<script defer src="\/app\.bundle\.js"><\/script>/);
 assert.doesNotMatch(html,/<script[^>]+src="app\.js"/);
 assert.ok(html.indexOf('src="/app.bundle.js"')<html.indexOf('src="ui-enhancements.js"'));
});

