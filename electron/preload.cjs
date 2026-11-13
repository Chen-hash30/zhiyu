const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function call(channel, ...args) {
  const response = await ipcRenderer.invoke(channel, ...args);
  if (response && response.ok) return response.value;
  throw new Error(response?.error || '操作没有完成，请重试');
}

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('zhiyu', {
  isElectron: true,
  app: {
    bootstrap: () => call('app:bootstrap'),
    chooseFolder: () => call('app:chooseFolder'),
    defaultLocation: () => call('app:defaultLocation'),
    revealVault: () => call('app:revealVault'),
    openExternal: (url) => call('app:openExternal', url),
    openFolder: (folderPath) => call('app:openFolder', folderPath),
    version: () => call('app:version'),
    getDataInfo: () => call('app:getDataInfo'),
    setDataDir: (dataDir) => call('app:setDataDir', dataDir),
    relaunch: () => call('app:relaunch'),
  },
  vault: {
    create: (parentPath, name) => call('vault:create', { parentPath, name }),
    open: (targetPath) => call('vault:open', targetPath),
    move: (targetParent) => call('vault:move', targetParent),
    refresh: () => call('vault:refresh'),
  },
  notes: {
    list: () => call('notes:list'),
    read: (notePath) => call('notes:read', notePath),
    save: (notePath, patch) => call('notes:save', notePath, patch),
    create: (input) => call('notes:create', input),
    remove: (notePath) => call('notes:delete', notePath),
    reveal: (notePath) => call('notes:reveal', notePath),
  },
  trash: {
    list: () => call('trash:list'),
    restore: (id) => call('trash:restore', id),
    remove: (id) => call('trash:remove', id),
    empty: () => call('trash:empty'),
    count: () => call('trash:count'),
  },
  chat: {
    list: () => call('chat:list'),
    get: (id) => call('chat:get', id),
    create: (title) => call('chat:create', title),
    select: (id) => call('chat:select', id),
    rename: (id, title) => call('chat:rename', id, title),
    remove: (id) => call('chat:remove', id),
    clear: (id) => call('chat:clear', id),
    compress: (id) => call('chat:compress', id),
  },
  raw: {
    promote: (notePath) => call('raw:promote', notePath),
    importText: (input) => call('raw:importText', input),
    importUrl: (url) => call('raw:importUrl', url),
    importDialog: () => call('raw:importDialog'),
    importPaths: (paths) => call('raw:importPaths', paths),
  },
  ai: {
    organize: (paths) => call('ai:organize', paths),
    cancelOrganize: () => call('ai:cancelOrganize'),
    resolveApproval: (id, approved) => call('ai:resolveApproval', id, approved),
    applyOrganize: (id) => call('ai:applyOrganize', id),
    chat: (messages, requestId, options) =>
      call('ai:chat', { messages, requestId, ...(options || {}) }),
    loadChat: () => call('ai:loadChat'),
    clearChat: () => call('ai:clearChat'),
    testConnection: (input) => call('ai:testConnection', input),
  },
  settings: {
    update: (patch) => call('settings:update', patch),
  },
  mcp: {
    status: () => call('mcp:status'),
    refresh: () => call('mcp:refresh'),
  },
  rag: {
    status: () => call('rag:status'),
    build: () => call('rag:build'),
    cancel: () => call('rag:cancel'),
  },
  git: {
    init: () => call('git:init'),
    snapshot: (message) => call('git:snapshot', message),
    history: () => call('git:history'),
    revert: (hash) => call('git:revert', hash),
  },
  window: {
    minimize: () => call('window:minimize'),
    toggleMaximize: () => call('window:toggleMaximize'),
    close: () => call('window:close'),
    isMaximized: () => call('window:isMaximized'),
    onMaximizedChange: (callback) => subscribe('window:maximized', callback),
  },
  events: {
    onVaultChanged: (callback) => subscribe('vault:changed', callback),
    onOrganizeProgress: (callback) => subscribe('organize:progress', callback),
    onChatDelta: (callback) => subscribe('chat:delta', callback),
    onChatTool: (callback) => subscribe('chat:tool', callback),
    onChatApproval: (callback) => subscribe('chat:approval', callback),
    onAgent: (callback) => subscribe('chat:agent', callback),
    onContext: (callback) => subscribe('chat:context', callback),
    onRagProgress: (callback) => subscribe('rag:progress', callback),
  },
  files: {
    getPath: (file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return '';
      }
    },
  },
});
