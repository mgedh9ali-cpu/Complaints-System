function applyUiPermissions(){
  try{
    const role=authenticatedUser?.role;
    if(!role)return;
    const headerCreate=$('#headerCreateButton');
    if(headerCreate)headerCreate.hidden=!uiCan('complaints.create');
    // Hide create actions for reviewers; hide settings manage for non-admins when marked.
    $$('[data-action="new-complaint"]').forEach(el=>{if(role==='reviewer')el.hidden=true;});
    $$('[data-action="save-incomplete"],[data-action="save-complaint"]').forEach(el=>{if(role==='reviewer')el.hidden=true;});
    $$('.complaint-page.readonly [data-action="change-status"],.complaint-page.readonly [data-action="assign-owner"],.complaint-page.readonly [data-action="change-priority"]').forEach(el=>{el.disabled=true;});
  }catch(_){}
}
function render(){
 const previous=new Map();
 if(!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)$$('.row-title').forEach(el=>{if(el.getBoundingClientRect)previous.set(el.dataset.id,el.getBoundingClientRect());});
 $('.bulk-bar')?.remove();
 const content=$('#content');const renderers={dashboard,complaints:complaintsPage,referrals:referralsPage,replies:repliesPage,notifications:notificationsPage,reports:reportsPage,settings:settingsPage,'complaint-detail':complaintDetailPage};content.innerHTML=page==='complaint-detail'?'<div class="detail-workspace">'+complaintDetailPage()+'</div>':'<div class="triage-list">'+(renderers[page]||dashboard)()+'</div>';enhanceGlassDetail();applyUiPermissions();
 const bulk=$('.bulk-bar',content);if(bulk)document.body.append(bulk);
 $$('.row-title').forEach(el=>{const before=previous.get(el.dataset.id);if(before&&el.animate){const after=el.getBoundingClientRect();const dy=before.top-after.top;if(dy)el.animate([{transform:'translateY('+dy+'px)'},{transform:'none'}],{duration:220,easing:'cubic-bezier(.2,.8,.2,1)'});}});
 $('#pageCrumb').textContent=pageTitle();navCounts();$$('.nav-link').forEach(b=>{const isCurrent=b.dataset.page===page;b.classList.toggle('active',isCurrent);if(isCurrent)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});}
function go(p,replace=false){
 if(!['dashboard','complaints','referrals','replies','notifications','reports','settings','complaint-detail'].includes(p))p='dashboard';
 page=p;selectedIds.clear();if($('#navBackdrop'))$('#navBackdrop').hidden=true;$('#sidebar').classList.remove('open');$('#menuToggle').setAttribute('aria-expanded','false');
 if(!replace)history.pushState({view:p},'',p==='complaint-detail'&&currentId?'#complaint/'+encodeURIComponent(currentId):'#'+p);
 render();$('#content').focus({preventScroll:true});
}
function restoreUiRoute(){
 const hash=location.hash||'';
 if(hash.startsWith('#complaint/')){
  let id='';try{id=decodeURIComponent(hash.slice('#complaint/'.length));}catch(_){}
  if(id&&db.complaints.some(c=>c?.id===id)){currentId=id;page='complaint-detail';return;}
 }
 const route=hash.slice(1);
 page=['dashboard','complaints','referrals','replies','notifications','reports','settings'].includes(route)?route:'dashboard';
}
window.addEventListener('popstate',()=>{if(!authenticatedUser)return;restoreUiRoute();render();});


// Three-way comparison preserves unrelated edits from the other session.
function mergeStateVersions(base,local,remote,choices={},path=[],conflicts=[]){
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 if(same(local,base))return structuredClone(remote);
 if(same(remote,base)||same(local,remote))return structuredClone(local);
 const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
 if(object(local)&&object(remote)&&object(base)){
  const out={};for(const key of new Set([...Object.keys(remote),...Object.keys(local),...Object.keys(base)])){
   const value=mergeStateVersions(base[key],local[key],remote[key],choices,[...path,key],conflicts);if(value!==undefined)out[key]=value;
  }return out;
 }
 if(path.length===1&&path[0]==='complaints'&&Array.isArray(local)&&Array.isArray(remote)){
  const b=new Map((base||[]).map(c=>[c.id,c])),l=new Map(local.map(c=>[c.id,c])),r=new Map(remote.map(c=>[c.id,c]));
  return [...new Set([...r.keys(),...l.keys()])].map(id=>mergeStateVersions(b.get(id),l.get(id),r.get(id),choices,[...path,id],conflicts)).filter(Boolean);
 }
 const key=JSON.stringify(path);conflicts.push({key,path,local,remote});
 return structuredClone(choices[key]==='local'?local:remote);
}
async function openStateConflict(){
 if(!conflictDraft||!authenticatedUser)return;
 const stored=await api('/api/state');const conflicts=[];
 // GET refreshed stateBase; retain the original base in conflictDraft.
 mergeStateVersions(conflictDraft.base||cleanState(),conflictDraft.local,stored.state||cleanState(),{},[],conflicts);
 conflictDraft.remote=stored.state||cleanState();conflictDraft.revision=stored.revision;conflictDraft.conflicts=conflicts;
 const show=value=>esc(JSON.stringify(value,null,2)??'غير موجود');
 modal('تعارض النسخ','راجع الفروق قبل إعادة الحفظ. تبقى الصلاحيات وقواعد الحالة مطبقة على الخادم.',
 '<div class="conflict-diff">'+(conflicts.length?conflicts.map((diff,i)=>'<fieldset><legend>'+esc(diff.path.join(' / '))+'</legend><label><input type="radio" name="conflict-'+i+'" value="remote" checked> خذ نسخة زميلك</label><pre>'+show(diff.remote)+'</pre><label><input type="radio" name="conflict-'+i+'" value="local"> احتفظ بتعديلي</label><pre>'+show(diff.local)+'</pre></fieldset>').join(''):'<p>التعديلات على حقول مختلفة؛ يمكن دمجها مع الاحتفاظ بنسخة زميلك.</p>')+'</div>',
 '<button class="btn" data-action="conflict-remote">خذ نسخة زميلك كاملة</button><button class="btn btn-primary" data-action="conflict-save">حفظ الخيارات</button>',true);
}
async function resolveStateConflict(remoteOnly=false){
 if(!conflictDraft)return;
 const draft=conflictDraft,choices={};draft.conflicts.forEach((diff,i)=>{choices[diff.key]=$('input[name="conflict-'+i+'"]:checked')?.value||'remote';});
 const merged=remoteOnly?structuredClone(draft.remote):mergeStateVersions(draft.base||cleanState(),draft.local,draft.remote,choices);
 try{
  if(!remoteOnly){
   const saved=await api('/api/state',{method:'PUT',headers:{'X-State-Revision':String(draft.revision)},body:JSON.stringify(merged)});stateRevision=saved.revision;
  }else stateRevision=draft.revision;
  db=merged;stateBase=structuredClone(merged);stateConflict=false;conflictDraft=null;closeModal();render();toast(remoteOnly?'تم اعتماد نسخة زميلك.':'تم دمج التعديلات وحفظها.');
 }catch(error){toast(error.message,'error');}
}
