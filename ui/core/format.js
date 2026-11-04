function workDayKey(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Damascus',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&'+'amp;','<':'&'+'lt;','>':'&'+'gt;','"':'&'+'quot;',"'":'&#39;'}[c]));}
function norm(s=''){return String(s).normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/[ىئي]/g,'ي').replace(/ة/g,'ه').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ء/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
function phoneNorm(s=''){let n=String(s).replace(/[^\d+]/g,'');if(n.startsWith('+963'))n='0'+n.slice(4);if(n.startsWith('963'))n='0'+n.slice(3);return n;}
function dateText(v){if(!v)return '—';const d=new Date(v);if(Number.isNaN(+d))return '—';return new Intl.DateTimeFormat('ar-SY-u-nu-latn',{timeZone:'Asia/Damascus',day:'2-digit',month:'short',year:'numeric'}).format(d);}
function timeText(v){if(!v)return '—';const d=new Date(v);if(Number.isNaN(+d))return '—';return new Intl.DateTimeFormat('ar-SY-u-nu-latn',{timeZone:'Asia/Damascus',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(d);}
function ageDays(c){return Math.max(0,Math.floor((Date.now()-new Date(c.created).getTime())/86400000));}
function isIncomplete(c){return c.status==='draft'||!c.name||!c.phone||!c.details||!c.province||c.province==='غير محددة'||c.category==='غير مصنفة';}
function isLate(c){return !c.archivedAt && db.settings.slaApproved && !['closed','cancelled','draft'].includes(c.status) && Number.isFinite(new Date(c.due).getTime()) && Date.now()>new Date(c.due).getTime();}
function statusLabel(s){return ({draft:'غير مكتملة',new:'جديدة',in_progress:'قيد المعالجة',awaiting_reply:'بانتظار رد الجهة',awaiting_approval:'بانتظار الاعتماد',closed:'مغلقة',cancelled:'ملغاة'})[s]||s;}
function statusClass(s){return ({draft:'new',new:'new',in_progress:'progressing',awaiting_reply:'waiting',awaiting_approval:'waiting',closed:'closed',cancelled:'closed'})[s]||'closed';}
function ensureManagedSettings(){if(!db.settings||typeof db.settings!=='object')db.settings={};for(const key of ['categories','entities','provinces','natures']){if(!Array.isArray(db.settings[key])||db.settings[key].length===0)db.settings[key]=[...(seed.settings[key]||[])];}if(!Array.isArray(db.settings.priorities)||!db.settings.priorities.length)db.settings.priorities=seed.settings.priorities.map(x=>({...x}));db.settings.categoryDescriptions ||= {};db.settings.entityDescriptions ||= {};db.settings.natureDescriptions ||= {};}
function priorityLabel(p){ensureManagedSettings();return ({urgent:'عاجلة',high:'عالية',normal:'عادية'})[p]||db.settings.priorities.find(x=>x.value===p)?.label||p;}
function priorityClass(p){return ({urgent:'urgent',high:'high',normal:'normal'})[p]||'normal';}
function pillStatus(s){return '<span class="pill '+statusClass(s)+'">'+esc(statusLabel(s))+'</span>';}
function pillPriority(p){return '<span class="pill '+priorityClass(p)+'">'+esc(priorityLabel(p))+'</span>';}
function logEvent(c,event,detail,by=(authenticatedUser?.username||'النظام')){c.timeline.unshift({event,detail,by,at:new Date().toISOString()});c.updated=new Date().toISOString();}
function notify(title,body){db.notifications.unshift({id:Date.now(),title,body,date:new Date().toISOString(),read:false});persist();}
function toast(msg,type=''){const r=$('#toastRegion');const el=document.createElement('div');el.className='toast '+type;el.textContent=msg;r.append(el);setTimeout(()=>el.remove(),3500);}
function countStatus(s){return db.complaints.filter(c=>!c.archivedAt&&c.status===s).length;}
function pendingApprovals(){return db.complaints.filter(c=>!c.archivedAt&&c.reply&&['review','approval'].includes(c.reply.status));}
function lateComplaints(){return db.complaints.filter(isLate);}
function referralList(){return db.complaints.filter(c=>!c.archivedAt).flatMap(c=>(c.referrals||[]).map((r,i)=>({...r,complaintId:c.id,complaintSummary:c.summary,owner:c.owner,refIndex:i})));}
function pageTitle(){return ({dashboard:'لوحة المتابعة',complaints:'سجل الشكاوى والاستفسارات',referrals:'إدارة الإحالات',replies:'الردود والاعتماد',notifications:'مركز الإشعارات',reports:'التقارير التشغيلية',settings:'القوائم والإعدادات','complaint-detail':'ملف الشكوى'})[page]||'لوحة المتابعة';}
function navCounts(){$('#navComplaintsCount').textContent=db.complaints.length;$('#navReferralsCount').textContent=referralList().filter(r=>!r.response).length;$('#navNotificationsCount').textContent=db.notifications.filter(n=>!n.read).length;$('#topUnread').style.display=db.notifications.some(n=>!n.read)?'block':'none';}

function glassPreference(){try{return localStorage.getItem('complaints-reduce-transparency')==='true';}catch(_){return false;}}
function setGlassPreference(value){document.documentElement?.classList.toggle('reduce-transparency',value);try{localStorage.setItem('complaints-reduce-transparency',String(value));}catch(_){} }
function enhanceGlassDetail(){
 const article=$('.complaint-page');if(!article)return;
 const c=db.complaints.find(x=>x.id===currentId);if(!c)return;
 const header=$('.complaint-page-header',article);
 if(header&&typeof document.createElement==='function'){
  const steps=document.createElement('nav');steps.className='glass-steps';steps.setAttribute('aria-label','مراحل المعالجة');
  const allowed={draft:['new','cancelled'],new:['in_progress','cancelled','draft'],in_progress:['awaiting_reply','awaiting_approval','closed','cancelled'],awaiting_reply:['in_progress','awaiting_approval','closed','cancelled'],awaiting_approval:['in_progress','closed','cancelled'],closed:[],cancelled:[]};
  steps.innerHTML=['new','in_progress','awaiting_reply','awaiting_approval','closed'].map(status=>'<button type="button" data-action="glass-step" data-status="'+status+'" '+(c.status===status?'aria-current="step"':'')+' '+(!(allowed[c.status]||[]).includes(status)?'disabled':'')+'>'+esc(statusLabel(status))+'</button>').join('');
  header.after?.(steps);
 }
 const title=$('.complaint-page-heading h1',article);if(title)title.style.viewTransitionName='complaint-title';
 $$('.row-check').forEach(check=>{if(check.dataset.id===currentId)check.closest?.('tr')?.classList.add('is-selected');});
 const reason=$('#statusReason');if(reason)reason.closest?.('.form-field')?.classList.add('reason-sheet');
 if($('#detailStatus'))updateReasonSheet();
}
function updateReasonSheet(){const reason=$('#statusReason');if(reason){const required=['closed','cancelled'].includes($('#detailStatus')?.value);reason.required=required;const wrap=reason.closest?.('.form-field');if(wrap)wrap.hidden=!required;}}
function commandPalette(){
 if(!authenticatedUser)return;
 modal('لوحة الأوامر','ابحث في الشكاوى والصفحات والإجراءات — Ctrl+K','<input class="field" id="commandQuery" aria-label="بحث الأوامر" autocomplete="off" placeholder="رقم الشكوى أو الاسم أو الإجراء"><div class="command-list" id="commandResults"></div>');
 renderCommands('');$('#commandQuery')?.focus();
}
function renderCommands(query){
 const q=norm(query),mount=$('#commandResults');if(!mount)return;
 const highlight=text=>{const raw=String(text||''),at=raw.toLowerCase().indexOf(query.toLowerCase());return query&&at>=0?esc(raw.slice(0,at))+'<mark>'+esc(raw.slice(at,at+query.length))+'</mark>'+esc(raw.slice(at+query.length)):esc(raw);};
 const records=q?db.complaints.filter(c=>norm([c.id,c.summary,c.name,c.phone].join(' ')).includes(q)).slice(0,15):recentComplaintIds.map(id=>db.complaints.find(c=>c.id===id)).filter(Boolean).slice(0,6);
 const pages=[['dashboard','لوحة العمل'],['complaints','سجل الشكاوى'],['referrals','الإحالات'],['replies','الردود'],['reports','التقارير'],['settings','الإعدادات']].filter(x=>!q||norm(x[1]).includes(q));
 mount.innerHTML='<h3>'+(q?'الشكاوى':'آخر ما فتحته')+'</h3>'+records.map(c=>'<button data-action="detail" data-id="'+esc(c.id)+'">'+highlight(c.summary)+'<small dir="ltr">'+highlight(c.id)+'</small></button>').join('')+'<h3>الصفحات</h3>'+pages.map(([id,label])=>'<button data-action="command-page" data-page-target="'+id+'">'+highlight(label)+'</button>').join('')+(authenticatedUser.role!=='reviewer'&&(!q||norm('تسجيل شكوى جديدة').includes(q))?'<h3>إجراءات</h3><button data-action="new-complaint">＋ تسجيل شكوى جديدة</button>':'')+(!records.length&&!pages.length?'<p>لا توجد نتائج مطابقة.</p>':'');
}
function csvSafe(value){if(value==null)return "";const s=String(value);return /^[\x00-\x1F\s]*[=+\-@]/.test(s)?"'"+s:s;}
function exportCsv(ids){const rows=Array.isArray(ids)&&ids.length?db.complaints.filter(c=>ids.includes(c.id)):db.complaints.filter(c=>!c.archivedAt);const headers=['id','name','phone','province','category','nature','status','priority','owner','summary','created'];const lines=[headers.join(',')];for(const c of rows){lines.push(headers.map(h=>'"'+csvSafe(c[h]??'').replace(/"/g,'""')+'"').join(','));}const blob=new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='complaints-export.csv';a.click();URL.revokeObjectURL(a.href);}
function exportSelected(){if(!selectedIds.size)return;return exportCsv([...selectedIds]);}
async function exportXlsx(){
  try{
    const params=new URLSearchParams();
    const from=$('#reportFrom')?.value?.trim();
    const to=$('#reportTo')?.value?.trim();
    const status=$('#reportStatus')?.value?.trim();
    const province=$('#reportProvince')?.value?.trim();
    if(from)params.set('from',from);
    if(to)params.set('to',to);
    if(status)params.set('status',status);
    if(province)params.set('province',province);
    const qs=params.toString();
    const url='/api/export/xlsx'+(qs?'?'+qs:'');
    const res=await fetch(url,{credentials:'same-origin'});
    if(!res.ok){
      let msg='تعذر تصدير Excel';
      try{const j=await res.json();if(j.error)msg=j.error;}catch(_){}
      throw new Error(msg);
    }
    const blob=await res.blob();
    const dispo=res.headers.get('Content-Disposition')||'';
    let filename='تقرير-الشكاوى.xlsx';
    const m=dispo.match(/filename\*=UTF-8''([^;]+)|filename="?([^\";]+)"?/i);
    if(m){try{filename=decodeURIComponent((m[1]||m[2]||filename).trim());}catch(_){}}
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=filename;
    a.click();
    URL.revokeObjectURL(a.href);
    const count=res.headers.get('X-Export-Count');
    toast(count?('تم تصدير '+count+' سجل إلى Excel.'):'تم تصدير تقرير Excel.');
  }catch(err){
    toast(err.message||'فشل تصدير Excel','error');
  }
}

function availableOwners(){return [...new Set([authenticatedUser?.username,...managedUsers.filter(u=>u.active&&u.role!=='reviewer').map(u=>u.username),...db.complaints.map(c=>c.owner)].filter(Boolean))];}
