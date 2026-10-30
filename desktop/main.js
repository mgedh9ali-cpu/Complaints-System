'use strict';

/**
 * Electron desktop shell for the local complaints system.
 * Spawns the existing Express server (system Node) and opens a native window.
 */

const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, dialog, shell } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';
const APP_URL = `http://${HOST}:${PORT}`;

let serverProcess = null;
let mainWindow = null;

function ensureEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) return;
  try {
    const { initializeLocalConfig } = require(path.join(ROOT, 'scripts', 'initialize-local-config.js'));
    const result = initializeLocalConfig(envPath, (msg) => {
      // Show credentials once in a dialog after window is ready if created
      ensureEnvFile._bootstrapMessage = msg;
    });
    if (result.created && result.adminPassword) {
      ensureEnvFile._bootstrapMessage =
        'تم إنشاء حساب المدير الأول.\n\n' +
        'اسم المستخدم: admin\n' +
        'كلمة المرور: ' +
        result.adminPassword +
        '\n\nاحفظها الآن؛ لن تظهر مرة أخرى.';
    }
  } catch (err) {
    throw new Error('تعذر إنشاء ملف الإعدادات المحلي: ' + err.message);
  }
}

function waitForServer(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = new net.Socket();
      const onFail = () => {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error('الخادم المحلي لم يصبح جاهزاً خلال المهلة.'));
          return;
        }
        setTimeout(tryOnce, 300);
      };
      socket.setTimeout(800);
      socket.once('error', onFail);
      socket.once('timeout', onFail);
      socket.connect(PORT, HOST, () => {
        socket.end();
        resolve();
      });
    };
    tryOnce();
  });
}

function startServer() {
  const nodeBin = process.env.COMPLAINTS_NODE || 'node';
  const args = ['--env-file=.env', 'server.js'];
  serverProcess = spawn(nodeBin, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(PORT),
      ELECTRON_RUN: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  serverProcess.stdout.on('data', (buf) => {
    process.stdout.write(buf);
  });
  serverProcess.stderr.on('data', (buf) => {
    process.stderr.write(buf);
  });
  serverProcess.on('exit', (code, signal) => {
    serverProcess = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        'توقف الخادم المحلي',
        'توقف خادم النظام (رمز ' + String(code ?? signal) + '). سيتم إغلاق النافذة.'
      );
      app.quit();
    }
  });
}

function stopServer() {
  if (!serverProcess) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(serverProcess.pid), '/f', '/t'], {
        windowsHide: true
      });
    } else {
      serverProcess.kill('SIGTERM');
    }
  } catch {
    /* ignore */
  }
  serverProcess = null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'نظام الشكاوى والاستفسارات',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(APP_URL)) {
      return { action: 'allow' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (ensureEnvFile._bootstrapMessage) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'إعداد أول تشغيل',
      message: 'إعداد محلي جديد',
      detail: ensureEnvFile._bootstrapMessage
    });
    ensureEnvFile._bootstrapMessage = null;
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      if (!fs.existsSync(path.join(ROOT, 'node_modules', 'express', 'package.json'))) {
        throw new Error(
          'الحزم غير مثبتة. نفّذ npm install داخل مجلد المشروع ثم أعد المحاولة.'
        );
      }
      ensureEnvFile();
      startServer();
      await waitForServer();
      createWindow();
    } catch (err) {
      dialog.showErrorBox('تعذر تشغيل التطبيق', err.message || String(err));
      stopServer();
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    stopServer();
    app.quit();
  });

  app.on('before-quit', () => {
    stopServer();
  });
}
