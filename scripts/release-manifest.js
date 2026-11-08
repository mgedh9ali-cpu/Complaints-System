'use strict';
// Records every Windows artifact of a build with its checksum.
// The manifest is the source of truth for the release publication: the file
// names come from the build itself, so a renamed artifact can never be
// published under a name that was never verified.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// The portable build is the smoke tested artifact and stays the primary one.
function orderArtifacts(names) {
  return [...names].sort((a, b) => {
    const rank = name => (/portable/i.test(name) ? 0 : /setup|installer/i.test(name) ? 1 : 2);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
}

async function generateManifest(directory, version, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('An immutable source commit is required.');
  const names = fs.existsSync(directory)
    ? orderArtifacts(fs.readdirSync(directory).filter(name => name.endsWith('.exe')))
    : [];
  if (!names.length) throw new Error('No Windows artifact was produced.');
  const artifacts = [];
  for (const filename of names) {
    const file = path.join(directory, filename);
    artifacts.push({
      filename,
      bytes: fs.statSync(file).size,
      sha256: await hashFile(file),
    });
  }
  const [primary] = artifacts;
  const manifest = {
    format: 'complaints-windows-release-v2',
    version,
    commit,
    filename: primary.filename,
    bytes: primary.bytes,
    sha256: primary.sha256,
    platform: 'win32',
    arch: 'x64',
    artifacts,
  };
  fs.writeFileSync(
    path.join(directory, 'SHA256SUMS.txt'),
    artifacts.map(entry => entry.sha256 + '  ' + entry.filename).join('\n') + '\n',
  );
  fs.writeFileSync(path.join(directory, 'build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (require.main === module) {
  generateManifest(path.resolve('dist-desktop'), require('../package.json').version, process.env.GITHUB_SHA)
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { generateManifest, hashFile, orderArtifacts };
