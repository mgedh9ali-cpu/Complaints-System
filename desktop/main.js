'use strict';

/**
 * Self-contained desktop shell.
 * Uses Electron's embedded Node to run Express in-process — no system Node.js required.
 * User data (SQLite, sessions, .env) lives under app.getPath('userData').
 */

const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { app, BrowserWindow, dialog, shell, Menu, Tray, nativeImage, Notification } = require('electron');
const { isLocalAppUrl, isPermittedExternalUrl } = require('./navigation');

console.info('[runtime]',{electron:process.versions.electron,chrome:process.versions.chrome});

const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';
const APP_URL = `http://${HOST}:${PORT}`;

let mainWindow = null;
let tray = null;
let serverBooted = false;
let serverRuntime;
let quitting = false;

function appRoot() {
  if (app.isPackaged) {
    return app.getAppPath();
  }
  return path.resolve(__dirname, '..');
}

function ensureUserDataLayout() {
  const applicationBase = app.getPath('userData');
  const options = require('./recovery').readOptions(applicationBase);
  const base = options.activeProfile ? path.join(applicationBase, options.activeProfile) : applicationBase;
  if (options.activeProfile && (!fs.existsSync(path.join(base,'.env')) || !fs.existsSync(path.join(base,'data','complaints.sqlite')))) {
    throw new Error('مجلد البيانات المستعادة غير مكتمل؛ لم تُنشأ قاعدة بديلة.');
  }
  const dataDir = path.join(base, 'data');
  const sessionsDir = path.join(dataDir, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  return {
    base,
    applicationBase,
    options,
    dataDir,
    sessionsDir,
    databasePath: path.join(dataDir, 'complaints.sqlite'),
    instanceIdPath: path.join(dataDir, 'instance-id'),
    envPath: path.join(base, '.env')
  };
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function ensureEnvFile(envPath, root) {
  if (fs.existsSync(envPath)) return;
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
        'البيانات تُحفظ خارج ملف التطبيق ولا تُمسح عند التحديث.';
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
        setTimeout(tryOnce, 250);
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

function bootServerInProcess(paths, root) {
  if (serverBooted) return;
  process.chdir(root.endsWith('.asar') ? path.dirname(root) : root);
  loadEnvFile(paths.envPath);
  if(paths.options.backupDirectory) process.env.BACKUP_DIR=paths.options.backupDirectory;
  process.env.HOST = HOST;
  process.env.PORT = String(PORT);
  process.env.DATABASE_PATH = paths.databasePath;
  process.env.INSTANCE_ID_PATH = paths.instanceIdPath;
  process.env.SESSIONS_DIR = paths.sessionsDir;
  process.env.UPDATE_PUBLIC_KEY_PATH = path.resolve(paths.base, process.env.UPDATE_PUBLIC_KEY_PATH || './data/trusted-update-public.pem');
  process.env.ELECTRON_RUN = '1';
  process.env.COOKIE_SECURE = process.env.COOKIE_SECURE || 'false';

  serverRuntime = require(path.join(root, 'server.js'));
  serverBooted = true;
}

function showTrayNotification(title, body) {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  } catch (_) {}
}

function installTray(root) {
  const iconCandidates = [
    path.join(root, 'build', 'icon.ico'),
    path.join(root, 'build', 'icon.png'),
    path.join(__dirname, 'icon.png')
  ];
  let image = nativeImage.createEmpty();
  for (const candidate of iconCandidates) {
    if (fs.existsSync(candidate)) {
      image = nativeImage.createFromPath(candidate);
      if (!image.isEmpty()) break;
    }
  }
  tray = new Tray(image.isEmpty() ? nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==') : image);
  tray.setToolTip('نظام الشكاوى والاستفسارات');
  const contextMenu = Menu.buildFromTemplate([
    { label: 'إظهار النافذة', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { label: 'إخفاء النافذة', click: () => { mainWindow?.hide(); } },
    { type: 'separator' },
    { label: 'إغلاق التطبيق', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.hide();
    else { mainWindow.show(); mainWindow.focus(); }
  });
}

function createWindow(paths) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'نظام الشكاوى والاستفسارات',
    autoHideMenuBar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  function openTrustedExternal(url) {
    if (isPermittedExternalUrl(url, APP_URL)) {
      shell.openExternal(url).catch(() => {});
    }
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalAppUrl(url, APP_URL)) return { action: 'allow' };
    openTrustedExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isLocalAppUrl(url, APP_URL)) {
      event.preventDefault();
      openTrustedExternal(url);
    }
  });

  mainWindow.loadURL(APP_URL);
  require('./maintenance').installMaintenanceMenu({app,Menu,dialog,shell,window:mainWindow,origin:APP_URL,paths,runtime:serverRuntime});

  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
      showTrayNotification('نظام الشكاوى', 'يعمل في الخلفية. انقر مرتين على الأيقونة لإظهار النافذة.');
    }
  });

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

try { require('./smoke-profile').configureSmokeProfile(app); }
catch(error) {
  require('./smoke-profile').recordSmokeFailure(error);
  if(process.argv.includes('--release-smoke'))app.exit(1);
  else throw error;
}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      const root = appRoot();
      const paths = ensureUserDataLayout();
      ensureEnvFile(paths.envPath, root);
      bootServerInProcess(paths, root);
      await waitForServer();
      installTray(root);
      createWindow(paths);
    } catch (err) {
      if(process.argv.includes('--release-smoke')) {
        require('./smoke-profile').recordSmokeFailure(err);
        app.exit(1);
        return;
      }
      dialog.showErrorBox(
        'تعذر تشغيل التطبيق',
        (err && err.message) || String(err)
      );
      app.quit();
    }
  });

  app.on('before-quit', () => { quitting = true; });

  app.on('window-all-closed', () => {
    if (quitting) app.quit();
  });
}
