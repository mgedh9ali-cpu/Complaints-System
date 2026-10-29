"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("the shipped app bundle contains the authenticated complaints UI, not split placeholders", () => {
  const root = path.resolve(__dirname, "..");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const part1 = fs.existsSync(path.join(root, "app-part1.js"))
    ? fs.readFileSync(path.join(root, "app-part1.js"), "utf8")
    : "";
  const part2 = fs.existsSync(path.join(root, "app-part2.js"))
    ? fs.readFileSync(path.join(root, "app-part2.js"), "utf8")
    : "";

  assert.ok(app.length > 50000, "app.js must retain the complete application bundle");
  assert.ok(!app.includes("PLACEHOLDER_PART1"), "app.js must not be a placeholder loader");
  assert.ok(!app.includes("PLACEHOLDER_PART2"), "app.js must not be a placeholder loader");
  assert.ok(!part1.includes("PLACEHOLDER_PART1"), "app-part1.js must not contain a placeholder");
  assert.ok(!part2.includes("PLACEHOLDER_PART2"), "app-part2.js must not contain a placeholder");
  assert.ok(app.includes("api('/api/state')"), "the UI must load its state from the authenticated server API");
  assert.ok(app.includes("refreshManagedUsers()"), "the UI must initialize managed-user controls");
  assert.ok(app.includes("function render("), "the application must retain its page renderer");
});
