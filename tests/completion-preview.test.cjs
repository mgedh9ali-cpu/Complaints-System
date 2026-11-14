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
test('completion policy keeps anonymous contact optional and separates recommendations',()=>{
 const ui=fixture();
 assert.equal(ui.isIncomplete({...complete,name:'',phone:''}),false);
 assert.equal(ui.missingFields({...complete,category:' غير مصنفة '})[0].key,'category');
 assert.equal(ui.missingFields({...complete,category:''})[0].level,'action');
 assert.equal(ui.missingFields({...complete,details:'   '})[0].level,'recommended');
 assert.equal(ui.missingFields({...complete,status:'draft'})[0].key,'draft');
 for(const changes of [{status:'closed'},{status:'cancelled'},{archivedAt:'2026-01-02'}])assert.equal(ui.isIncomplete({...complete,...changes,category:''}),false);
});
test('preview counts the same records, limits to five and sorts drafts, actions then recommendations by age',()=>{
 const ui=fixture();
 ui.db.complaints=[complete,...Array.from({length:6},(_,i)=>({...complete,id:'recommend'+i,details:'',created:'2020-01-01'})),
 {...complete,id:'action',category:'',created:'2026-01-02'},
 {...complete,id:'draft-old',status:'draft',created:'2026-01-02'},
 {...complete,id:'draft-new',status:'draft',created:'2026-01-03'}];
 assert.equal(ui.incompleteRecords().length,9);
 assert.deepEqual(Array.from(ui.incompleteRecords().slice(0,3),c=>c.id),['draft-old','draft-new','action']);
 const html=ui.incompleteRecordsPanel();
 assert.match(html,/9 سجلات/);assert.equal((html.match(/<li>/g)||[]).length,5);
 assert.match(html,/data-action="complete-draft"/);assert.match(html,/لاستكمال المتابعة: التصنيف/);
 assert.match(html,/يُستحسن استكمال: التفاصيل المطولة/);
 assert.doesNotMatch(html,/recommend5/);
});
test('preview has a calm empty state, read-only actions, escaped content and recoverable error',()=>{
 const ui=fixture();assert.match(ui.incompleteRecordsPanel(),/كل السجلات المفتوحة/);
 ui.db.complaints=[{...complete,id:'<id>',summary:'<script>bad()</script>',category:''}];ui.uiCan=()=>false;
 const html=ui.incompleteRecordsPanel();assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|data-action="edit-complaint"|data-action="complete-draft"/);
 assert.match(html,/فتح السجل/);
 ui.db.complaints=null;assert.match(ui.incompleteRecordsPanel(),/تعذر تحميل/);assert.match(ui.incompleteRecordsPanel(),/data-action="retry-missing"/);
 ui.db.complaints=[];assert.doesNotMatch(ui.incompleteRecordsPanel(),/تعذر تحميل/);
});
