"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const vm = require("node:vm");
const test = require("node:test");

test("preferred UI sources assemble into valid JavaScript without eval", () => {
  const root = path.resolve(__dirname, "..");
  const loader = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

  // Prefer full file
  const fullPath = path.join(root, "app.full.js");
  let assembled = null;
  let source = "none";
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, "utf8");
    if (content.length > 10000 && content.includes("'use strict'") && content.includes("STORAGE_KEY")) {
      assembled = content;
      source = "full";
    }
  }

  // Then parts
  if (!assembled) {
    const parts = [];
    for (let i = 1; ; i += 1) {
      const p = path.join(root, `app-p${String(i).padStart(2, "0")}.js`);
      if (!fs.existsSync(p)) break;
      parts.push(fs.readFileSync(p, "utf8"));
    }
    if (parts.length) {
      const joined = parts.join("");
      if (joined.length > 10000) {
        assembled = joined;
        source = "parts";
      }
    }
  }

  // Fallback gz (may be corrupt; not required if full/parts exist)
  if (!assembled) {
    const gzParts = [];
    for (let index = 0; ; index += 1) {
      const file = path.join(root, `app-ui-gz-${index}.txt`);
      if (!fs.existsSync(file)) break;
      gzParts.push(fs.readFileSync(file, "utf8"));
    }
    if (gzParts.length) {
      try {
        const compressed = Buffer.from(gzParts.join("").replace(/\s+/g, ""), "base64");
        assembled = zlib.gunzipSync(compressed).toString("utf8");
        source = "gz";
      } catch (_) {
        // gz is known-corrupt fallback only
      }
    }
  }

  assert.ok(assembled, "no usable UI source (full/parts/gz)");
  assert.ok(assembled.length > 1000, "assembled UI too small");
  assert.doesNotThrow(() => new vm.Script(assembled), "assembled UI must be valid JavaScript");
  assert.ok(assembled.includes("api('/api/state')") || assembled.includes('api("/api/state")') || assembled.includes("STORAGE_KEY"), "UI must load state or contain core keys");
  assert.ok(assembled.includes("function render(") || assembled.includes("render()"), "UI must contain render");
  assert.ok(loader.includes("script.src = '/app.bundle.js'"), "loader must request assembled bundle");
  assert.ok(!loader.includes("eval("), "loader must not use eval");
  assert.ok(server.includes("'/app.bundle.js'") || server.includes('"/app.bundle.js"'), "server must expose bundle route");
  assert.ok(source === "full" || source === "parts" || source === "gz", "source must be one of preferred paths");
  console.log("UI assembled via", source, "length", assembled.length);
});
