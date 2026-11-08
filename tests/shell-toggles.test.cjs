'use strict';
/* Shell toggles mount into the top bar after the shell appears.
 * The theme and glass features watch the document because the top bar is
 * rendered after the first paint. This fixture models a real DOM: unknown
 * selectors resolve to null, created elements enter the document on insert,
 * and `window` is the global object exactly like in a browser. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

function fixture({user=null}={}){
 const observers=[],handlers=new Map(),elements=new Map(),toasts=[],storage=new Map();
 const classes=()=>{
  const names=new Set();
  return {add:n=>names.add(n),remove:n=>names.delete(n),contains:n=>names.has(n),
   toggle:(n,force)=>{const on=force===undefined?!names.has(n):!!force;if(on)names.add(n);else names.delete(n);return on;},
   value:names};
 };
 const documentElement={dataset:{},style:{},classList:classes(),setAttribute(){},removeAttribute(){}};
 function create(tag){
  const element={tag,id:'',className:'',dataset:{},style:{},hidden:false,innerHTML:'',textContent:'',title:'',
   attributes:{},children:[],classList:classes(),
   setAttribute(key,value){this.attributes[key]=String(value);},
   getAttribute(key){return key in this.attributes?this.attributes[key]:null;},
   removeAttribute(key){delete this.attributes[key];},
   insertBefore(child){this.children.unshift(child);if(child.id)elements.set('#'+child.id,child);return child;},
   appendChild(child){this.children.push(child);if(child.id)elements.set('#'+child.id,child);return child;},
   remove(){for(const [key,value] of elements)if(value===this)elements.delete(key);},
   querySelector(){return null;},querySelectorAll(){return[];},
   focus(){}};
  return element;
 }
 const topActions=create('div');
 topActions.className='top-actions';
 elements.set('.top-actions',topActions);
 const document={
  documentElement,
  body:{dataset:{},prepend(){},append(){},appendChild(){}},
  createElement:tag=>create(tag),
  querySelector(selector){return elements.get(selector)||null;},
  querySelectorAll(){return [];},
  getElementById(id){return elements.get('#'+id)||null;},
  addEventListener(type,fn){handlers.set(type,fn);}
 };
 class RecordingObserver{
  constructor(callback){this.callback=callback;this.targets=[];observers.push(this);}
  observe(target,options){this.targets.push({target,options});}
  disconnect(){this.targets.length=0;}
  takeRecords(){return[];}
 }
 const context={
  document,
  MutationObserver:RecordingObserver,
  authenticatedUser:user,
  $:(selector,scope=document)=>scope.querySelector(selector),
  localStorage:{getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},
  setTimeout:()=>0,clearTimeout(){},console:{log(){},warn(){},error(){}},
  toast:(message)=>toasts.push(message)
 };
 context.window=context;
 return {context,observers,handlers,elements,toasts,storage,documentElement,topActions,
  run(source){vm.runInNewContext(source,context,{filename:'shell-toggles.js'});return context;},
  mount(){for(const observer of observers)observer.callback([{type:'childList',target:documentElement}]);}};
}

test('the theme toggle mounts once the top bar exists and stays a single control',()=>{
 const f=fixture({user:{id:'u1',username:'manager',role:'admin'}});
 f.run(read('ui/features/theme-icon.js'));
 assert.ok(f.observers.length>=1,'the theme feature must watch for the late top bar');
 f.mount();
 const button=f.elements.get('#themeIconToggle');
 assert.ok(button,'the theme toggle must mount into the top bar');
 assert.equal(button.dataset.action,'toggle-theme');
 assert.equal(button.getAttribute('aria-pressed'),'false');
 assert.equal(button.getAttribute('aria-label'),'التبديل إلى الوضع الداكن');
 assert.equal(f.topActions.children[0],button,'the toggle must be inserted into the top bar');
 f.mount();
 assert.equal(f.topActions.children.length,1,'a second mutation must not duplicate the toggle');
});

test('the theme toggle reflects the selected theme and announces the change',()=>{
 const f=fixture({user:{id:'u1',username:'manager',role:'admin'}});
 f.run(read('ui/features/theme-icon.js'));
 f.mount();
 f.context.applyUiTheme('dark',true);
 assert.equal(f.documentElement.dataset.theme,'dark');
 const button=f.elements.get('#themeIconToggle');
 assert.equal(button.getAttribute('aria-pressed'),'true');
 assert.equal(button.getAttribute('aria-label'),'التبديل إلى الوضع الفاتح');
 assert.ok(f.toasts.some(message=>message.includes('الوضع الداكن')));
 f.context.applyUiTheme('light');
 assert.equal(f.documentElement.dataset.theme,'light');
 assert.equal(f.elements.get('#themeIconToggle').getAttribute('aria-pressed'),'false');
});

test('the glass toggle mounts with the top bar and switches the surface to solid',()=>{
 const f=fixture({user:{id:'u1',username:'manager',role:'admin'}});
 f.run(read('ui/features/liquid-glass-toggle.js'));
 assert.ok(f.observers.length>=1,'the glass feature must watch for the late top bar');
 f.mount();
 const button=f.elements.get('#liquidGlassToggle');
 assert.ok(button,'the glass toggle must mount into the top bar');
 assert.equal(button.dataset.action,'toggle-liquid-glass');
 assert.equal(button.getAttribute('aria-pressed'),'true');
 assert.equal(f.documentElement.classList.contains('glass-off'),false);
 f.context.toggleLiquidGlass();
 assert.equal(f.documentElement.classList.contains('glass-off'),true,'solid mode must disable the glass surface');
 assert.equal(f.documentElement.classList.contains('reduce-transparency'),true);
 assert.equal(f.storage.get('complaints-glass-enabled'),'false');
 assert.ok(f.toasts.some(message=>message.includes('صلب')));
 f.context.toggleLiquidGlass();
 assert.equal(f.documentElement.classList.contains('glass-off'),false,'glass mode must be restorable');
 assert.equal(f.storage.get('complaints-glass-enabled'),'true');
});

test('the shell toggles are announced to assistive technology and are keyboard operable',()=>{
 const f=fixture({user:{id:'u1',username:'manager',role:'admin'}});
 f.run(read('ui/features/theme-icon.js'));
 f.run(read('ui/features/liquid-glass-toggle.js'));
 f.mount();
 for(const id of ['#themeIconToggle','#liquidGlassToggle']){
  const button=f.elements.get(id);
  assert.equal(button.tag,'button','the shell toggles must be real buttons');
  assert.ok(button.getAttribute('aria-label'),id+' must expose an accessible name');
  assert.ok(button.getAttribute('aria-pressed'),id+' must expose its pressed state');
 }
 assert.ok(f.elements.get('#liquidGlassToggle').innerHTML.includes('lgt-track'),'the glass toggle must render its own track');
});
