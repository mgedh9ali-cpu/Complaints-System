'use strict';

const fs = require('node:fs');
const session = require('express-session');
const FileStore = require('session-file-store')(session);

function createSessionMiddleware({ sessionSecret, sessionsDir, cookieSecure }) {
  fs.mkdirSync(sessionsDir, { recursive: true });
  return session({
    name: 'complaints.sid',
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: new FileStore({
      path: sessionsDir,
      ttl: 30 * 60,
      retries: 1,
      logFn: function () {}
    }),
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: Boolean(cookieSecure),
      maxAge: 30 * 60 * 1000
    }
  });
}

module.exports = { createSessionMiddleware };
