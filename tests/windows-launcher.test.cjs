"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const launcherPath = path.join(root, "start-windows.bat");
const browserHelperPath = path.join(root, "open-local-browser.ps1");
const configGeneratorPath = path.join(
  root,
  "scripts",
  "initialize-local-config.js",
);

test("Windows launcher checks Node.js and initializes configuration locally on first launch", () => {
  assert.equal(fs.existsSync(launcherPath), true, "launcher must be present");
  assert.equal(
    fs.existsSync(configGeneratorPath),
    true,
    "local configuration generator must be present",
  );
  const source = fs.readFileSync(launcherPath, "utf8");

  assert.match(source, /where node/i, "launcher must check for Node.js");
  assert.match(
    source,
    /20\.6/i,
    "launcher must enforce the minimum Node.js version",
  );
  assert.match(
    source,
    /if not exist ["']?\.env/i,
    "launcher must detect missing local configuration",
  );
  assert.match(
    source,
    /scripts\\initialize-local-config\.js/i,
    "launcher must generate local configuration without network access",
  );
  assert.match(
    source,
    /node_modules\\express\\package\.json/i,
    "launcher must check that dependencies are preinstalled",
  );

  const dependencyCheckIndex = source.indexOf(
    "node_modules\\express\\package.json",
  );
  const configGenerationIndex = source.indexOf(
    "scripts\\initialize-local-config.js",
  );
  assert.ok(
    dependencyCheckIndex < configGenerationIndex,
    "launcher must check preinstalled dependencies before generating first-run credentials",
  );
});

test("Windows launcher is offline-safe and runs tests before starting the server", () => {
  const source = fs.readFileSync(launcherPath, "utf8");

  assert.match(source, /will NOT download packages or access the internet/i);
  assert.doesNotMatch(
    source,
    /\bnpm\s+install\b/i,
    "launcher must not install or download dependencies",
  );
  assert.doesNotMatch(
    source,
    /\bcurl\b|\binvoke-webrequest\b|\bstart-bitstransfer\b/i,
    "launcher must not contain common network download commands",
  );

  const testIndex = source.indexOf("call npm test");
  const startIndex = source.indexOf("call npm start");
  const browserHelperIndex = source.indexOf('start "" /b powershell.exe');
  assert.notEqual(testIndex, -1, "launcher must run automated tests");
  assert.notEqual(startIndex, -1, "launcher must start the server");
  assert.ok(
    testIndex < browserHelperIndex && browserHelperIndex < startIndex,
    "browser readiness watcher must start after tests and before the server",
  );
  assert.match(
    source,
    /http:\/\/127\.0\.0\.1:3000/i,
    "launcher must use loopback only",
  );
  assert.match(
    source,
    /Ctrl\+C/i,
    "launcher must document how to stop the server",
  );
});

test("browser helper waits for the local port before opening the browser", () => {
  assert.equal(
    fs.existsSync(browserHelperPath),
    true,
    "browser readiness helper must be present",
  );
  const source = fs.readFileSync(browserHelperPath, "utf8");

  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /3000/);
  assert.match(source, /TcpClient/);
  assert.match(source, /Start-Sleep/);
  assert.match(source, /Start-Process \$url/);
  assert.match(source, /AddSeconds\(60\)/);
  assert.doesNotMatch(
    source,
    /https?:\/\/(?!127\.0\.0\.1)/i,
    "browser helper must not contact external hosts",
  );
});
