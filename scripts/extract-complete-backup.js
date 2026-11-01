'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { extractEncryptedBundle } = require('../lib/full-backup');

/**
 * Safe restoration helper: extracts and verifies a complete backup to an
 * EMPTY directory. It never replaces the live application's SQLite files.
 *
 * Usage:
 *   node --env-file=.env scripts/extract-complete-backup.js backup.csb new-empty-folder
 */
async function main(argv = process.argv.slice(2)) {
  const [bundlePath, outputDir] = argv;
  if (!bundlePath || !outputDir) {
    throw new Error('Usage: node --env-file=.env scripts/extract-complete-backup.js <backup.csb> <empty-output-dir>');
  }
  const secret = process.env.BACKUP_SECRET || process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('Provide the original BACKUP_SECRET or SESSION_SECRET that encrypted the backup.');
  }
  const destination = path.resolve(outputDir);
  const absoluteBundle = path.resolve(bundlePath);
  if (destination === path.dirname(absoluteBundle) || destination === path.dirname(destination)) {
    throw new Error('Choose a dedicated empty restore directory.');
  }
  if (fs.existsSync(destination) && fs.readdirSync(destination).length > 0) {
    throw new Error('Restore destination is not empty. Existing data will never be overwritten.');
  }
  const result = await extractEncryptedBundle({
    bundlePath: absoluteBundle, secret, outputDir: destination
  });
  process.stdout.write(
    'Verified complete backup extracted. Files: ' + result.files +
    ', attachments: ' + result.attachmentCount +
    '\nDestination: ' + destination +
    '\nStop the application before any manually approved migration of these files.\n'
  );
  return result;
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write('Complete backup restore verification failed: ' + error.message + '\n');
    process.exitCode = 1;
  });
}

module.exports = { main };
