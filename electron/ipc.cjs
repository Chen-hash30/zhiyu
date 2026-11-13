const { ipcMain, dialog, shell, BrowserWindow, app, nativeTheme } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Vault } = require('./lib/vault.cjs');
const { AiService } = require('./lib/ai.cjs');
const { RagService } = require('./lib/rag.cjs');
const { McpService } = require('./lib/mcp.cjs');
const {
  estimateContextTokens,
  buildEffectiveMessages,
} = require('./lib/context.cjs');
const git = require('./lib/git.cjs');
const { clipUrl } = require('./lib/webclip.cjs');
const { friendlyError, nowIso, fail, UserError } = require('./lib/util.cjs');

function registerIpc({ settings, getWindow }) {
  let vault = null;
  let ai = null;
  let rag = null;
  let organizeController = null;
  let watcher = null;
  const mcp = new McpService(settings);

  const send = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  };

  const pendingApprovals = new Map();
  const requestApproval = (requestId, payload) =>
    new Promise((resolve) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pendingApprovals.delete(id);
        send('chat:approval', { requestId, id, expired: true });
        resolve(false);
      }, 120000);
      pendingApprovals.set(id, { resolve, timer });
      send('chat:approval', { requestId, id, ...payload });
    });

  const requireVault = () => {
    if (!vault) fail('还没有打开知识库');
    return vault;
  };

  const ensureRag = (current) => {
    if (!rag || rag.vault !== current) {
      rag?.dispose();
      rag = new RagService(current, {
        onProgress: (progress) => send('rag:progress', progress),
      });
    }
    return rag;
  };

  const ensureAi = (current) => {
    if (!ai) ai = new AiService(settings, current, mcp, ensureRag(current));
    return ai;
  };

  const compressSession = async (session, { force = false } = {}) => {
    const current = requireVault();
    const service = ensureAi(current);
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const keepRecent = 6;
    const start = Math.max(0, Number(session.summaryCount) || 0);
    const end = Math.max(0, messages.length - keepRecent);
    if (end <= start) {
      if (force) fail('最近的消息还不够多，暂时不需要压缩。');
      return { changed: false, session };
    }
    const oldMessages = messages.slice(start, end);
    const summary = await service.summarizeContext(session.summary || '', oldMessages);
    const updated = await current.chatSetSummary(session.id, summary, end);
    return { changed: true, session: updated };
  };

  const openVault = async (root, { seed = false } = {}) => {
    if (watcher) {
      await watcher.close().catch(() => {});
      watcher = null;
    }
    if (vault) vault.stopWatching();
    const next = new Vault(root);
    await next.init({ seed });
    vault = next;
    rag?.dispose();
    rag = new RagService(vault, {
      onProgress: (progress) => send('rag:progress', progress),
    });
    ai = new AiService(settings, vault, mcp, rag);
    settings.setVault(vault.root);
    watcher = vault.startWatching((payload) => {
      send('vault:changed', payload);
      void rag?.scheduleUpdate();
    });
    void rag.startAutoBuild(3000).catch((error) => {
      console.warn('[rag] auto build failed:', error.message);
    });
    return vault;
  };

  const recentVaults = () =>
    settings
      .get()
      .recentVaults.filter((item) => {
        try {
          return fs.statSync(item).isDirectory();
        } catch {
          return false;
        }
      });

  const buildState = async () => {
    const notes = vault ? await vault.listNotes() : [];
    const vaultInfo = vault
      ? {
          ...vault.info(),
          stats: await vault.stats(),
        }
      : null;
    const chatList = vault ? await vault.chatList() : { sessions: [], activeId: null };
    const activeChat =
      vault && chatList.activeId ? await vault.chatGet(chatList.activeId) : null;
    return {
      vault: vaultInfo,
      notes,
      settings: settings.publicSettings(),
      recentVaults: recentVaults(),
      git: vault
        ? await git.status(vault.root)
        : { available: await git.isAvailable(), isRepo: false, history: [] },
      chat: activeChat?.messages || [],
      chatSessions: chatList.sessions,
      activeChatId: chatList.activeId,
      trashCount: vault ? await vault.trashCount() : 0,
    };
  };

  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        const value = await fn(event, ...args);
        return { ok: true, value };
      } catch (error) {
        if (!error?.friendly) {
          console.error(`[ipc:${channel}]`, error);
        }
        return { ok: false, error: friendlyError(error) };
      }
    });
  };

  handle('app:bootstrap', async () => {
    let notice = '';
    const configured = settings.get().vaultPath;
    if (configured && !vault) {
      try {
        await openVault(configured, { seed: false });
      } catch {
        notice = '上次打开的知识库没有找到，请重新选择。';
        settings.update({ vaultPath: null });
      }
    }
    return {
      app: {
        name: '知屿',
        version: app.getVersion(),
        platform: process.platform,
      },
      dataDir: app.getPath('userData'),
      ...(await buildState()),
      notice,
    };
  });

  handle('app:chooseFolder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || getWindow();
    const result = await dialog.showOpenDialog(win, {
      title: '选择知识库存放位置',
      defaultPath: app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: '选择',
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
  });

  handle('app:version', async () => app.getVersion());

  handle('app:defaultLocation', async () => app.getPath('documents'));

  handle('app:openFolder', async (_event, folderPath) => {
    const target = path.resolve(String(folderPath || ''));
    const stat = await fsp.stat(target).catch(() => null);
    if (!stat || !stat.isDirectory()) fail('这个文件夹不存在');
    const error = await shell.openPath(target);
    if (error) fail('无法打开这个文件夹');
  });

  handle('app:getDataInfo', async () => ({
    current: app.getPath('userData'),
    defaultDir: path.join(app.getPath('appData'), app.getName()),
  }));

  handle('app:setDataDir', async (_event, dataDir) => {
    const target = path.resolve(String(dataDir || ''));
    const stat = await fsp.stat(target).catch(() => null);
    if (!stat || !stat.isDirectory()) fail('请选择一个已存在的文件夹');
    const current = app.getPath('userData');
    const defaultDir = path.join(app.getPath('appData'), app.getName());
    if (path.resolve(current) === target) {
      return { restartRequired: false, dataDir: current };
    }
    const targetSettings = path.join(target, 'settings.json');
    if (fs.existsSync(targetSettings)) {
      fail('这个目录已经有一份知屿设置，请选择其他空目录');
    }
    const currentSettings = path.join(current, 'settings.json');
    if (fs.existsSync(currentSettings)) {
      await fsp.copyFile(currentSettings, targetSettings);
    }
    const locator = path.join(app.getPath('appData'), 'zhiyu-location.json');
    if (target === path.resolve(defaultDir)) {
      await fsp.unlink(locator).catch(() => {});
    } else {
      await fsp.writeFile(locator, JSON.stringify({ dataDir: target }, null, 2), 'utf8');
    }
    return { restartRequired: true, dataDir: target };
  });

  handle('app:relaunch', async () => {
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 150);
    return true;
  });

  handle('app:openExternal', async (_event, url) => {
    let parsed;
    try {
      parsed = new URL(String(url || ''));
    } catch {
      fail('这个链接无法打开');
    }
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      fail('这个链接无法打开');
    }
    await shell.openExternal(parsed.toString());
  });

  handle('app:revealVault', async () => {
    const current = requireVault();
    const error = await shell.openPath(current.root);
    if (error) fail('无法打开这个文件夹');
  });

  handle('vault:create', async (_event, input = {}) => {
    const parentPath = path.resolve(String(input.parentPath || ''));
    const stat = await fsp.stat(parentPath).catch(() => null);
    if (!stat || !stat.isDirectory()) fail('请选择一个有效的存放位置');
    const name = String(input.name || '').trim();
    if (!name) fail('请给知识库起一个名字');
    if (name === '.' || name === '..' || /[<>:"/\\|?*\u0000-\u001f]/.test(name)) {
      fail('名字里不能包含特殊字符');
    }
    const root = path.join(parentPath, name);
    if (path.dirname(root) !== parentPath) fail('这个存放位置无效');
    const existing = await fsp.stat(root).catch(() => null);
    if (existing) {
      if (!existing.isDirectory()) fail('这个位置已经有同名文件了');
      const entries = await fsp.readdir(root);
      if (entries.length) fail('这个文件夹已经存在并且不是空的，请换一个名字');
    } else {
      await fsp.mkdir(root, { recursive: true });
    }
    await openVault(root, { seed: true });
    await git.init(root).catch(() => false);
    return buildState();
  });

  handle('vault:open', async (event, targetPath) => {
    let target = targetPath;
    if (!target) {
      const win = BrowserWindow.fromWebContents(event.sender) || getWindow();
      const result = await dialog.showOpenDialog(win, {
        title: '选择知识库文件夹',
        properties: ['openDirectory'],
        buttonLabel: '打开',
      });
      if (result.canceled || !result.filePaths.length) return null;
      target = result.filePaths[0];
    }
    const root = path.resolve(String(target));
    const stat = await fsp.stat(root).catch(() => null);
    if (!stat || !stat.isDirectory()) fail('这个知识库文件夹不存在');
    await openVault(root, { seed: true });
    return buildState();
  });

  handle('vault:move', async (_event, targetParent) => {
    const current = requireVault();
    const parent = path.resolve(String(targetParent || ''));
    const parentStat = await fsp.stat(parent).catch(() => null);
    if (!parentStat || !parentStat.isDirectory()) fail('请选择一个有效的目标文件夹');
    const currentRoot = path.resolve(current.root);
    if (parent === currentRoot || parent.startsWith(`${currentRoot}${path.sep}`)) {
      fail('不能把知识库移动到它自己的内部');
    }
    const targetRoot = path.join(parent, path.basename(currentRoot));
    if (fs.existsSync(targetRoot)) fail('目标位置已经有同名文件夹了');
    current.stopWatching();
    try {
      try {
        await fsp.rename(currentRoot, targetRoot);
      } catch (error) {
        if (error.code !== 'EXDEV') throw error;
        try {
          await fsp.cp(currentRoot, targetRoot, {
            recursive: true,
            force: false,
            errorOnExist: true,
          });
        } catch (copyError) {
          await openVault(currentRoot, { seed: false }).catch(() => {});
          throw new UserError('没有完成知识库迁移，原目录保持不变。');
        }
        await fsp.rm(currentRoot, { recursive: true, force: true }).catch(() => {});
      }
    } catch (error) {
      await openVault(currentRoot, { seed: false }).catch(() => {});
      throw error instanceof UserError
        ? error
        : new UserError('没有完成知识库迁移，请检查文件夹权限。');
    }
    await openVault(targetRoot, { seed: false });
    return buildState();
  });

  handle('vault:refresh', async () => buildState());

  handle('notes:list', async () => requireVault().listNotes());

  handle('notes:read', async (_event, relPath) => requireVault().readNote(relPath));

  handle('notes:save', async (_event, relPath, patch = {}) => {
    const current = requireVault();
    const existing = await current.readNote(relPath);
    if (existing.type === 'system') {
      return current.saveSystemFile(relPath, patch.body ?? existing.body);
    }
    return current.saveNote(relPath, patch);
  });

  handle('notes:create', async (_event, input = {}) => {
    const current = requireVault();
    const note = await current.createNote(input);
    await current.rebuildIndex();
    return {
      note,
      notes: await current.listNotes(),
      stats: await current.stats(),
    };
  });

  handle('notes:delete', async (_event, relPath) => {
    const current = requireVault();
    const entry = await current.moveToTrash(relPath);
    return {
      notes: await current.listNotes(),
      stats: await current.stats(),
      trashCount: await current.trashCount(),
      entry,
    };
  });

  handle('notes:reveal', async (_event, relPath) => {
    const current = requireVault();
    const abs = current.resolveForWrite(relPath);
    shell.showItemInFolder(abs);
  });

  handle('trash:list', async () => requireVault().trashList());

  handle('trash:count', async () => requireVault().trashCount());

  handle('trash:restore', async (_event, id) => {
    const current = requireVault();
    const restored = await current.restoreTrash(id);
    return {
      ...restored,
      notes: await current.listNotes(),
      stats: await current.stats(),
    };
  });

  handle('trash:remove', async (_event, id) => {
    const current = requireVault();
    await current.deleteTrash(id);
    return current.trashList();
  });

  handle('trash:empty', async () => {
    const current = requireVault();
    await current.emptyTrash();
    return [];
  });

  handle('raw:promote', async (_event, notePath) => {
    const current = requireVault();
    const result = await current.promoteRaw(String(notePath || ''));
    let gitCommitted = false;
    if (settings.get().gitAutoSnapshot) {
      try {
        gitCommitted = Boolean(
          await git.commit(current.root, `直接入库：${result.title}`),
        );
      } catch (error) {
        console.warn('[promote] snapshot failed:', error.message);
      }
    }
    void rag?.scheduleUpdate(600);
    return {
      ...result,
      gitCommitted,
      git: await git.status(current.root),
    };
  });

  handle('raw:importText', async (_event, input = {}) => {
    const current = requireVault();
    const note = await current.importText({
      title: input.title,
      content: input.content,
      source: input.source,
      tags: input.tags,
    });
    return {
      note,
      notes: await current.listNotes(),
      stats: await current.stats(),
    };
  });

  handle('raw:importUrl', async (_event, url) => {
    const current = requireVault();
    const article = await clipUrl(url);
    const note = await current.importText({
      title: article.title,
      content: article.markdown,
      source: article.url,
      author: article.byline,
      kind: 'web',
      tags: ['网页剪藏'],
    });
    return {
      note,
      notes: await current.listNotes(),
      stats: await current.stats(),
    };
  });

  handle('raw:importDialog', async (event) => {
    const current = requireVault();
    const win = BrowserWindow.fromWebContents(event.sender) || getWindow();
    const result = await dialog.showOpenDialog(win, {
      title: '导入资料',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '支持的文档',
          extensions: ['md', 'markdown', 'txt', 'pdf', 'docx', 'html', 'htm'],
        },
        { name: 'Markdown 或文本', extensions: ['md', 'markdown', 'txt'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'Word 文档', extensions: ['docx'] },
        { name: '网页', extensions: ['html', 'htm'] },
      ],
      buttonLabel: '导入',
    });
    if (result.canceled || !result.filePaths.length) {
      return {
        imported: [],
        failed: [],
        canceled: true,
        notes: await current.listNotes(),
        stats: await current.stats(),
      };
    }
    const outcome = await current.importFiles(result.filePaths);
    return {
      ...outcome,
      canceled: false,
      notes: await current.listNotes(),
      stats: await current.stats(),
    };
  });

  handle('raw:importPaths', async (_event, paths = []) => {
    const current = requireVault();
    const safePaths = (Array.isArray(paths) ? paths : [])
      .filter((item) => typeof item === 'string')
      .slice(0, 50);
    const outcome = await current.importFiles(safePaths);
    return {
      ...outcome,
      canceled: false,
      notes: await current.listNotes(),
      stats: await current.stats(),
    };
  });

  handle('chat:list', async () => requireVault().chatList());

  handle('chat:get', async (_event, id) => requireVault().chatGet(id));

  handle('chat:create', async (_event, title) => {
    const current = requireVault();
    const session = await current.chatCreate(title);
    return session;
  });

  handle('chat:select', async (_event, id) => requireVault().chatSelect(id));

  handle('chat:rename', async (_event, id, title) =>
    requireVault().chatRename(id, title),
  );

  handle('chat:remove', async (_event, id) => requireVault().chatDelete(id));

  handle('chat:clear', async (_event, id) => requireVault().chatClear(id));

  handle('chat:compress', async (_event, id) => {
    const current = requireVault();
    ensureAi(current);
    const session = await current.chatGet(String(id));
    if (!session) fail('这条对话不存在');
    const result = await compressSession(session, { force: true });
    const list = await current.chatList();
    return {
      session: result.session,
      meta: current.chatMeta(result.session),
      sessions: list.sessions,
    };
  });

  handle('ai:organize', async (_event, paths = []) => {
    const current = requireVault();
    ensureAi(current);
    const controller = new AbortController();
    organizeController = controller;
    try {
      return await ai.organize(
        paths,
        (progress) => send('organize:progress', progress),
        { signal: controller.signal },
      );
    } finally {
      if (organizeController === controller) organizeController = null;
    }
  });

  handle('ai:cancelOrganize', async () => {
    organizeController?.abort();
    return { ok: true };
  });

  handle('ai:resolveApproval', async (_event, id, approved) => {
    const item = pendingApprovals.get(String(id));
    if (!item) return { ok: false };
    clearTimeout(item.timer);
    pendingApprovals.delete(String(id));
    item.resolve(Boolean(approved));
    return { ok: true };
  });

  handle('ai:applyOrganize', async (_event, id) => {
    const current = requireVault();
    ensureAi(current);
    const result = await ai.applyOrganize(id);
    void rag?.scheduleUpdate(800);
    return {
      ...result,
      notes: await current.listNotes(),
      stats: await current.stats(),
      git: await git.status(current.root),
    };
  });

  handle('ai:chat', async (_event, input = {}) => {
    const current = requireVault();
    ensureAi(current);
    const requestId = String(input.requestId || crypto.randomUUID());
    const messages = Array.isArray(input.messages) ? input.messages : [];
    let session = input.sessionId ? await current.chatGet(String(input.sessionId)) : null;
    if (!session) {
      session = await current.chatCreate('新对话');
    }
    const aiConfig = settings.get().ai;
    const windowTokens = Math.max(8000, Number(aiConfig.contextWindow) || 128000);
    const autoCompress = aiConfig.autoCompress !== false;
    const estimatedTokens = estimateContextTokens(
      messages,
      session.summary,
      session.summaryCount,
    );
    const canCompress =
      session.messages.length - (Number(session.summaryCount) || 0) > 6;
    if (autoCompress && canCompress && estimatedTokens > windowTokens * 0.8) {
      send('chat:context', { requestId, status: 'compressing' });
      try {
        const compressed = await compressSession(session);
        if (compressed.changed) {
          session = compressed.session;
          send('chat:context', {
            requestId,
            status: 'compressed',
            session: current.chatMeta(session),
          });
        }
      } catch (error) {
        console.warn('[context] auto compress failed:', error.message);
        send('chat:context', {
          requestId,
          status: 'error',
          message: error.message,
        });
      }
    }
    const thinking = input.thinking === true;
    let model;
    if (thinking) {
      const thinkingModel = settings.get().ai.thinkingModel;
      if (!thinkingModel) {
        fail('还没有配置思考模型，请先在设置里填写。');
      }
      model = thinkingModel;
    }
    const effectiveMessages = buildEffectiveMessages(messages, session.summaryCount || 0);
    const result = await ai.chat(
      effectiveMessages,
      (delta) => send('chat:delta', { requestId, delta }),
      undefined,
      {
        model,
        contextSummary: session.summary || '',
        agentId: input.agentId ? String(input.agentId) : undefined,
        notePath: input.notePath ? String(input.notePath) : undefined,
        onTool: (tool) => send('chat:tool', { requestId, ...tool }),
        onAgent: (event) => send('chat:agent', { requestId, ...event }),
        onApproval: (payload) => requestApproval(requestId, payload),
      },
    );
    const stored = messages
      .filter((message) => ['user', 'assistant'].includes(message?.role))
      .map((message) => ({
        id: message.id || crypto.randomUUID(),
        role: message.role,
        content: String(message.content || ''),
        sources: Array.isArray(message.sources) ? message.sources : undefined,
        createdAt: message.createdAt || nowIso(),
      }));
    stored.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: result.content,
      sources: result.sources,
      createdAt: nowIso(),
    });
    const meta = await current.chatSaveMessages(session.id, stored);
    return {
      ...result,
      sessionId: session.id,
      sessionTitle: meta.title,
      session: meta,
    };
  });

  handle('ai:loadChat', async () => requireVault().loadChat());

  handle('ai:clearChat', async () => {
    const current = requireVault();
    const list = await current.chatList();
    if (list.activeId) await current.chatClear(list.activeId);
    return [];
  });

  handle('ai:testConnection', async (_event, input = {}) => {
    ensureAi(requireVault());
    const probe = new AiService(settings, vault, mcp, rag);
    return probe.testConnection({
      preset: input.preset,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.apiKey,
    });
  });

  handle('settings:update', async (_event, input = {}) => {
    const patch = {};
    if (typeof input.theme === 'string' && ['system', 'light', 'dark'].includes(input.theme)) {
      patch.theme = input.theme;
      nativeTheme.themeSource = input.theme;
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        win.setBackgroundColor(
          input.theme === 'dark' || (input.theme === 'system' && nativeTheme.shouldUseDarkColors)
            ? '#171614'
            : '#F6F2EA',
        );
      }
    }
    if (typeof input.gitAutoSnapshot === 'boolean') {
      patch.gitAutoSnapshot = input.gitAutoSnapshot;
    }
    if (typeof input.snapshotDir === 'string') {
      const rawDir = input.snapshotDir.trim();
      if (!rawDir) {
        patch.snapshotDir = '';
      } else {
        const resolved = path.resolve(rawDir);
        if (vault) {
          const vaultRoot = path.resolve(vault.root);
          if (resolved === vaultRoot || resolved.startsWith(`${vaultRoot}${path.sep}`)) {
            fail('快照备份目录不能放在知识库内部');
          }
        }
        const stat = await fsp.stat(resolved).catch(() => null);
        if (stat && !stat.isDirectory()) fail('快照备份路径不是文件夹');
        if (!stat) await fsp.mkdir(resolved, { recursive: true });
        patch.snapshotDir = resolved;
      }
    }
    if (Array.isArray(input.mcpServers)) {
      const servers = [];
      for (const item of input.mcpServers.slice(0, 20)) {
        if (!item || typeof item !== 'object') continue;
        const command = String(item.command || '').trim();
        if (!command) fail('每个 MCP 服务都需要填写启动命令');
        const env = {};
        if (item.env && typeof item.env === 'object') {
          for (const [key, value] of Object.entries(item.env).slice(0, 30)) {
            env[String(key)] = String(value);
          }
        }
        servers.push({
          id: String(item.id || item.name || command).slice(0, 60),
          name: String(item.name || item.id || command).slice(0, 60),
          command,
          args: Array.isArray(item.args) ? item.args.map(String).slice(0, 30) : [],
          env,
          enabled: item.enabled !== false,
        });
      }
      patch.mcpServers = servers;
    }
    if (input.ai && typeof input.ai === 'object') {
      const nextAi = {};
      if (typeof input.ai.preset === 'string') nextAi.preset = input.ai.preset.slice(0, 40);
      if (typeof input.ai.baseUrl === 'string') {
        const baseUrl = input.ai.baseUrl.trim();
        try {
          const parsed = new URL(baseUrl);
          if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
        } catch {
          fail('接口地址需要是完整的 http 或 https 地址');
        }
        nextAi.baseUrl = baseUrl.replace(/\/+$/, '');
      }
      if (typeof input.ai.model === 'string') {
        const model = input.ai.model.trim();
        if (!model) fail('模型名称不能为空');
        nextAi.model = model.slice(0, 80);
      }
      if (typeof input.ai.thinkingModel === 'string') {
        nextAi.thinkingModel = input.ai.thinkingModel.trim().slice(0, 80);
      }
      if (input.ai.contextWindow !== undefined) {
        const windowTokens = Number(input.ai.contextWindow);
        if (!Number.isFinite(windowTokens)) fail('上下文窗口需要是数字');
        nextAi.contextWindow = Math.min(2000000, Math.max(8000, Math.round(windowTokens)));
      }
      if (typeof input.ai.autoCompress === 'boolean') {
        nextAi.autoCompress = input.ai.autoCompress;
      }
      if (typeof input.ai.apiKey === 'string' && input.ai.apiKey.trim()) {
        settings.setKey(input.ai.apiKey.trim());
      }
      if (input.ai.clearKey === true) settings.setKey('');
      patch.ai = nextAi;
    }
    settings.update(patch);
    return settings.publicSettings();
  });

  handle('rag:status', async () => {
    const current = requireVault();
    return ensureRag(current).status();
  });

  handle('rag:build', async () => {
    const current = requireVault();
    return ensureRag(current).build();
  });

  handle('rag:cancel', async () => {
    rag?.cancel();
    return { ok: true };
  });

  handle('git:init', async () => {
    const current = requireVault();
    await git.init(current.root);
    return git.status(current.root);
  });

  handle('mcp:status', async () => mcp.status());

  handle('mcp:refresh', async () => mcp.refresh());

  handle('git:snapshot', async (_event, message) => {
    const current = requireVault();
    await git.commit(current.root, String(message || '').trim() || '手动快照');
    const state = await git.status(current.root);
    let snapshotFile = '';
    let warning = '';
    const snapshotDir = settings.get().snapshotDir;
    if (snapshotDir) {
      try {
        snapshotFile = (await git.bundle(current.root, snapshotDir)) || '';
      } catch (error) {
        warning = error.message || '快照备份文件没有写入';
      }
    }
    return { ...state, snapshotFile, warning };
  });

  handle('git:history', async () => {
    const current = requireVault();
    return git.history(current.root, 30);
  });

  handle('git:revert', async (_event, hash) => {
    const current = requireVault();
    await git.revert(current.root, hash);
    return {
      git: await git.status(current.root),
      notes: await current.listNotes(),
      stats: await current.stats(),
    };
  });

  handle('window:minimize', async (event) => {
    (BrowserWindow.fromWebContents(event.sender) || getWindow())?.minimize();
  });

  handle('window:toggleMaximize', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || getWindow();
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });

  handle('window:close', async (event) => {
    (BrowserWindow.fromWebContents(event.sender) || getWindow())?.close();
  });

  handle('window:isMaximized', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || getWindow();
    return Boolean(win?.isMaximized());
  });

  app.once('before-quit', () => {
    for (const item of pendingApprovals.values()) {
      clearTimeout(item.timer);
      item.resolve(false);
    }
    pendingApprovals.clear();
    mcp.close().catch(() => {});
  });
}

module.exports = { registerIpc };
