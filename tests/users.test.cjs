"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const hasServerDependencies = [
  "express",
  "helmet",
  "express-session",
  "bcryptjs",
  "better-sqlite3",
  "express-rate-limit",
].every((name) => {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
});

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) =>
    server.listen(0, "127.0.0.1", resolve).once("error", reject),
  );
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(baseUrl, child) {
  for (let i = 0; i < 60; i += 1) {
    if (child.exitCode !== null)
      throw new Error("Test server exited before becoming healthy.");
    try {
      const response = await fetch(baseUrl + "/api/health");
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error("Test server did not become healthy in time.");
}

function cookieFrom(response) {
  const value = response.headers.get("set-cookie");
  assert.ok(value, "login should set a session cookie");
  return value.split(";", 1)[0];
}

async function csrfToken(baseUrl, cookie) {
  const res = await fetch(baseUrl + "/api/csrf", { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.csrfToken);
  return body.csrfToken;
}

test(
  "single-operator installation disables account management and rejects legacy secondary login",
  {
    timeout: 30000,
    skip: hasServerDependencies
      ? false
      : "Server dependencies are not installed in this workflow.",
  },
  async (t) => {
    const root = path.resolve(__dirname, "..");
    const temp = fs.mkdtempSync(
      path.join(os.tmpdir(), "complaints-users-test-"),
    );
    const port = await freePort();
    const child = spawn(process.execPath, ["server.js"], {
      cwd: root,
      env: {
        ...process.env,
        SESSION_SECRET: "test-session-secret-at-least-32-characters",
        ADMIN_USERNAME: "localadmin",
        ADMIN_PASSWORD: "Test-admin-password-2026",
        DATABASE_PATH: path.join(temp, "complaints.sqlite"),
        INSTANCE_ID_PATH: path.join(temp, "instance-id"),
        DATA_DIR: path.join(temp, "data"),
        UPDATE_PUBLIC_KEY_PATH: path.join(temp, "trusted-update-public.pem"),
        PORT: String(port),
        HOST: "127.0.0.1",
      },
      stdio: "ignore",
    });
    t.after(async () => {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await Promise.race([
          new Promise((resolve) => child.once("exit", resolve)),
          delay(2000),
        ]);
      }
      fs.rmSync(temp, { recursive: true, force: true });
    });

    const baseUrl = "http://127.0.0.1:" + port;
    await waitForHealth(baseUrl, child);

    const adminLogin = await fetch(baseUrl + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "localadmin",
        password: "Test-admin-password-2026",
        rememberMe: true,
      }),
    });
    assert.equal(adminLogin.status, 200);
    const rememberCookie = adminLogin.headers.get("set-cookie") || "";
    const rememberExpiry = rememberCookie.match(/Expires=([^;]+)/i);
    assert.ok(rememberExpiry, "remember-me login should issue a persistent session cookie");
    assert.ok(Date.parse(rememberExpiry[1]) - Date.now() > 29 * 24 * 60 * 60 * 1000);
    const shortLogin = await fetch(baseUrl + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "localadmin", password: "Test-admin-password-2026", rememberMe: false }),
    });
    assert.equal(shortLogin.status, 200);
    const shortExpiry = (shortLogin.headers.get("set-cookie") || "").match(/Expires=([^;]+)/i);
    assert.ok(shortExpiry, "ordinary login should issue a short-lived persistent cookie");
    const shortLifetime = Date.parse(shortExpiry[1]) - Date.now();
    assert.ok(shortLifetime > 29 * 60 * 1000 && shortLifetime < 31 * 60 * 1000);
    const adminCookie = cookieFrom(adminLogin);
    const adminCsrf = await csrfToken(baseUrl, adminCookie);
    const adminFetch = (url, options = {}) =>
      fetch(baseUrl + url, {
        ...options,
        headers: {
          cookie: adminCookie,
          "X-CSRF-Token": adminCsrf,
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...(options.headers || {}),
        },
      });

    for(const url of ['/api/users','/api/roles','/api/assignees'])assert.equal((await adminFetch(url)).status,410);
    assert.equal((await adminFetch('/api/users',{method:'POST',body:JSON.stringify({username:'reviewer1',role:'reviewer',password:'Review-password-2026'})})).status,410);
    const Database=require('better-sqlite3'),database=new Database(path.join(temp,'complaints.sqlite'));
    const {hashPassword}=require('../lib/passwords');
    database.prepare('INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES(?,?,?,?,1,?)').run('legacy-person','legacyadmin',hashPassword('Legacy-password-2026'),'admin',new Date().toISOString());
    const secondary=await fetch(baseUrl+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'legacyadmin',password:'Legacy-password-2026'})});
    assert.equal(secondary.status,401);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM users').get().n,2,'historical accounts must not be deleted');
    assert.equal(database.prepare('SELECT user_id FROM single_operator WHERE id=1').get().user_id,(await (await adminFetch('/api/auth/me')).json()).user.id);
    database.close();
    assert.equal((await adminFetch('/api/users/legacy-person/active',{method:'PATCH',body:JSON.stringify({active:true})})).status,410);
  },
);
