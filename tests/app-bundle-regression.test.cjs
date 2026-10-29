"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

test("full UI file is valid JavaScript and loader is CSP-safe", () => {
  const root = path.resolve(__dirname, "..");
  const loader = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const fullPath = path.join(root, "app-full.js");
  assert.ok(fs.existsSync(fullPath), "missing app-full.js");
  const text = fs.readFileSync(fullPath, "utf8");
  assert.ok(text.length > 1000, "app-full.js too small");
  assert.ok(!text.startsWith("PLACEHOLDER"), "placeholder UI");
  assert.doesNotThrow(() => new vm.Script(text), "UI must be valid JavaScript");
  assert.ok(text.includes("api('/api/state')"), "UI must load state");
  assert.ok(text.includes("function render("), "UI must contain render");
  assert.ok(text.includes("refreshManagedUsers()"), "UI must init managed users");
  assert.ok(loader.includes("script.src = '/app-full.js'") || loader.includes('script.src = "/app-full.js"'), "loader must request app-full.js");
  assert.ok(!loader.includes("eval("), "loader must not use eval");
});
