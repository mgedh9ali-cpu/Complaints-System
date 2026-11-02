function workDayKey(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Damascus',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function norm(s=''){return String(s).normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/[ىئي]/g,'ي').replace(/ة/g,'ه').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ء/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
function phoneNorm(s=''){let n=String(s).replace(/[^\d+]/g,'');if(n.startsWith('+963'))n='0'+n.slice(4);if(n.startsWith('963'))n='0'+n.slice(3);return n;}
function dateText(v){if(!v)return '—';const d=new Date(v);if(Number.isNaN(+d))return '—';return new Intl.DateTimeFormat('ar-SY-u-nu-latn',{timeZone:'Asia/Damascus',day:'2-digit',month:'short',year:'numeric'}).format(d);}
function timeText(v){if(!v)return '—';const d=new Date(v);if(Number.isNaN(+d))return '—';return new Intl.DateTimeFormat('ar-SY-u-nu-latn',{timeZone:'Asia/Damascus',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(d);}
function ageDays(c){return Math.max(0,Math.floor((Date.now()-new Date(c.created).getTime())/86400000));}
function isIncomplete(c){return c.status==='draft'||!c.name||!c.phone||!c.details||!c.province||c.province==='غير محددة'||c.category==='غير مصنفة';}
function isLate(c){return !c.archivedAt && db.settings.slaApproved && !['closed','cancelled','draft'].includes(c.status) && Number.isFinite(new Date(c.due).getTime()) && Date.now()>new Date(c.due).getTime();}
function statusLabel(s){return ({draft:'غير مكتملة',new:'جديدة',in_progress:'قيد المعالجة',awaiting_reply:'بانتظار رد الجهة',awaiting_approval:'بانتظار الاعتماد',closed:'مغلقة',cancelled:'ملغاة'})[s]||s;}
function statusClass(s){return ({draft:'new',new:'new',in_progress:'progressing',awaiting_reply:'waiting',awaiting_approval:'waiting',closed:'closed',cancelled:'closed'})[s]||'closed';}
function ensureManagedSettings(){if(!db.settings||typeof db.settings!=='object')db.settings={};for(const key of ['categories','entities','provinces'])if(!Array.isArray(db.settings[key]))db.settings[key]=[...seed.settings[key]];if(!Array.isArray(db.settings.priorities))db.settings.priorities=seed.settings.priorities.map(x=>({...x}));db.settings.categoryDescriptions ||= {};db.settings.entityDescriptions ||= {};}
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
