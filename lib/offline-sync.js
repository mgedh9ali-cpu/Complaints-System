"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const FORMAT = "complaints-offline-sync";
const ALLOWED = new Set([
  "server.js",
  "app.js",
  "index.html",
  "styles.css",
  "package.json",
  "lib/validation.js",
  "lib/offline-sync.js",
]);
const sha256 = (value) =>
  crypto.createHash("sha256").update(value, "utf8").digest("hex");
function stableJson(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + stableJson(value[key]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}
function signedBytes(files) {
  return Buffer.from(stableJson(files), "utf8");
}
function verifyProgramUpdate(payload, publicKey) {
  try {
    const signature = payload?.programUpdate?.signature;
    if (
      !signature ||
      signature.algorithm !== "Ed25519" ||
      typeof signature.value !== "string"
    )
      return false;
    return crypto.verify(
      null,
      signedBytes(payload.programUpdate.files),
      publicKey,
      Buffer.from(signature.value, "base64"),
    );
  } catch {
    return false;
  }
}
function validState(s) {
  return !!(
    s &&
    typeof s === "object" &&
    !Array.isArray(s) &&
    Array.isArray(s.complaints) &&
    s.complaints.length <= 5000 &&
    Array.isArray(s.notifications) &&
    Array.isArray(s.templates) &&
    s.settings &&
    typeof s.settings === "object" &&
    !Array.isArray(s.settings)
  );
}
function createSyncPackage(state, rootDir, sourceInstanceId) {
  const files = {};
  for (const name of [...ALLOWED].sort()) {
    const fullPath = path.join(rootDir, name);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
    const content = fs.readFileSync(fullPath, "utf8");
    files[name] = { sha256: sha256(content), content };
  }
  return {
    format: FORMAT,
    schemaVersion: 1,
    syncId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    sourceInstanceId,
    state,
    programUpdate: { format: "complaints-program-update", files },
  };
}
function validateSyncPackage(p) {
  if (
    !p ||
    typeof p !== "object" ||
    Array.isArray(p) ||
    p.format !== FORMAT ||
    p.schemaVersion !== 1 ||
    typeof p.syncId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(p.syncId) ||
    !validState(p.state)
  )
    return { ok: false, error: "ملف المزامنة غير صالح أو إصداره غير مدعوم." };
  const u = p.programUpdate;
  if (
    !u ||
    u.format !== "complaints-program-update" ||
    !u.files ||
    typeof u.files !== "object" ||
    Array.isArray(u.files)
  )
    return { ok: false, error: "حزمة تحديث البرنامج مفقودة." };
  const names = Object.keys(u.files);
  if (
    !names.length ||
    names.length > ALLOWED.size ||
    names.some((n) => !ALLOWED.has(n))
  )
    return { ok: false, error: "تحتوي حزمة التحديث على ملفات غير مسموح بها." };
  for (const [name, file] of Object.entries(u.files)) {
    if (
      !file ||
      typeof file.content !== "string" ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      sha256(file.content) !== file.sha256
    )
      return { ok: false, error: "فشل فحص سلامة ملف التحديث: " + name };
  }
  return { ok: true };
}
function stageProgramUpdate(payload, dataDir, publicKey) {
  const validation = validateSyncPackage(payload);
  if (!validation.ok) {
    throw new Error("Program update package is invalid: " + validation.error);
  }
  if (!publicKey || !verifyProgramUpdate(payload, publicKey)) {
    throw new Error(
      "Program update requires a valid trusted Ed25519 signature.",
    );
  }
  const pendingDir = path.join(dataDir, "pending-update", payload.syncId);
  fs.mkdirSync(pendingDir, { recursive: true });
  for (const [name, file] of Object.entries(payload.programUpdate.files)) {
    const destination = path.join(pendingDir, name);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, file.content, {
      encoding: "utf8",
      flag: "wx",
    });
  }
  fs.writeFileSync(
    path.join(pendingDir, "manifest.json"),
    JSON.stringify(
      {
        format: "complaints-pending-update",
        syncId: payload.syncId,
        createdAt: payload.createdAt,
        files: Object.fromEntries(
          Object.entries(payload.programUpdate.files).map(([n, v]) => [
            n,
            v.sha256,
          ]),
        ),
        signatureVerified: true,
        status: "staged-not-applied",
      },
      null,
      2,
    ),
    { encoding: "utf8", flag: "wx" },
  );
  return pendingDir;
}
module.exports = {
  createSyncPackage,
  validateSyncPackage,
  stageProgramUpdate,
  validState,
  verifyProgramUpdate,
  signedBytes,
};
