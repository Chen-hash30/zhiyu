const { app, BrowserWindow, Menu, nativeTheme, screen, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { SettingsStore } = require('./lib/settings.cjs');
const { registerIpc } = require('./ipc.cjs');

const isMac = process.platform === 'darwin';
let mainWindow = null;
let settings = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.exit(0);
}

function backgroundColor() {
  const theme = settings?.get().theme || 'system';
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? '#171614' : '#f6f2ea';
}

function usableBounds(bounds) {
  if (!bounds || typeof bounds.width !== 'number' || typeof bounds.height !== 'number') return null;
  if (bounds.width < 900 || bounds.height < 600) return null;
  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const horizontal = bounds.x < area.x + area.width - 120 && bounds.x + bounds.width > area.x + 120;
    const vertical = bounds.y < area.y + area.height - 100 && bounds.y + bounds.height > area.y + 60;
    return horizontal && vertical;
  });
  return visible ? bounds : null;
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
  mainWindow.on('close', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const bounds = mainWindow.getNormalBounds();
    settings.update({ windowBounds: bounds });
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
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
