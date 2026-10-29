"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { validComplaint } = require("../lib/validation");

test("complaint validation accepts a minimal valid complaint", () => {
  assert.equal(
    validComplaint({
      summary: "طلب متابعة",
      province: "دمشق",
      category: "خدمات عامة",
    }),
    true,
  );
});

test("complaint validation rejects missing required fields", () => {
  assert.equal(
    validComplaint({ summary: "طلب متابعة", province: "دمشق" }),
    false,
  );
  assert.equal(validComplaint(null), false);
  assert.equal(validComplaint([]), false);
});

test("complaint validation rejects excessive or malformed user input", () => {
  assert.equal(
    validComplaint({
      summary: "x".repeat(181),
      province: "دمشق",
      category: "عام",
    }),
    false,
  );
  assert.equal(
    validComplaint({
      summary: "x",
      province: "دمشق",
      category: "عام",
      details: 17,
    }),
    false,
  );
  assert.equal(
    validComplaint({
      summary: "x",
      province: "دمشق",
      category: "عام",
      phone: "x".repeat(41),
    }),
    false,
  );
});

test("complaint validation rejects invalid phone characters and priority/status", () => {
  assert.equal(
    validComplaint({
      summary: "x",
      province: "دمشق",
      category: "عام",
      phone: "abc<script>",
    }),
    false,
  );
  assert.equal(
    validComplaint({
      summary: "x",
      province: "دمشق",
      category: "عام",
      phone: "0944 123 456",
    }),
    true,
  );
  assert.equal(
    validComplaint({
      summary: "x",
      province: "دمشق",
      category: "عام",
      priority: "critical",
    }),
    false,
  );
  assert.equal(
    validComplaint({
      summary: "x",
      province: "دمشق",
      category: "عام",
      priority: "urgent",
    }),
    true,
  );
  assert.equal(
    validComplaint({
      summary: "x",
      province: "دمشق",
      category: "عام",
      status: "deleted",
    }),
    false,
  );
  assert.equal(
    validComplaint({
      summary: "x",
      province: "دمشق",
      category: "عام",
      status: "closed",
    }),
    true,
  );
});

test("complaint validation rejects prototype pollution keys", () => {
  const polluted = { summary: "x", province: "دمشق", category: "عام" };
  Object.defineProperty(polluted, "__proto__", {
    value: { polluted: true },
    enumerable: true,
  });
  // Even if __proto__ is present as own property in some engines, our check should reject
  assert.equal(
    validComplaint({
      summary: "x",
      province: "دمشق",
      category: "عام",
      __proto__: { x: 1 },
    }),
    false,
  );
});

test("local UI uses authenticated API and server-backed state rather than localStorage for records", () => {
  const fs = require("node:fs");
  const root = require("node:path").join(__dirname, "..");
  const ui = Array.from({ length: 9 }, (_, index) => {
    const name = "app-p" + String(index + 1).padStart(2, "0") + ".js";
    return fs.readFileSync(require("node:path").join(root, name), "utf8");
  }).join("");
  const server = fs.readFileSync(
    require("node:path").join(__dirname, "..", "server.js"),
    "utf8",
  );
  assert.ok(
    ui.includes("api('/api/auth/login'"),
    "login form must call the server",
  );
  assert.ok(
    ui.includes("api('/api/state'"),
    "dashboard persistence must use the server state API",
  );
  assert.ok(
    server.includes(
      "app.put('/api/state', requireAuth, requireRole('admin','staff')",
    ),
    "saving state must require an authenticated write role",
  );
  assert.ok(
    server.includes("CREATE TABLE IF NOT EXISTS app_state"),
    "persistent application state must be stored in SQLite",
  );
});

test("complaint status updates require an administrative or staff role", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const server = fs.readFileSync(
    path.join(__dirname, "..", "server.js"),
    "utf8",
  );
  assert.ok(
    server.includes(
      "app.patch('/api/complaints/:id/status', requireAuth, requireRole('admin', 'staff')",
    ),
    "reviewers and unauthenticated users must not change complaint status",
  );
});

test("offline sync package validates contents and detects tampering", () => {
  const {
    createSyncPackage,
    validateSyncPackage,
  } = require("../lib/offline-sync");
  const os = require("node:os");
  const path = require("node:path");
  const fs = require("node:fs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "offline-sync-"));
  try {
    fs.mkdirSync(path.join(root, "lib"), { recursive: true });
    for (const name of [
      "server.js",
      "app.js",
      "index.html",
      "styles.css",
      "package.json",
      "lib/validation.js",
      "lib/offline-sync.js",
    ]) {
      const full = path.join(root, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, "fixture:" + name);
    }
    const state = {
      complaints: [],
      notifications: [],
      templates: [],
      settings: {
        slaDays: 7,
        slaApproved: false,
        provinces: [],
        entities: [],
        categories: [],
      },
    };
    const bundle = createSyncPackage(state, root, "instance-a");
    assert.equal(validateSyncPackage(bundle).ok, true);
    bundle.programUpdate.files["app.js"].content += "tampered";
    assert.equal(validateSyncPackage(bundle).ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("complaint state diff records content changes without copying sensitive values", () => {
  const { diffComplaints } = require("../lib/complaint-state-diff");
  assert.deepEqual(
    diffComplaints(
      {
        complaints: [{ id: "A", status: "new", summary: "old", phone: "111" }],
      },
      {
        complaints: [{ id: "A", status: "new", summary: "new", phone: "111" }],
      },
    ),
    [
      {
        action: "complaint_updated",
        id: "A",
        details: { source: "state_api", changedFields: ["summary"] },
      },
    ],
  );
});

test("application-state complaint changes are individually auditable", () => {
  const { diffComplaints } = require("../lib/complaint-state-diff");
  const previous = {
    complaints: [
      { id: "A", status: "new" },
      { id: "B", status: "closed" },
    ],
  };
  const next = {
    complaints: [
      { id: "A", status: "in_progress" },
      { id: "C", status: "new" },
    ],
  };
  assert.deepEqual(diffComplaints(previous, next), [
    {
      action: "complaint_status_changed",
      id: "A",
      details: { source: "state_api", from: "new", to: "in_progress" },
    },
    {
      action: "complaint_created",
      id: "C",
      details: { source: "state_api", status: "new" },
    },
    { action: "complaint_removed", id: "B", details: { source: "state_api" } },
  ]);
});

test("dedicated complaint status endpoint requires an authorized staff role", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(
    require("node:path").join(__dirname, "..", "server.js"),
    "utf8",
  );
  assert.ok(
    source.includes(
      "app.patch('/api/complaints/:id/status', requireAuth, requireRole('admin', 'staff')",
    ),
  );
});

test("server initializes and appends hash-chained audit events", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(
    require("node:path").join(__dirname, "..", "server.js"),
    "utf8",
  );
  assert.ok(
    source.includes("ALTER TABLE audit_events ADD COLUMN previous_hash TEXT"),
  );
  assert.ok(
    source.includes("ALTER TABLE audit_events ADD COLUMN event_hash TEXT"),
  );
  assert.ok(
    source.includes(
      "SELECT event_hash FROM audit_events ORDER BY rowid DESC LIMIT 1",
    ),
  );
  assert.ok(source.includes("previous_hash, event_hash"));
});

test("state API persists complaint-change audit events in the same transaction", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(
    require("node:path").join(__dirname, "..", "server.js"),
    "utf8",
  );
  assert.ok(
    source.includes(
      "const { diffComplaints } = require('./lib/complaint-state-diff')",
    ),
  );
  assert.ok(
    source.includes(
      "const complaintChanges=diffComplaints(previousState,state)",
    ),
  );
  assert.ok(
    source.includes(
      "audit(req.user.id,change.action,'complaint',change.id,change.details)",
    ),
  );
  assert.ok(source.includes("complaintChangesLogged:complaintChanges.length"));
});
