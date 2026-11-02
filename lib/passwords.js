'use strict';
const crypto=require('node:crypto');
const bcrypt=require('bcryptjs');
const PREFIX='sha256-bcrypt-v1$';
// The domain-separated fixed-length input avoids bcrypt's 72-byte truncation,
// including long Arabic passwords. Legacy bcrypt hashes continue to verify.
const prepare=password=>crypto.createHash('sha256').update('complaints-password-v1\0'+password,'utf8').digest('base64');
const hashPassword=password=>PREFIX+bcrypt.hashSync(prepare(password),12);
function verifyPassword(password,stored){
 if(typeof password!=='string'||typeof stored!=='string')return false;
 try{return stored.startsWith(PREFIX)?bcrypt.compareSync(prepare(password),stored.slice(PREFIX.length)):bcrypt.compareSync(password,stored);}catch(_){return false;}
}
module.exports={hashPassword,verifyPassword,needsUpgrade:stored=>!stored.startsWith(PREFIX)};
