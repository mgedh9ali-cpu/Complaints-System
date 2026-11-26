'use strict';
/* Pin the installation to one administrator without deleting historical actors. */
function installSingleOperator({db,authService,middleware,username}){
 db.exec('CREATE TABLE IF NOT EXISTS single_operator(id INTEGER PRIMARY KEY CHECK(id=1),user_id TEXT NOT NULL REFERENCES users(id))');
 let row=db.prepare('SELECT user_id FROM single_operator WHERE id=1').get();
 if(!row){
  const user=db.prepare("SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY (username=?) DESC,created_at,id LIMIT 1").get(username||'');
  if(!user)throw new Error('لا يوجد حساب مالك فعال لهذا التثبيت.');
  db.prepare('INSERT INTO single_operator(id,user_id) VALUES(1,?)').run(user.id);row={user_id:user.id};
 }
 const account=()=>db.prepare("SELECT id,username FROM users WHERE id=? AND role='admin' AND active=1").get(row.user_id);
 if(!account())throw new Error('حساب المالك غير فعال؛ يلزم استعادة نسخة موثوقة.');
 const authenticate=authService.authenticate.bind(authService);
 authService.authenticate=async(name,...args)=>{
  const owner=account();
  if(!owner||name!==owner.username)return {ok:false,status:401,error:'بيانات الدخول غير صحيحة.'};
  return authenticate(name,...args);
 };
 const requireAuth=middleware.requireAuth;
 middleware.requireAuth=(req,res,next)=>requireAuth(req,res,()=>{
  if(req.user.id!==row.user_id)return req.session.destroy(()=>res.status(403).json({error:'هذا التثبيت مخصص لحساب المالك فقط.'}));
  next();
 });
 return function rejectTeamOperations(req,res,next){
  if(/^\/(users|roles|assignees)(\/|$)/i.test(req.path))return res.status(410).json({error:'وظائف الموظفين غير متاحة في هذا التطبيق الفردي.'});
  if(['POST','PATCH'].includes(req.method)&&/^\/complaints(?:\/[^/]+)?\/?$/.test(req.path)&&req.body&&
    ['owner','coAssistants'].some(k=>Object.hasOwn(req.body,k)))return res.status(400).json({error:'الإسناد والمساعدون غير متاحين في هذا التطبيق.'});
  next();
 };
}
module.exports={installSingleOperator};
