  .login-card h1{font-size:24px;margin:0 0 8px}.login-card p{color:#64746f;font-size:13px;line-height:1.8;margin:0 0 20px}
  .login-card label{display:block;font-size:13px;font-weight:700;margin:12px 0 6px}
  .login-card input{width:100%;box-sizing:border-box;border:1px solid #cbd7d2;border-radius:9px;padding:12px;font:inherit;direction:ltr;text-align:left}
  .login-card button{width:100%;border:0;border-radius:9px;padding:12px;margin-top:18px;background:#145b49;color:#fff;font:inherit;font-weight:700;cursor:pointer}
  .login-error{color:#a52626;background:#fff0f0;padding:10px;border-radius:8px;margin-top:12px;font-size:13px}
  .login-note{font-size:11px!important;margin-top:16px!important}`;
  document.head.append(style);}
  let root=$('#loginOverlay');
  if(!root){root=document.createElement('div');root.id='loginOverlay';root.className='login-overlay';root.innerHTML='<section class="login-card" role="dialog" aria-modal="true" aria-labelledby="loginTitle"><h1 id="loginTitle">تسجيل الدخول</h1><p>أدخل بيانات المدير التي أنشأتها عند إعداد النظام على هذا اللابتوب.</p><form id="loginForm"><label for="loginUsername">اسم المستخدم</label><input id="loginUsername" name="username" autocomplete="username" required maxlength="100"><label for="loginPassword">كلمة المرور</label><input id="loginPassword" name="password" type="password" autocomplete="current-password" required maxlength="200"><div id="loginError" class="login-error" role="alert" hidden></div><button type="submit">دخول إلى النظام</button></form><p class="login-note">إذا لم تُعد ملف .env بعد، راجع تعليمات التشغيل في README. لا توجد كلمة مرور افتراضية مخفية.</p></section>';document.body.append(root);
    $('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const button=$('#loginForm button');button.disabled=true;button.textContent='جارٍ التحقق…';const err=$('#loginError');err.hidden=true;try{
      const result=await api('/api/auth/login',{method:'POST',body:JSON.stringify({username:$('#loginUsername').value,password:$('#loginPassword').value})});
      authenticatedUser=result.user;
      const stored=await api('/api/state');
      stateRevision=Number.isSafeInteger(stored.revision)?stored.revision:0;
      stateConflict=false;
      if(stored.state&&Array.isArray(stored.state.complaints)){db=stored.state;}
      else{
        db=cleanState();
        const saved=await api('/api/state',{
          method:'PUT',
          headers:{'X-State-Revision':String(stateRevision)},
          body:JSON.stringify(db)
        });
        stateRevision=saved.revision;
      }
      stateLoaded=true;root.remove();updateSignedInUi();render();refreshManagedUsers();
      toast('تم تسجيل الدخول وحُملت البيانات من قاعدة SQLite.');
    }catch(ex){err.textContent=ex.message;err.hidden=false;}finally{button.disabled=false;button.textContent='دخول إلى النظام';}
    });
  }
  root.hidden=false;$('#loginUsername')?.focus();
}
async function logout(){
  clearTimeout(persistTimer);
  await persistQueue;
  if(stateConflict){
    if(!confirm('هناك تعديلات لم تُحفظ بسبب تعارض مع نسخة أحدث. سيؤدي تسجيل الخروج إلى فقدان تعديلات هذه الصفحة. هل تريد المتابعة؟'))return;
  }else if(authenticatedUser&&stateLoaded){
    try{
      const saved=await api('/api/state',{
        method:'PUT',
        headers:{'X-State-Revision':String(stateRevision)},
        body:JSON.stringify(db)
      });
      stateRevision=saved.revision;
    }catch(error){
      if(error.status===409||error.status===428){
        stateConflict=true;
        if(!confirm(error.message+' سيؤدي تسجيل الخروج إلى فقدان تعديلات هذه الصفحة. هل تريد المتابعة؟'))return;
      }else{
        toast('تعذر حفظ التغييرات: '+error.message,'error');
        return;
      }
    }
  }
  try{await api('/api/auth/logout',{method:'POST',body:'{}'});}
  catch(error){toast('تعذر إنهاء الجلسة: '+error.message,'error');return;}
  authenticatedUser=null;stateLoaded=false;stateRevision=0;stateConflict=false;db=cleanState();updateSignedInUi();showLogin();
}
function esc(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function norm(s=''){return String(s).normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/[ىئي]/g,'ي').replace(/ة/g,'ه').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ء/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
function phoneNorm(s=''){let n=String(s).replace(/[^\d+]/g,'');if(n.startsWith('+963'))n='0'+n.slice(4);if(n.startsWith('963'))n='0'+n.slice(3);return n;}
function dateText(v){if(!v)return '—';const d=new Date(v);if(Number.isNaN(+d))return '—';return new Intl.DateTimeFormat('ar-SY',{day:'2-digit',month:'short',year:'numeric'}).format(d);}
function timeText(v){if(!v)return '—';const d=new Date(v);if(Number.isNaN(+d))return '—';return new Intl.DateTimeFormat('ar-SY',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(d);}
function ageDays(c){return Math.max(0,Math.floor((Date.now()-new Date(c.created).getTime())/86400000));}
function isLate(c){return db.settings.slaApproved && c.status!=='closed' && Date.now()>new Date(c.due).getTime();}
function statusLabel(s){return ({new:'جديدة',in_progress:'قيد المعالجة',awaiting_reply:'بانتظار رد الجهة',awaiting_approval:'بانتظار الاعتماد',closed:'مغلقة',cancelled:'ملغاة'})[s]||s;}
function statusClass(s){return ({new:'new',in_progress:'progressing',awaiting_reply:'waiting',awaiting_approval:'waiting',closed:'closed',cancelled:'closed'})[s]||'closed';}
function ensureManagedSettings(){if(!db.settings||typeof db.settings!=='object')db.settings={};for(const key of ['categories','entities','provinces'])if(!Array.isArray(db.settings[key]))db.settings[key]=[...seed.settings[key]];if(!Array.isArray(db.settings.priorities))db.settings.priorities=seed.settings.priorities.map(x=>({...x}));db.settings.categoryDescriptions ||= {};db.settings.entityDescriptions ||= {};}
function priorityLabel(p){ensureManagedSettings();return ({urgent:'عاجلة',high:'عالية',normal:'عادية'})[p]||db.settings.priorities.find(x=>x.value===p)?.label||p;}
function priorityClass(p){return ({urgent:'urgent',high:'high',normal:'normal'})[p]||'normal';}
function pillStatus(s){return '<span class="pill '+statusClass(s)+'">'+esc(statusLabel(s))+'</span>';}
function pillPriority(p){return '<span class="pill '+priorityClass(p)+'">'+esc(priorityLabel(p))+'</span>';}
function logEvent(c,event,detail,by='مستخدم تجريبي'){c.timeline.unshift({event,detail,by,at:new Date().toISOString()});c.updated=new Date().toISOString();}
function notify(title,body){db.notifications.unshift({id:Date.now(),title,body,date:new Date().toISOString(),read:false});persist();}
function toast(msg,type=''){const r=$('#toastRegion');const el=document.createElement('div');el.className='toast '+type;el.textContent=msg;r.append(el);setTimeout(()=>el.remove(),3500);}
function countStatus(s){return db.complaints.filter(c=>c.status===s).length;}
function pendingApprovals(){return db.complaints.filter(c=>c.reply&&['review','approval'].includes(c.reply.status));}
function lateComplaints(){return db.complaints.filter(isLate);}
function referralList(){return db.complaints.flatMap(c=>(c.referrals||[]).map((r,i)=>({...r,complaintId:c.id,complaintSummary:c.summary,owner:c.owner,refIndex:i})));}
function pageTitle(){return ({dashboard:'لوحة المتابعة',complaints:'سجل الشكاوى والاستفسارات',referrals:'إدارة الإحالات',replies:'الردود والاعتماد',notifications:'مركز الإشعارات',reports:'التقارير التشغيلية',settings:'القوائم والإعدادات'})[page]||'لوحة المتابعة';}
function navCounts(){$('#navComplaintsCount').textContent=db.complaints.length;$('#navReferralsCount').textContent=referralList().filter(r=>!r.response).length;$('#navNotificationsCount').textContent=db.notifications.filter(n=>!n.read).length;$('#topUnread').style.display=db.notifications.some(n=>!n.read)?'block':'none';}
function heading(title,desc,actions=''){return '<div class="page-heading"><div><div class="eyebrow">شعبة الاستفسارات والشكاوى</div><h1>'+title+'</h1><p>'+desc+'</p></div><div class="heading-actions">'+actions+'</div></div>';}
function btn(label,action,kind=''){return '<button class="btn '+kind+'" data-action="'+action+'">'+label+'</button>';}
function complaintTable(rows,opts={}){if(!rows.length)return '<div class="empty-state">لا توجد سجلات تطابق البحث أو المرشحات الحالية.</div>';return '<div class="table-wrap"><table><thead><tr>'+(opts.select?'<th><input class="table-check" type="checkbox" aria-label="تحديد الكل" data-action="select-all"></th>':'')+'<th>رقم الشكوى</th><th>الموضوع / المشتكي</th><th>المحافظة</th><th>الحالة</th><th>الأولوية</th><th>المسؤول</th><th>مدة البقاء</th><th>الإجراء</th></tr></thead><tbody>'+rows.map(c=>'<tr>'+(opts.select?'<td><input class="table-check row-check" type="checkbox" aria-label="تحديد '+esc(c.id)+'" data-id="'+esc(c.id)+'" '+(selectedIds.has(c.id)?'checked':'')+'></td>':'')+'<td><span class="ticket-id">'+esc(c.id)+'</span><span class="row-sub">'+dateText(c.created)+'</span></td><td><button class="text-link row-title" data-action="detail" data-id="'+esc(c.id)+'">'+esc(c.summary)+'</button><span class="row-sub">'+esc(c.name||'غير محدد')+'</span></td><td>'+esc(c.province||'—')+'</td><td>'+pillStatus(c.status)+'</td><td>'+pillPriority(c.priority)+'</td><td>'+esc(c.owner||'غير مسند')+'</td><td><span class="age '+(isLate(c)?'late':ageDays(c)>5?'soon':'ok')+'">'+ageDays(c)+' يوم'+(isLate(c)?' · متأخرة':'')+'</span></td><td><div class="action-cell"><button data-action="detail" data-id="'+esc(c.id)+'" aria-label="فتح تفاصيل '+esc(c.id)+'">عرض</button></div></td></tr>').join('')+'</tbody></table></div>';}
