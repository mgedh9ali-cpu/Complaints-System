'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function fixture(){
 const ctx=vm.createContext({Date,Intl,db:{complaints:[]},uiCan:()=>true});
 for(const file of ['ui/core/format.js','ui/pages/dashboard.js'])vm.runInContext(fs.readFileSync(file,'utf8'),ctx);
 return ctx;
}
const complete={id:'complete',status:'new',entity:'جهة',province:'دمشق',category:'خدمات',details:'تفاصيل',created:'2026-01-01',summary:'ملخص'};
test('only reference and subject are required',()=>{
 const ui=fixture();
 assert.equal(ui.isIncomplete({...complete,name:'',phone:'',category:'',province:'',entity:'',details:''}),false);
 assert.equal(ui.isIncomplete({...complete,status:'draft'}),false);
 assert.equal(ui.missingFields({...complete,id:''})[0].key,'id');
 assert.equal(ui.missingFields({...complete,summary:'  '})[0].key,'summary');
 assert.equal(ui.missingFields({...complete,summary:'مسودة بانتظار الاستكمال'})[0].key,'summary');
 for(const changes of [{status:'closed'},{status:'cancelled'},{archivedAt:'2026-01-02'}])assert.equal(ui.isIncomplete({...complete,...changes,summary:''}),false);
});
test('preview counts only missing required fields and limits to five',()=>{
 const ui=fixture();
 ui.db.complaints=[complete,...Array.from({length:6},(_,i)=>({...complete,id:'missing'+i,summary:'',created:'2020-01-01'})),{...complete,id:'draft-old',status:'draft',summary:'مسودة بانتظار الاستكمال',created:'2026-01-02'}];
 assert.equal(ui.incompleteRecords().length,7);
 assert.equal(ui.incompleteRecords()[0].id,'draft-old');
 const html=ui.incompleteRecordsPanel();
 assert.match(html,/7 سجلات/);assert.equal((html.match(/<li>/g)||[]).length,5);
 assert.match(html,/data-action="complete-draft"/);assert.match(html,/لاستكمال المتابعة: الموضوع/);
 assert.doesNotMatch(html,/يُستحسن استكمال/);
});
test('preview has a calm empty state, read-only actions, escaped content and recoverable error',()=>{
 const ui=fixture();assert.match(ui.incompleteRecordsPanel(),/كل السجلات المفتوحة/);
 ui.db.complaints=[{...complete,id:'',summary:'<script>bad()</script>',category:''}];ui.uiCan=()=>false;
 const html=ui.incompleteRecordsPanel();assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|data-action="edit-complaint"|data-action="complete-draft"/);
 assert.match(html,/فتح السجل/);
 ui.db.complaints=null;assert.match(ui.incompleteRecordsPanel(),/تعذر تحميل/);assert.match(ui.incompleteRecordsPanel(),/data-action="retry-missing"/);
 ui.db.complaints=[];assert.doesNotMatch(ui.incompleteRecordsPanel(),/تعذر تحميل/);
});
