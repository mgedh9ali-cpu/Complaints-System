'use strict';

/**
 * Electron desktop shell — single window app.
 * Application files come from the install/portable package.
 * User data (database, sessions, .env) lives in OS userData so updates never wipe complaints.
 */

const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { app, BrowserWindow, dialog, shell } = require('electron');

const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';
const APP_URL = `http://${HOST}:${PORT}`;

let serverProcess = null;
let mainWindow = null;

function appRoot() {
  if (app.isPackaged) {
    // electron-builder: extraResources / files land next to app.asar or in resources/app
    return path.join(process.resourcesPath, 'app');
  }
  return path.resolve(__dirname, '..');
}

function userDataDir() {
  return app.getPath('userData');
}

function ensureUserDataLayout() {
  const base = userDataDir();
  const dataDir = path.join(base, 'data');
  const sessionsDir = path.join(dataDir, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  return {
    base,
    dataDir,
    sessionsDir,
    databasePath: path.join(dataDir, 'complaints.sqlite'),
    instanceIdPath: path.join(dataDir, 'instance-id'),
    envPath: path.join(base, '.env')
  };
}

function ensureEnvFile(envPath) {
  if (fs.existsSync(envPath)) return;
  const root = appRoot();
  try {
    const { initializeLocalConfig } = require(path.join(root, 'scripts', 'initialize-local-config.js'));
    const result = initializeLocalConfig(envPath, () => {});
    if (result.created && result.adminPassword) {
      ensureEnvFile._bootstrapMessage =
        'تم إنشاء حساب المدير الأول.\n\n' +
        'اسم المستخدم: admin\n' +
        'كلمة المرور: ' +
        result.adminPassword +
        '\n\nاحفظها الآن؛ لن تظهر مرة أخرى.\n\n' +
        'البيانات تُحفظ في مجلد منفصل عن ملف التطبيق فلا تضيع عند التحديث.';
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

function startServer(paths) {
  const root = appRoot();
  const nodeBin = process.env.COMPLAINTS_NODE || 'node';
  const args = ['--env-file=' + paths.envPath, path.join(root, 'server.js')];
  serverProcess = spawn(nodeBin, args, {
    cwd: root,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(PORT),
      ELECTRON_RUN: '1',
      DATABASE_PATH: paths.databasePath,
      INSTANCE_ID_PATH: paths.instanceIdPath,
      // sessions path is resolved in server relative to cwd; override via env if supported later
      COMPLAINTS_USER_DATA: paths.base
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  serverProcess.stdout.on('data', (buf) => process.stdout.write(buf));
  serverProcess.stderr.on('data', (buf) => process.stderr.write(buf));
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
      spawn('taskkill', ['/pid', String(serverProcess.pid), '/f', '/t'], { windowsHide: true });
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
    if (url.startsWith(APP_URL)) return { action: 'allow' };
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
      const root = appRoot();
      const paths = ensureUserDataLayout();
      if (!fs.existsSync(path.join(root, 'node_modules', 'express', 'package.json'))) {
        throw new Error(
          'الحزم غير مثبتة داخل حزمة التطبيق. أعد بناء النسخة المحمولة (npm run dist:win).'
        );
      }
      ensureEnvFile(paths.envPath);
      startServer(paths);
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
