'use strict';

const crypto = require('node:crypto');
const {hashPassword,verifyPassword,needsUpgrade}=require('../../lib/passwords');
const { revokeUserSessions } = require('../../lib/session-revoke');
const { isValidUsername, isValidPassword } = require('../../lib/validation');
const { createRolesService, CUSTOMIZABLE } = require('../roles/service');
const { storageFor } = require('../../lib/storage-codec');
const { generateSecret, verifyTotp, recoveryHash } = require('../../lib/totp');

const ROLES = Object.freeze(['admin', 'staff', 'reviewer']);

function createAuthService({ db, audit, logger, sessionsDir }) {
  createRolesService({ db });
  if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'session_version')) {
    db.exec('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0');
  }
  const columns = new Set(db.prepare('PRAGMA table_info(users)').all().map(c=>c.name));
  for (const [name, type] of [['totp_secret','TEXT'],['totp_recovery','TEXT'],['totp_last_step','INTEGER NOT NULL DEFAULT -1']]) {
    if (!columns.has(name)) db.exec('ALTER TABLE users ADD COLUMN ' + name + ' ' + type);
  }
  const storage = storageFor(db);
  function syncAudit() { if (!db.inTransaction && typeof audit?.syncHead === 'function') audit.syncHead(); }
  function findByUsername(username) {
    return db
      .prepare('SELECT id, username, password_hash, role, active, session_version, totp_secret, totp_recovery, totp_last_step FROM users WHERE username = ?')
      .get(username);
  }

  function findById(id) {
    return db.prepare('SELECT id, username, role, active FROM users WHERE id = ?').get(id);
  }

  function findByIdWithHash(id) {
    return db
      .prepare('SELECT id, username, password_hash, role, active FROM users WHERE id = ?')
      .get(id);
  }

  function listUsers() {
    return db
      .prepare(
        'SELECT id, username, role, active, created_at AS createdAt FROM users ORDER BY created_at ASC'
      )
      .all();
  }

  function revokeSessions(userId, keepSessionId) {
    if (!sessionsDir) return { revoked: 0 };
    try {
      return revokeUserSessions(sessionsDir, userId, { keepSessionId: keepSessionId || null });
    } catch (err) {
      if (logger) logger.warn('session revoke failed', { userId, error: err.message });
      return { revoked: 0 };
    }
  }

  function authenticate(username, password, secondFactor) {
    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      username.length > 100 ||
      password.length > 200
    ) {
      return { ok: false, status: 400, error: 'أدخل اسم المستخدم وكلمة المرور.' };
    }
    const user = findByUsername(username.trim());
    const matches = user ? verifyPassword(password, user.password_hash) : false;
    if (!user || !matches || user.active !== 1) {
      if (user && typeof audit === 'function') audit(user.id, 'login_failed', 'user', user.id);
      return { ok: false, status: 401, error: 'بيانات الدخول غير صحيحة.' };
    }
    const accepted = db.transaction(() => {
      if (user.totp_secret && !consumeSecondFactor(user, secondFactor)) return false;
      if(needsUpgrade(user.password_hash)){
        db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password),user.id);
        if(typeof audit==='function')audit(user.id,'password_hash_upgraded','user',user.id,{});
      }
      if (typeof audit === 'function') audit(user.id, 'login_succeeded', 'user', user.id, { twoFactor: Boolean(user.totp_secret) });
      return true;
    })();
    if (!accepted) {
      if (typeof audit === 'function') audit(user.id, 'second_factor_failed', 'user', user.id, {});
      return { ok: false, status: 401, error: 'أدخل رمز التحقق الثنائي الصحيح أو رمز استرداد صالح.' };
    }
    syncAudit();
    return {
      ok: true,
      user: { id: user.id, username: user.username, role: user.role, sessionVersion: user.session_version, twoFactorEnabled: Boolean(user.totp_secret) }
    };
  }

  function createUser({ username, password, role, actorId }) {
    if (!isValidUsername(username) || !isValidPassword(password) || !ROLES.includes(role)) {
      return { ok: false, status: 400, error: 'اسم المستخدم أو كلمة المرور أو الدور غير صالح.' };
    }
    const id = crypto.randomUUID();
    const normalizedUsername = username.trim();
    const passwordHash = hashPassword(password);
    try {
      db.transaction(() => { db.prepare(
        'INSERT INTO users(id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)'
      ).run(id, normalizedUsername, passwordHash, role, new Date().toISOString());
      if (typeof audit === 'function') audit(actorId, 'user_created', 'user', id, { username: normalizedUsername, role });
      })();
    } catch (error) {
      if (error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return { ok: false, status: 409, error: 'اسم المستخدم مستخدم بالفعل.' };
      }
      throw error;
    }
    syncAudit();
    if (logger) logger.info('user created', { id, username: normalizedUsername, role, actorId });
    return { ok: true, user: { id, username: normalizedUsername, role, active: 1 } };
  }

  function setActive({ targetId, active, actorId }) {
    if (typeof active !== 'boolean') {
      return { ok: false, status: 400, error: 'قيمة تفعيل الحساب غير صالحة.' };
    }
    const target = findById(targetId);
    if (!target) return { ok: false, status: 404, error: 'الحساب غير موجود.' };
    if (target.id === actorId && active === false) {
      return { ok: false, status: 409, error: 'لا يمكن للمدير تعطيل حسابه الحالي.' };
    }
    if (target.role === 'admin' && target.active === 1 && active === false) {
      const activeAdmins = db
        .prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1")
        .get().count;
      if (activeAdmins <= 1) {
        return { ok: false, status: 409, error: 'لا يمكن تعطيل آخر حساب مدير نشط.' };
      }
    }
    db.transaction(() => {
      db.prepare('UPDATE users SET active = ?, session_version = session_version + 1 WHERE id = ?').run(active ? 1 : 0, target.id);
      if (typeof audit === 'function') audit(actorId, active ? 'user_activated' : 'user_deactivated', 'user', target.id, {
        username: target.username, role: target.role
      });
    })();
    syncAudit();
    let sessionsRevoked = 0;
    if (active === false) {
      sessionsRevoked = revokeSessions(target.id).revoked;
    }
    return {
      ok: true,
      user: { id: target.id, username: target.username, role: target.role, active: active ? 1 : 0 },
      sessionsRevoked
    };
  }

  function changePassword({ userId, currentPassword, newPassword, keepSessionId }) {
    if (typeof currentPassword !== 'string' || currentPassword.length > 200 || typeof newPassword !== 'string') {
      return { ok: false, status: 400, error: 'أدخل كلمة المرور الحالية والجديدة.' };
    }
    if (!isValidPassword(newPassword)) {
      return { ok: false, status: 400, error: 'كلمة المرور الجديدة يجب أن تكون بين 12 و 200 حرفاً.' };
    }
    if (currentPassword === newPassword) {
      return { ok: false, status: 400, error: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية.' };
    }
    const user = findByIdWithHash(userId);
    if (!user || user.active !== 1) {
      return { ok: false, status: 401, error: 'الحساب غير موجود أو غير فعال.' };
    }
    if (!verifyPassword(currentPassword, user.password_hash)) {
      if (typeof audit === 'function') audit(userId, 'password_change_failed', 'user', userId, {});
      return { ok: false, status: 401, error: 'كلمة المرور الحالية غير صحيحة.' };
    }
    const passwordHash = hashPassword(newPassword);
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?').run(passwordHash, userId);
      if (typeof audit === 'function') audit(userId, 'password_changed', 'user', userId, {});
    })();
    syncAudit();
    const sessionsRevoked = revokeSessions(userId, keepSessionId).revoked;
    if (logger) logger.info('password changed', { userId, sessionsRevoked });
    return { ok: true, sessionsRevoked };
  }

  function ensureBootstrapAdmin(adminUsername, adminPassword) {
    const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    if (userCount > 0) return null;
    const passwordHash = hashPassword(adminPassword);
    const id = crypto.randomUUID();
    db.transaction(() => { db.prepare(
      'INSERT INTO users(id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, adminUsername, passwordHash, 'admin', new Date().toISOString());
    // حدث تدقيق واحد فقط للإقلاع الأولي
    if (typeof audit === 'function') {
      audit(id, 'bootstrap_admin', 'user', id, { username: adminUsername });
    }
    })();
    syncAudit();
    if (logger) logger.security('Created initial administrator account', { username: adminUsername });
    return id;
  }

  function setPermissions({ targetId, overrides, actorId }) {
    const target = findById(targetId);
    if (!target) return { ok: false, status: 404, error: 'الحساب غير موجود.' };
    if (target.role === 'admin') return { ok: false, status: 409, error: 'صلاحيات المدير ثابتة.' };
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) ||
        Object.entries(overrides).some(([key, value]) => !CUSTOMIZABLE.includes(key) || typeof value !== 'boolean')) {
      return { ok: false, status: 400, error: 'قائمة الصلاحيات غير صالحة.' };
    }
    db.transaction(() => {
      const before = db.prepare('SELECT overrides_json FROM user_permissions WHERE user_id=?').get(targetId);
      db.prepare('INSERT INTO user_permissions(user_id, overrides_json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET overrides_json=excluded.overrides_json')
        .run(targetId, JSON.stringify(overrides));
      db.prepare('UPDATE users SET session_version=session_version+1 WHERE id=?').run(targetId);
      if (typeof audit === 'function') audit(actorId, 'user_permissions_changed', 'user', targetId,
        { before: before ? JSON.parse(before.overrides_json) : {}, after: overrides });
    })();
    syncAudit();
    revokeSessions(targetId);
    return { ok: true, user: target };
  }

  function consumeSecondFactor(user, code) {
    const secret = storage.decodeJson(user.totp_secret, 'totp:' + user.id);
    const step = verifyTotp(secret, code, { lastStep: user.totp_last_step });
    if (step !== null) return db.prepare('UPDATE users SET totp_last_step=? WHERE id=? AND totp_last_step<?').run(step,user.id,step).changes === 1;
    if (typeof code !== 'string' || !/^REC-[A-Za-z0-9_-]{16}$/.test(code)) return false;
    const original = user.totp_recovery || '[]';
    const hashes = JSON.parse(original), hash = recoveryHash(user.id,code);
    if (!hashes.includes(hash)) return false;
    let used = false;
    db.transaction(() => {
      used = db.prepare('UPDATE users SET totp_recovery=? WHERE id=? AND totp_recovery=?')
        .run(JSON.stringify(hashes.filter(h=>h!==hash)),user.id,original).changes === 1;
      if (used && typeof audit === 'function') audit(user.id,'two_factor_recovery_used','user',user.id,{});
    })();
    syncAudit();
    return used;
  }

  function beginTwoFactor({userId,password}) {
    const user=findByIdWithHash(userId);
    if (!user || typeof password!=='string' || password.length>200 || !verifyPassword(password,user.password_hash)) return {ok:false,status:401,error:'كلمة المرور الحالية غير صحيحة.'};
    if (!storage.enabled) return {ok:false,status:409,error:'يلزم تفعيل تشفير التخزين قبل إعداد التحقق الثنائي.'};
    const enabled=db.prepare('SELECT totp_secret FROM users WHERE id=?').get(userId)?.totp_secret;
    if(enabled)return {ok:false,status:409,error:'التحقق الثنائي مفعل بالفعل.'};
    const secret=generateSecret();
    const pending=storage.encodeJson({secret,expiresAt:Date.now()+10*60000},'totp-pending:'+userId);
    return {ok:true,secret,pending,uri:'otpauth://totp/'+encodeURIComponent('Complaints System:'+user.username)+'?secret='+secret+'&issuer=Complaints%20System&algorithm=SHA1&digits=6&period=30'};
  }

  function confirmTwoFactor({userId,pending,code}) {
    let value;try{value=storage.decodeJson(pending,'totp-pending:'+userId);}catch(_){return {ok:false,status:400,error:'أعد بدء إعداد التحقق الثنائي.'};}
    const step=verifyTotp(value.secret,code);
    if(value.expiresAt<Date.now()||step===null)return {ok:false,status:400,error:'رمز غير صالح أو انتهت مهلة الإعداد.'};
    const recoveryCodes=Array.from({length:8},()=> 'REC-'+crypto.randomBytes(12).toString('base64url'));
    let changed=0;
    db.transaction(()=>{
      changed=db.prepare('UPDATE users SET totp_secret=?,totp_recovery=?,totp_last_step=?,session_version=session_version+1 WHERE id=? AND totp_secret IS NULL')
        .run(storage.encodeJson(value.secret,'totp:'+userId),JSON.stringify(recoveryCodes.map(c=>recoveryHash(userId,c))),step,userId).changes;
      if(changed&&typeof audit==='function')audit(userId,'two_factor_enabled','user',userId,{});
    })();
    syncAudit();
    if(!changed)return {ok:false,status:409,error:'التحقق الثنائي مفعل بالفعل.'};
    revokeSessions(userId);
    return {ok:true,recoveryCodes};
  }

  function disableTwoFactor({userId,password,code}) {
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    if(!user?.totp_secret||typeof password!=='string'||password.length>200||!verifyPassword(password,user.password_hash)||!consumeSecondFactor(user,code))return {ok:false,status:401,error:'كلمة المرور أو رمز التحقق غير صحيح.'};
    db.transaction(()=>{
      db.prepare('UPDATE users SET totp_secret=NULL,totp_recovery=NULL,totp_last_step=-1,session_version=session_version+1 WHERE id=?').run(userId);
      if(typeof audit==='function')audit(userId,'two_factor_disabled','user',userId,{});
    })();
    syncAudit();revokeSessions(userId);
    return {ok:true};
  }

  return {
    ROLES,
    findByUsername,
    findById,
    listUsers,
    authenticate,
    createUser,
    setActive,
    setPermissions,
    beginTwoFactor,
    confirmTwoFactor,
    disableTwoFactor,
    changePassword,
    revokeSessions,
    ensureBootstrapAdmin
  };
}

module.exports = { createAuthService, ROLES };
