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

test(
  "complaint status endpoint persists transitions, requires reasons, and records history",
  {
    timeout: 30000,
    skip: hasServerDependencies
      ? false
      : "Server dependencies are not installed in this workflow.",
  },
  async (t) => {
    const root = path.resolve(__dirname, "..");
    const temp = fs.mkdtempSync(
      path.join(os.tmpdir(), "complaints-status-test-"),
    );
    const port = await freePort();
    const child = spawn(process.execPath, [path.join(root, "server.js")], {
      cwd: temp,
      env: {
        ...process.env,
        SESSION_SECRET: "test-session-secret-at-least-32-characters",
        ADMIN_USERNAME: "localadmin",
        ADMIN_PASSWORD: "Test-admin-password-2026",
        DATABASE_PATH: path.join(temp, "complaints.sqlite"),
        PORT: String(port),
        HOST: "127.0.0.1",
        AUTO_BACKUP_HOURS: "0",
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

    const login = await fetch(baseUrl + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "localadmin",
        password: "Test-admin-password-2026",
      }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie, "login should set a session cookie");

    const csrfResponse = await fetch(baseUrl + "/api/csrf", {
      headers: { cookie },
    });
    assert.equal(csrfResponse.status, 200);
    const { csrfToken } = await csrfResponse.json();
    assert.ok(csrfToken);

    const request = (url, options = {}) =>
      fetch(baseUrl + url, {
        ...options,
        headers: {
          cookie,
          "content-type": "application/json",
          ...(options.method && !["GET", "HEAD"].includes(options.method)
            ? { "X-CSRF-Token": csrfToken }
            : {}),
          ...(options.headers || {}),
        },
      });

    const complaint = {
      id: "SY-2026-TEST001",
      status: "new",
      summary: "اختبار آلي",
      province: "دمشق",
      category: "استفسار عام",
      timeline: [],
      statusHistory: [],
    };
    const initialState = {
      complaints: [complaint],
      notifications: [],
      templates: [],
      settings: { categories: [], entities: [], provinces: [] },
    };
    const saveInitial = await request("/api/state", {
      method: "PUT",
      headers: { "X-State-Revision": "0" },
      body: JSON.stringify(initialState),
    });
    assert.equal(saveInitial.status, 200);

    const illegalState = structuredClone(initialState);
    illegalState.complaints[0].status = "closed";
    const bypassAttempt = await request("/api/state", {
      method: "PUT",
      headers: { "X-State-Revision": "1" },
      body: JSON.stringify(illegalState),
    });
    assert.equal(
      bypassAttempt.status,
      409,
      "full-state saves must not bypass the status state machine",
    );

    const illegalJump = await request(
      "/api/complaints/" + complaint.id + "/status",
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "closed",
          reason: "اختبار انتقال غير مسموح",
        }),
      },
    );
    assert.equal(illegalJump.status, 409);
    assert.equal(
      (await (await request("/api/state")).json()).state.complaints[0].status,
      "new",
    );

    const start = await request("/api/complaints/" + complaint.id + "/status", {
      method: "PATCH",
      body: JSON.stringify({ status: "in_progress" }),
    });
    assert.equal(start.status, 200);
    let savedState = (await (await request("/api/state")).json()).state;
    assert.equal(savedState.complaints[0].status, "in_progress");
    assert.equal(savedState.complaints[0].statusHistory.length, 1);
    assert.equal(savedState.complaints[0].statusHistory[0].from, "new");

    const closeWithoutReason = await request(
      "/api/complaints/" + complaint.id + "/status",
      {
        method: "PATCH",
        body: JSON.stringify({ status: "closed" }),
      },
    );
    assert.equal(closeWithoutReason.status, 400);

    const close = await request("/api/complaints/" + complaint.id + "/status", {
      method: "PATCH",
      body: JSON.stringify({ status: "closed", reason: "اكتملت المعالجة" }),
    });
    assert.equal(close.status, 200);
    savedState = (await (await request("/api/state")).json()).state;
    assert.equal(savedState.complaints[0].status, "closed");
    assert.equal(savedState.complaints[0].statusHistory.length, 2);
    assert.equal(
      savedState.complaints[0].statusHistory[1].reason,
      "اكتملت المعالجة",
    );

    const tableComplaintResponse = await request("/api/complaints", {
      method: "POST",
      body: JSON.stringify({
        summary: "اختبار سجل جدول الشكاوى",
        province: "دمشق",
        category: "استفسار عام",
      }),
    });
    assert.equal(tableComplaintResponse.status, 201);
    const tableComplaint = (await tableComplaintResponse.json()).complaint;
    const tableStart = await request(
      "/api/complaints/" + tableComplaint.id + "/status",
      {
        method: "PATCH",
        body: JSON.stringify({ status: "in_progress" }),
      },
    );
    assert.equal(tableStart.status, 200);
    const tableAwaitingReply = await request(
      "/api/complaints/" + tableComplaint.id + "/status",
      {
        method: "PATCH",
        body: JSON.stringify({ status: "awaiting_reply" }),
      },
    );
    assert.equal(
      tableAwaitingReply.status,
      200,
      "the next transition should read the status saved in the complaints table",
    );

    const auditResponse = await request("/api/audit");
    assert.equal(auditResponse.status, 200);
    const events = (await auditResponse.json()).events;
    assert.ok(
      events.some(
        (event) =>
          event.action === "complaint_status_changed" &&
          event.targetId === complaint.id,
      ),
    );
  },
);
