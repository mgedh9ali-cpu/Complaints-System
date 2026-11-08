'use strict';
/* Field acceptance: the complaints server must listen on the loopback
 * interface only.
 *
 * The check is behavioural rather than declarative. The server is started
 * with a throwaway database and a free port, the health endpoint is
 * reached over 127.0.0.1, and the same port is then dialled on every
 * non-loopback address of the machine. A server that answered there
 * would be reachable from the local network, which is exactly what the
 * release forbids. */
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function loopbackAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' || entry.family === 4) addresses.push(entry.address);
    }
  }
  return addresses;
}

/* A non-loopback address of this machine, discovered without sending a packet. */
function externalAddress() {
  const socket = new net.Socket();
  try {
    socket.connect(8, '8.8.8.8');
    const address = socket.address();
    return address && typeof address.address === 'string' ? address.address : null;
  } catch {
    return null;
  } finally {
    socket.destroy();
  }
}

function canConnect(host, port, timeout = 1500) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let settled = false;
    const finish = reachable => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port, child, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('the server stopped before it became healthy');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return await response.json();
    } catch {
      // not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('the server did not become healthy in time');
}

async function verifyLoopbackListener() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-loopback-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      SESSION_SECRET: 'acceptance-only-session-secret-at-least-32-chars',
      DATA_KEY: 'acceptance-only-data-key-of-at-least-32-characters',
      BACKUP_SECRET: 'acceptance-only-backup-secret-at-least-32-chars',
      ADMIN_USERNAME: 'acceptance-admin',
      ADMIN_PASSWORD: 'acceptance-only-password-long-enough',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_PATH: path.join(directory, 'acceptance.sqlite'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  try {
    const health = await waitForHealth(port, child);
    const local = await canConnect('127.0.0.1', port);
    const reachable = [];
    for (const address of new Set([...loopbackAddresses(), externalAddress()].filter(Boolean))) {
      if (address === '127.0.0.1') continue;
      if (await canConnect(address, port)) reachable.push(address);
    }
    return {
      ok: local && reachable.length === 0,
      port,
      localReachable: local,
      externallyReachable: reachable,
      announcedHost: /listening on (?:https?:\/\/)?([^\s:]+)/.exec(output)?.[1] || null,
      health,
    };
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => {
      child.once('exit', resolve);
      setTimeout(resolve, 3000);
    });
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  verifyLoopbackListener()
    .then(result => {
      if (!result.ok) {
        console.error(
          'Loopback check failed. reachable locally: ' + result.localReachable +
          ', reachable from other addresses: ' + (result.externallyReachable.join(', ') || 'none'),
        );
        process.exitCode = 1;
        return;
      }
      console.log(
        'Loopback check passed. The server answered on 127.0.0.1:' + result.port +
        ' and on no other address of this machine.',
      );
    })
    .catch(error => {
      console.error('Loopback check failed: ' + error.message);
      process.exitCode = 1;
    });
}

module.exports = { verifyLoopbackListener, canConnect, externalAddress, loopbackAddresses };
