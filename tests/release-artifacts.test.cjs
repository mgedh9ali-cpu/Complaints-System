'use strict';
/* The Windows release ships two artifacts: a portable executable that runs
 * without installation and an installer that places the application in a
 * chosen folder. Both are recorded with their checksum, and the publication
 * step must carry exactly the bytes the manifest verified. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { generateManifest } = require('../scripts/release-manifest');
const { publish } = require('../scripts/publish-release');

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const PORTABLE = 'Complaints-System-Portable.exe';
const SETUP = 'Complaints-System-Setup.exe';

function buildDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-artifacts-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, PORTABLE), Buffer.from('synthetic portable executable'));
  fs.writeFileSync(path.join(directory, SETUP), Buffer.from('synthetic installer executable'));
  return directory;
}

test('the manifest records every Windows artifact with its checksum', async t => {
  const directory = buildDirectory(t);
  const commit = 'b'.repeat(40);
  const manifest = await generateManifest(directory, '1.0.0-rc.4', commit);
  assert.equal(manifest.format, 'complaints-windows-release-v2');
  assert.equal(manifest.commit, commit);
  assert.equal(manifest.artifacts.length, 2);
  assert.equal(manifest.filename, PORTABLE, 'the smoke tested portable build stays the primary artifact');
  const portable = manifest.artifacts.find(entry => entry.filename === PORTABLE);
  const setup = manifest.artifacts.find(entry => entry.filename === SETUP);
  assert.equal(portable.sha256, sha(fs.readFileSync(path.join(directory, PORTABLE))));
  assert.equal(setup.sha256, sha(fs.readFileSync(path.join(directory, SETUP))));
  assert.equal(portable.bytes, fs.statSync(path.join(directory, PORTABLE)).size);

  const sums = fs.readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
  assert.equal(sums.length, 2);
  assert.ok(sums.some(line => line.endsWith('  ' + PORTABLE)));
  assert.ok(sums.some(line => line.endsWith('  ' + SETUP)));
  const written = JSON.parse(fs.readFileSync(path.join(directory, 'build-manifest.json'), 'utf8'));
  assert.deepEqual(written.artifacts, manifest.artifacts);
});

test('the manifest refuses to describe a build without an artifact', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-empty-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  await assert.rejects(generateManifest(directory, '1.0.0-rc.4', 'c'.repeat(40)), /No Windows artifact/);
  await assert.rejects(generateManifest(directory, '1.0.0-rc.4', 'not-a-commit'), /immutable source commit/);
});

test('the publication uploads the portable build and the installer together', async t => {
  const directory = buildDirectory(t);
  const version = '1.0.0-rc.4';
  const commit = 'd'.repeat(40);
  await generateManifest(directory, version, commit);

  const repo = 'mgedh9ali-cpu/Complaints-System';
  const api = 'https://api.github.com/repos/' + repo;
  const tag = 'v' + version + '-build.' + commit;
  const uploads = [];
  let release = null;
  const response = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET';
    if (url.includes('/git/ref/tags/')) return response(404, {});
    if (method === 'GET' && url.includes('/releases?')) return response(200, []);
    if (method === 'POST' && url === api + '/releases') {
      const body = JSON.parse(options.body);
      assert.equal(body.tag_name, tag);
      release = {
        id: 9,
        tag_name: tag,
        target_commitish: commit,
        draft: true,
        upload_url: 'https://uploads.github.com/repos/' + repo + '/releases/9/assets{?name,label}',
        html_url: 'https://github.com/' + repo + '/releases/tag/' + tag,
        assets: [],
      };
      return response(201, release);
    }
    if (method === 'GET' && url.includes('/releases/9/assets?')) return response(200, release.assets);
    if (method === 'POST' && url.startsWith('https://uploads.github.com/')) {
      const name = new URL(url).searchParams.get('name');
      uploads.push(name);
      const asset = { id: 200 + uploads.length, name, state: 'uploaded', size: options.body.length, digest: 'sha256:' + sha(options.body) };
      release.assets.push(asset);
      return response(201, asset);
    }
    if (method === 'PATCH' && url === api + '/releases/9') { release.draft = false; return response(200, release); }
    throw new Error('Unexpected API request: ' + method + ' ' + url);
  };

  await publish({
    directory,
    version,
    env: { GITHUB_TOKEN: 'synthetic-token', GITHUB_REPOSITORY: repo, GITHUB_SHA: commit, GITHUB_REF: 'refs/heads/main' },
    fetchImpl,
    log() {},
  });

  assert.ok(uploads.includes(PORTABLE), 'the portable build must be published');
  assert.ok(uploads.includes(SETUP), 'the installer must be published');
  assert.ok(uploads.includes('SHA256SUMS.txt'));
  assert.ok(uploads.includes('build-manifest.json'));
});

test('a tampered installer stops the publication before any network access', async t => {
  const directory = buildDirectory(t);
  const version = '1.0.0-rc.4';
  const commit = 'e'.repeat(40);
  await generateManifest(directory, version, commit);
  fs.writeFileSync(path.join(directory, SETUP), 'tampered installer');
  let calls = 0;
  await assert.rejects(
    publish({
      directory,
      version,
      env: { GITHUB_TOKEN: 'synthetic-token', GITHUB_REPOSITORY: 'mgedh9ali-cpu/Complaints-System', GITHUB_SHA: commit, GITHUB_REF: 'refs/heads/main' },
      fetchImpl: async () => { calls++; throw new Error('the network must not be reached'); },
      log() {},
    }),
    /checksum mismatch/,
  );
  assert.equal(calls, 0, 'a tampered artifact must be rejected before the first request');
});

test('the release configuration builds the portable executable and the installer', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const targets = pkg.build.win.target.map(entry => entry.target);
  assert.ok(targets.includes('portable'), 'the portable build must stay available');
  assert.ok(targets.includes('nsis'), 'the installer must be part of the release');
  for (const entry of pkg.build.win.target) {
    assert.ok(entry.artifactName, entry.target + ' must declare its own artifact name');
    assert.ok(!entry.artifactName.includes('${version}'), 'the artifact name must stay stable across versions');
  }
  assert.equal(pkg.build.nsis.oneClick, false, 'the installer must let the user choose the folder');
  assert.equal(pkg.build.nsis.perMachine, false, 'the installer must not require administrator rights');
  assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(pkg.build.nsis.createStartMenuShortcut, true);
  assert.match(pkg.scripts['dist:win'], /--win/);
  assert.match(pkg.scripts['dist:win:installer'], /nsis/);
});
