#!/usr/bin/env node
"use strict";

// Run only on the trusted update-signing machine. Keep the private key off the repository.
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { validateSyncPackage, signedBytes } = require("../lib/offline-sync");

const [inputPath, outputPath, privateKeyPath] = process.argv.slice(2);
if (!inputPath || !outputPath || !privateKeyPath) {
  console.error(
    "Usage: node scripts/sign-program-update.js <input.json> <output.json> <private-key.pem>",
  );
  process.exit(2);
}
const input = path.resolve(inputPath);
const output = path.resolve(outputPath);
const keyPath = path.resolve(privateKeyPath);
if (input === output) {
  console.error("Input and output must be different files.");
  process.exit(2);
}
const payload = JSON.parse(fs.readFileSync(input, "utf8"));
const validation = validateSyncPackage(payload);
if (!validation.ok) {
  console.error("Refusing to sign invalid package: " + validation.error);
  process.exit(1);
}
const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath, "utf8"));
if (privateKey.asymmetricKeyType !== "ed25519") {
  console.error("The signing key must be an Ed25519 private key.");
  process.exit(1);
}
payload.programUpdate.signature = {
  algorithm: "Ed25519",
  value: crypto
    .sign(null, signedBytes(payload.programUpdate.files), privateKey)
    .toString("base64"),
};
fs.writeFileSync(output, JSON.stringify(payload, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log("Signed program-update files written to: " + output);
console.log(
  "Transfer the signed package and configure the matching trusted public key on the receiving installation.",
);
