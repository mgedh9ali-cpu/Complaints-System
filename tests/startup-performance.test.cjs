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

async function desktopBoot(failSplash=false){
 const events=[],runtime={backupService:{}},app=new EventEmitter();
 Object.assign(app,{isPackaged:true,getAppPath:()=>'/project',getPath:()=>'/profile',whenReady:()=>Promise.resolve(),requestSingleInstanceLock:()=>true,quit:()=>events.push('quit')});
 class Window extends EventEmitter{
  constructor(){super();this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};}
  loadFile(file){events.push('splash');assert.ok(file.endsWith('startup.html'));if(failSplash)return Promise.reject(new Error('missing splash'));queueMicrotask(()=>this.emit('ready-to-show'));return Promise.resolve();}
  loadURL(url){events.push('application');assert.equal(url,'http://127.0.0.1:3000');return Promise.resolve();}
  isDestroyed(){return false;}show(){events.push('visible');this.emit('show');}
 }
 class Socket extends EventEmitter{setTimeout(){}connect(_p,_h,callback){queueMicrotask(callback);}end(){}destroy(){}}
 class Tray{setToolTip(){}setContextMenu(){}on(){}}
 const image={isEmpty:()=>false};
 const electron={app,BrowserWindow:Window,Tray,nativeImage:{createEmpty:()=>image,createFromPath:()=>image},Menu:{buildFromTemplate:()=>({})},dialog:{showErrorBox:()=>events.push('error')},shell:{},Notification:{isSupported:()=>false}};
 const context={__dirname:'/project/desktop',console:{info(){}},process:{versions:{},env:{},argv:[],chdir(){}},setTimeout,queueMicrotask,require(name){
  if(name==='electron')return electron;
  if(name==='node:path')return path;
  if(name==='node:net')return {Socket};
  if(name==='node:fs')return {existsSync:()=>true,mkdirSync(){},readFileSync:()=>''};
  if(name==='./navigation')return {isLocalAppUrl:()=>true,isPermittedExternalUrl:()=>false};
  if(name==='./recovery')return {readOptions:()=>({})};
  if(name==='./smoke-profile')return {configureSmokeProfile(){}};
  if(name==='/project/server.js'){events.push('server');return runtime;}
  if(name==='./maintenance')return {installMaintenanceMenu(options){assert.equal(options.runtime,runtime);events.push('maintenance');}};
  throw new Error('Unexpected import '+name);
 }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../desktop/main.js'),'utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));return events;
}
test('desktop paints its local startup window before loading the server and attaches maintenance after readiness',async()=>{
 const events=await desktopBoot();
 assert.deepEqual(events,['splash','visible','server','application','maintenance']);
});
test('missing startup page fails visibly without hanging or launching a hidden server',async()=>{
 assert.deepEqual(await desktopBoot(true),['splash','error','quit']);
});
