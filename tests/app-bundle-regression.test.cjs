"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

test("split UI segments assemble into valid JavaScript without eval", () => {
  const root = path.resolve(__dirname, "..");
  const loader = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const segments = Array.from({ length: 9 }, (_, index) => {
    const name = "app-p" + String(index + 1).padStart(2, "0") + ".js";
    const file = path.join(root, name);
    assert.ok(fs.existsSync(file), "missing UI segment: " + name);
    const text = fs.readFileSync(file, "utf8");
    assert.ok(text.length > 100, "empty or tiny UI segment: " + name);
    assert.ok(!text.startsWith("PLACEHOLDER"), "placeholder UI segment: " + name);
    return text;
  });

  const assembled = segments.join("");
  assert.doesNotThrow(() => new vm.Script(assembled), "assembled UI must be valid JavaScript");
  assert.ok(assembled.includes("api('/api/state')") || assembled.includes('api("/api/state")'), "UI must load state");
  assert.ok(assembled.includes("function render("), "UI must contain render");
  assert.ok(assembled.includes("refreshManagedUsers") || assembled.includes("showLogin"), "UI must init session UI");
  assert.ok(loader.includes("script.src = '/app.bundle.js'"), "loader must request assembled bundle");
  assert.ok(!loader.includes("eval("), "loader must not use eval");
  assert.ok(server.includes("'/app.bundle.js'") || server.includes('"/app.bundle.js"'), "server must expose bundle route");
  assert.ok(server.includes("app-p"), "server must assemble from app-p segments");
});
