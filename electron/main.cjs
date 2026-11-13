const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  Notification,
  nativeImage,
  nativeTheme,
  screen,
  shell,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { SettingsStore } = require('./lib/settings.cjs');
const { registerIpc } = require('./ipc.cjs');

const isMac = process.platform === 'darwin';
let mainWindow = null;
let settings = null;
let tray = null;
let isQuitting = false;
let closeHintShown = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.exit(0);
}

function backgroundColor() {
  const theme = settings?.get().theme || 'system';
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? '#171614' : '#f6f2ea';
}

function usableBounds(bounds) {  if (!bounds || typeof bounds.width !== 'number' || typeof bounds.height !== 'number') return null;
  if (bounds.width < 900 || bounds.height < 600) return null;
  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const horizontal = bounds.x < area.x + area.width - 120 && bounds.x + bounds.width > area.x + 120;
    const vertical = bounds.y < area.y + area.height - 100 && bounds.y + bounds.height > area.y + 60;
    return horizontal && vertical;
  });
  return visible ? bounds : null;
}

function createTray() {
  if (tray) return;
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    try {
      image = nativeImage.createFromBuffer(fs.readFileSync(iconPath));
    } catch {
      image = nativeImage.createEmpty();
    }
  }
  if (image.isEmpty()) {
    console.warn('[tray] icon unavailable:', iconPath);
    return;
  }
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip('知屿');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开知屿', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: '退出知屿',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
  console.log('[tray] created');
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  const saved = usableBounds(settings.get().windowBounds);
  const options = {
    width: saved?.width || 1440,
    height: saved?.height || 900,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    trafficLightPosition: isMac ? { x: 16, y: 15 } : undefined,
    backgroundColor: backgroundColor(),
    autoHideMenuBar: true,
    roundedCorners: true,
    title: '知屿',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  };
  if (saved) {
    options.x = saved.x;
    options.y = saved.y;
  } else {
    options.center = true;
  }
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  if (fs.existsSync(iconPath)) options.icon = iconPath;

  mainWindow = new BrowserWindow(options);
  mainWindow.setMenuBarVisibility(false);
  if (isMac && Menu.getApplicationMenu() === null) {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
      ]),
    );
  } else if (!isMac) {
    Menu.setApplicationMenu(null);
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
  }, 6000);

  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized', false));
  mainWindow.on('close', (event) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getNormalBounds();
    settings.update({ windowBounds: bounds });
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    if (!closeHintShown) {
      closeHintShown = true;
      if (Notification.isSupported()) {
        try {
          new Notification({
            title: '知屿仍在后台运行',
            body: 'AI 整理等任务会继续，点击托盘图标可重新打开。',
            silent: true,
          }).show();
        } catch {
          // notifications may be disabled by the system
        }
      }
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        shell.openExternal(parsed.toString());
      }
    } catch {
      // ignore
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith('file://')) return;
    event.preventDefault();
  });

  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  if (devUrl) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      const key = String(input.key || '').toLowerCase();
      if (key === 'f12' || (input.control && input.shift && key === 'i')) {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

app.on('second-instance', () => {
  showMainWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.whenReady().then(() => {
  app.setAppUserModelId('com.zhiyu.app');
  try {
    const locator = path.join(app.getPath('appData'), 'zhiyu-location.json');
    const located = JSON.parse(fs.readFileSync(locator, 'utf8'));
    if (located?.dataDir && fs.existsSync(located.dataDir)) {
      app.setPath('userData', located.dataDir);
    }
  } catch {
    // keep the default data directory
  }
  settings = new SettingsStore();
  nativeTheme.themeSource = settings.get().theme || 'system';
  registerIpc({ settings, getWindow: () => mainWindow });
  createWindow();
  createTray();

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    } else {
      showMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (isQuitting) app.quit();
});
