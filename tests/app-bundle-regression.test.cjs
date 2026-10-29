"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const vm = require("node:vm");
const test = require("node:test");

test("gzip UI chunks assemble into valid JavaScript without eval", () => {
  const root = path.resolve(__dirname, "..");
  const loader = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const parts = [];
  for (let index = 0; index < 5; index += 1) {
    const name = "app-ui-gz-" + index + ".txt";
    const file = path.join(root, name);
    assert.ok(fs.existsSync(file), "missing UI chunk: " + name);
    parts.push(fs.readFileSync(file, "utf8"));
  }
  const compressed = Buffer.from(parts.join("").replace(/\s+/g, ""), "base64");
  const assembled = zlib.gunzipSync(compressed).toString("utf8");
  assert.ok(assembled.length > 1000, "assembled UI too small");
  assert.doesNotThrow(() => new vm.Script(assembled), "assembled UI must be valid JavaScript");
  assert.ok(assembled.includes("api('/api/state')") || assembled.includes('api("/api/state")'), "UI must load state");
  assert.ok(assembled.includes("function render("), "UI must contain render");
  assert.ok(loader.includes("script.src = '/app.bundle.js'"), "loader must request assembled bundle");
  assert.ok(!loader.includes("eval("), "loader must not use eval");
  assert.ok(server.includes("'/app.bundle.js'") || server.includes('"/app.bundle.js"'), "server must expose bundle route");
  assert.ok(server.includes("gunzipSync"), "server must gunzip UI payload");
});
