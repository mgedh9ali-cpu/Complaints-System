(() => {
'use strict';
const $ = (s, root=document) => root.querySelector(s);
async function api(url, options={}) {
  const response=await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
  if(response.status===204)return null;
  const body=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(body.error||'تعذر تنفيذ الطلب.');error.status=response.status;throw error;}
  return body;
}
function showLogin(){
  let style=$('#loginStyles');
  if(!style){style=document.createElement('style');style.id='loginStyles';style.textContent=`
  .login-overlay{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:rgba(9,30,26,.82);backdrop-filter:blur(5px)}
  .login-card{width:min(100%,440px);background:#fff;border-radius:18px;padding:28px;box-shadow:0 24px 90px #0005;color:#17372f}
  .login-card h1{font-size:24px;margin:0 0 8px}.login-card p{color:#64746f;font-size:13px;line-height:1.8;margin:0 0 20px}
  .login-card label{display:block;font-size:13px;font-weight:700;margin:12px 0 6px}
  .login-card input{width:100%;box-sizing:border-box;border:1px solid #cbd7d2;border-radius:9px;padding:12px;font:inherit;direction:ltr;text-align:left}
  .login-card #loginForm > button[type=submit]{width:100%;border:0;border-radius:9px;padding:12px;margin-top:18px;background:#145b49;color:#fff;font:inherit;font-weight:700;cursor:pointer}
  .login-error{color:#a52626;background:#fff0f0;padding:10px;border-radius:8px;margin-top:12px;font-size:13px}
  .login-note{font-size:11px!important;margin-top:16px!important}`;
  document.head.append(style);}
  let root=$('#loginOverlay');
  if(!root){root=document.createElement('div');root.id='loginOverlay';root.className='login-overlay';root.innerHTML='<section class="login-card" role="dialog" aria-modal="true" aria-labelledby="loginTitle"><h1 id="loginTitle">تسجيل الدخول</h1><p>أدخل بيانات المدير التي أنشأتها عند إعداد النظام على هذا اللابتوب.</p><form id="loginForm"><label for="loginUsername">اسم المستخدم</label><input id="loginUsername" name="username" autocomplete="username" required maxlength="100"><label for="loginPassword">كلمة المرور</label><input id="loginPassword" name="password" type="password" autocomplete="current-password" required maxlength="200"><div id="loginError" class="login-error" role="alert" hidden></div><button type="submit">دخول إلى النظام</button></form><p class="login-note">اسم المستخدم: admin — كلمة المرور تُطبع مرة واحدة في الطرفية عند إنشاء .env</p></section>';document.body.append(root);
    $('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const button=$('#loginForm button[type=submit]');button.disabled=true;button.textContent='جارٍ التحقق…';const err=$('#loginError');err.hidden=true;try{
      const result=await api('/api/auth/login',{method:'POST',body:JSON.stringify({username:$('#loginUsername').value,password:$('#loginPassword').value})});
      authenticatedUser=result.user;
      root.remove();
      document.body.insertAdjacentHTML('afterbegin','<div dir="rtl" style="padding:20px;background:#145b49;color:#fff;text-align:center;font-family:Tahoma">تم تسجيل الدخول كـ '+String(result.user.username)+' ('+String(result.user.role)+'). الواجهة الكاملة تُستكمل في الدفعة 1 — الأجزاء app-p01..p09.</div>');
    }catch(ex){err.textContent=ex.message;err.hidden=false;}finally{button.disabled=false;button.textContent='دخول إلى النظام';}
    });
  }
  root.hidden=false;$('#loginUsername')?.focus();
}
let authenticatedUser=null;
api('/api/auth/me').then((result)=>{authenticatedUser=result.user;document.body.insertAdjacentHTML('afterbegin','<div dir="rtl" style="padding:20px;background:#145b49;color:#fff;text-align:center;font-family:Tahoma">جلسة نشطة: '+String(result.user.username)+'</div>');}).catch(()=>showLogin());
})();
