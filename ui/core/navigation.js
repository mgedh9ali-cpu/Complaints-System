function render(){const content=$('#content');const renderers={dashboard,complaints:complaintsPage,referrals:referralsPage,replies:repliesPage,notifications:notificationsPage,reports:reportsPage,settings:settingsPage,'complaint-detail':complaintDetailPage};content.innerHTML=(renderers[page]||dashboard)();applyUiPermissions();$('#pageCrumb').textContent=pageTitle();navCounts();$$('.nav-link').forEach(b=>{const isCurrent=b.dataset.page===page;b.classList.toggle('active',isCurrent);if(isCurrent)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});}
function go(p,replace=false){
 if(!['dashboard','complaints','referrals','replies','notifications','reports','settings','complaint-detail'].includes(p))p='dashboard';
 page=p;selectedIds.clear();$('#sidebar').classList.remove('open');$('#menuToggle').setAttribute('aria-expanded','false');
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

