"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function initializeLocalConfig(
  targetPath = path.resolve(__dirname, "..", ".env"),
  writeOutput = (message) => process.stdout.write(message),
) {
  const absolutePath = path.resolve(targetPath);
  const directory = path.dirname(absolutePath);
  fs.mkdirSync(directory, { recursive: true });

  if (fs.existsSync(absolutePath)) {
    return { created: false, path: absolutePath };
  }

  const sessionSecret = crypto.randomBytes(48).toString("base64url");
  const adminPassword = crypto.randomBytes(18).toString("base64url");
  const contents = [
    "# Generated locally on first launch. Keep this file private; do not commit it.",
    `SESSION_SECRET=${sessionSecret}`,
    "ADMIN_USERNAME=admin",
    `ADMIN_PASSWORD=${adminPassword}`,
    "HOST=127.0.0.1",
    "PORT=3000",
    "DATABASE_PATH=./data/complaints.sqlite",
    "UPDATE_PUBLIC_KEY_PATH=./data/trusted-update-public.pem",
    "",
  ].join("\n");

  let descriptor;
  try {
    descriptor = fs.openSync(absolutePath, "wx", 0o600);
    fs.writeFileSync(descriptor, contents, "utf8");
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {}
    }
    if (error.code === "EEXIST") return { created: false, path: absolutePath };
    throw error;
  }
  fs.closeSync(descriptor);

  writeOutput(
    [
      "",
      "A local .env configuration file was created.",
      "Save these initial administrator credentials now; the password is shown only once:",
      "Username: admin",
      `Password: ${adminPassword}`,
      "",
      "Store the password securely. Do not share or commit the .env file.",
      "",
    ].join("\n"),
  );

  return {
    created: true,
    path: absolutePath,
    adminUsername: "admin",
    adminPassword,
  };
}

if (require.main === module) {
  try {
    const result = initializeLocalConfig();
    if (!result.created) {
      process.stdout.write(
        "A local .env file already exists; it was left unchanged.\n",
      );
    }
  } catch (error) {
    process.stderr.write(
      `ERROR: Could not create local configuration: ${error.message}\n`,
    );
    process.exitCode = 1;
  }
}

module.exports = { initializeLocalConfig };
