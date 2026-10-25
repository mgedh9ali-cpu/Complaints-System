'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createSyncPackage, validateSyncPackage, signedBytes, verifyProgramUpdate } = require('../lib/offline-sync');

test('program updates require a valid trusted Ed25519 signature before they can be staged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'signed-update-'));
  try {
    for (const name of ['server.js', 'app.js', 'index.html', 'styles.css', 'package.json', 'lib/validation.js', 'lib/offline-sync.js']) {
      const file = path.join(root, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'fixture:' + name);
    }
    const state = { complaints: [], notifications: [], templates: [], settings: {} };
    const bundle = createSyncPackage(state, root, 'instance-a');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    assert.equal(validateSyncPackage(bundle).ok, true);
    assert.equal(verifyProgramUpdate(bundle, publicKey), false);

    bundle.programUpdate.signature = {
      algorithm: 'Ed25519',
      value: crypto.sign(null, signedBytes(bundle.programUpdate.files), privateKey).toString('base64')
    };
    assert.equal(verifyProgramUpdate(bundle, publicKey), true);

    bundle.programUpdate.files['app.js'].content += 'tampered';
    bundle.programUpdate.files['app.js'].sha256 = crypto.createHash('sha256')
      .update(bundle.programUpdate.files['app.js'].content, 'utf8').digest('hex');
    assert.equal(validateSyncPackage(bundle).ok, true, 'content hash alone can be recomputed');
    assert.equal(verifyProgramUpdate(bundle, publicKey), false, 'signature must reject changed content');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
