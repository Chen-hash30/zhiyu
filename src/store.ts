import { create } from 'zustand';
import { api, errorMessage } from './lib/api';
import { localNowIso } from './lib/format';
import type {
  AppState,
  AgentStep,
  ApplyResult,
  Bootstrap,
  ChatMessage,
  ChatNoteRef,
  ChatSession,
  ChatSessionMeta,
  CreateNoteResult,
  GitState,
  ImportOutcome,
  NoteDetail,
  NoteMeta,
  OrganizePreview,
  Page,
  PublicSettings,
  RagProgress,
  RagStatus,
  SettingsPatch,
  Stats,
  TrashEntry,
  VaultInfo,
} from './types';

const PAGES: Page[] = ['home', 'inbox', 'library', 'chat', 'graph', 'trash', 'settings'];

type ToastKind = 'success' | 'error' | 'info';

export type GlobalModal = 'new-note' | 'import-url' | 'import-text' | 'rules' | null;

interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
  actionLabel?: string;
  action?: () => void;
}

interface AiProgress {
  current: number;
  total: number;
  title: string;
}

interface AppStore {
  ready: boolean;
  boot: Bootstrap | null;
  vault: VaultInfo | null;
  notes: NoteMeta[];
  stats: Stats;
  settings: PublicSettings | null;
  recentVaults: string[];
  git: GitState | null;
  chat: ChatMessage[];
  chatSessions: ChatSessionMeta[];
  activeChatId: string | null;
  trashEntries: TrashEntry[];
  trashCount: number;
  thinking: boolean;
  chatToolStatus: string;
  agentTrace: AgentStep[];
  agentThinking: string;
  page: Page;
  activePath: string | null;
  note: NoteDetail | null;
  noteLoading: boolean;
  editing: boolean;
  paletteOpen: boolean;
  modal: GlobalModal;
  chatDraft: string;
  toasts: ToastItem[];
  aiBusy: boolean;
  aiProgress: AiProgress | null;
  chatStreaming: boolean;
  chatStreamText: string;
  chatNote: ChatNoteRef | null;
  chatRequestId: string | null;
  contextCompressing: boolean;
  ragStatus: RagStatus | null;
  ragProgress: RagProgress | null;

  init: () => Promise<void>;
  bindEvents: () => () => void;
  syncRoute: () => void;
  navigate: (page: Page, notePath?: string | null) => void;
  selectNote: (path: string) => void;
  openNote: (path: string) => Promise<void>;
  refreshNotes: () => Promise<void>;
  setEditor: (editing: boolean) => void;
  saveNote: (patch: {
    title?: string;
    body?: string;
    tags?: string[];
  }, pathOverride?: string) => Promise<NoteDetail | null>;
  createNote: (input: { type: string; title: string; body?: string }) => Promise<NoteDetail | null>;
  deleteNote: (path: string) => Promise<void>;
  setTheme: (theme: PublicSettings['theme']) => Promise<void>;
  updateSettings: (patch: SettingsPatch) => Promise<PublicSettings | null>;
  toast: (
    kind: ToastKind,
    title: string,
    description?: string,
    action?: { label: string; run: () => void },
  ) => string;
  dismissToast: (id: string) => void;
  setPalette: (open: boolean) => void;
  setModal: (modal: GlobalModal) => void;
  setChatDraft: (text: string) => void;
  createVault: (parentPath: string, name: string) => Promise<boolean>;
  openVault: (path?: string) => Promise<boolean>;
  moveVault: (targetParent: string) => Promise<boolean>;
  setDataDir: (dataDir: string) => Promise<void>;
  relaunchApp: () => Promise<void>;
  importDialog: () => Promise<ImportOutcome | null>;
  importUrl: (url: string) => Promise<NoteDetail | null>;
  importText: (input: {
    title: string;
    content: string;
    source?: string;
    tags?: string[];
  }) => Promise<NoteDetail | null>;
  promoteRaw: (notePath: string) => Promise<void>;
  organize: (paths: string[]) => Promise<OrganizePreview | null>;
  cancelOrganize: () => Promise<void>;
  applyOrganize: (id: string) => Promise<ApplyResult | null>;
  sendChat: (text: string) => Promise<void>;
  newChat: () => Promise<void>;
  selectChat: (id: string) => Promise<void>;
  renameChat: (id: string, title: string) => Promise<void>;
  deleteChat: (id: string) => Promise<void>;
  clearChat: () => Promise<void>;
  compressChat: () => Promise<void>;
  setThinking: (value: boolean) => void;
  setChatNote: (note: ChatNoteRef | null) => void;
  loadRagStatus: () => Promise<void>;
  buildRag: () => Promise<void>;
  cancelRag: () => Promise<void>;
  loadTrash: () => Promise<void>;
  restoreTrash: (id: string) => Promise<void>;
  deleteTrashPermanently: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
}

function toMeta(note: NoteDetail): NoteMeta {
  const { body, data, ...meta } = note;
  return meta;
}

const LARGE_NOTE_BYTES = 1_000_000;

function isLargeNote(note?: { truncated?: boolean; size?: number } | null) {
  return Boolean(note?.truncated) || (note?.size || 0) > LARGE_NOTE_BYTES;
}

function toChatMeta(session: ChatSession): ChatSessionMeta {
  const last = [...session.messages].reverse().find((message) => message.content);
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
    preview: last ? String(last.content).slice(0, 80) : '',
    summary: session.summary || '',
    summaryCount: session.summaryCount || 0,
  };
}

export function computeStats(notes: NoteMeta[]): Stats {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return {
    inbox: notes.filter((note) => note.type === 'raw' && note.status !== 'processed').length,
    total: notes.filter((note) => note.type !== 'raw').length,
    raw: notes.filter((note) => note.type === 'raw').length,
    week: notes.filter(
      (note) => note.type !== 'raw' && new Date(note.updated).getTime() >= weekAgo,
    ).length,
  };
}

function parseRoute(): { page: Page; note: string | null } {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [pagePart, queryPart] = raw.split('?');
  const page = (PAGES.includes(pagePart as Page) ? pagePart : 'home') as Page;
  const params = new URLSearchParams(queryPart || '');
  return { page, note: params.get('note') || null };
}

function buildHash(page: Page, notePath?: string | null) {
  return `#/${page}${notePath ? `?note=${encodeURIComponent(notePath)}` : ''}`;
}

function effectiveTheme(theme: PublicSettings['theme']) {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

function applyDomTheme(theme: PublicSettings['theme']) {
  document.documentElement.dataset.theme = effectiveTheme(theme);
}

function stateFields(state: AppState) {
  return {
    vault: state.vault,
    notes: state.notes,
    stats: computeStats(state.notes),
    settings: state.settings,
    recentVaults: state.recentVaults,
    git: state.git,
    chat: state.chat,
    chatSessions: state.chatSessions,
    activeChatId: state.activeChatId,
    trashCount: state.trashCount,
  };
}

let initPromise: Promise<void> | null = null;
let unsubscribers: (() => void)[] = [];
let watcherTimer: number | null = null;
let noteRequestToken = 0;

export const useAppStore = create<AppStore>((set, get) => ({
  ready: false,
  boot: null,
  vault: null,
  notes: [],
  stats: { inbox: 0, total: 0, raw: 0, week: 0 },
  settings: null,
  recentVaults: [],
  git: null,
  chat: [],
  chatSessions: [],
  activeChatId: null,
  trashEntries: [],
  trashCount: 0,
  thinking: false,
  chatToolStatus: '',
  agentTrace: [],
  agentThinking: '',
  page: 'home',
  activePath: null,
  note: null,
  noteLoading: false,
  editing: false,
  paletteOpen: false,
  modal: null,
  chatDraft: '',
  toasts: [],
  aiBusy: false,
  aiProgress: null,
  chatStreaming: false,
  chatStreamText: '',
  chatNote: null,
  chatRequestId: null,
  contextCompressing: false,
  ragStatus: null,
  ragProgress: null,

  init: async () => {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        const boot = await api.app.bootstrap();
        const route = parseRoute();
        set({
          boot,
          ...stateFields(boot),
          ready: true,
          page: route.page,
          activePath: route.note,
          note: null,
          editing: false,
          chatToolStatus: '',
        });
        applyDomTheme(boot.settings.theme);
        if (boot.notice) get().toast('error', boot.notice);
        if (boot.vault) void get().loadRagStatus();
        if (boot.vault && route.note) {
          await get().openNote(route.note);
        }
      } catch (error) {
        set({ ready: true });
        get().toast('error', '应用没有启动成功', errorMessage(error));
        initPromise = null;
      }
    })();
    return initPromise;
  },

  bindEvents: () => {
    if (unsubscribers.length) return () => {};
    const offVault = api.events.onVaultChanged(() => {
      if (watcherTimer) window.clearTimeout(watcherTimer);
      watcherTimer = window.setTimeout(() => {
        void get().refreshNotes();
      }, 320);
    });
    const offOrganize = api.events.onOrganizeProgress((progress) => {
      set({ aiProgress: progress });
    });
    const offChat = api.events.onChatDelta((payload) => {
      if (payload.requestId !== get().chatRequestId) return;
      set((state) => ({ chatStreamText: state.chatStreamText + payload.delta }));
    });
    const offTool = api.events.onChatTool((payload) => {
      if (payload.requestId !== get().chatRequestId) return;
      set({
        chatToolStatus:
          payload.status === 'done' ? `${payload.label} · 已完成` : `${payload.label}…`,
      });
    });
    const offAgent = api.events.onAgent((payload) => {
      if (payload.requestId && payload.requestId !== get().chatRequestId) return;
      if (payload.type === 'thinking-delta') {
        set((state) => ({
          agentThinking: `${state.agentThinking}${payload.delta || ''}`.slice(-20000),
        }));
        return;
      }
      if (payload.type === 'thinking' && payload.content) {
        set((state) => {
          const addition = String(payload.content).trim();
          const next = state.agentThinking
            ? `${state.agentThinking}\n\n${addition}`
            : addition;
          return { agentThinking: next.slice(-20000) };
        });
        return;
      }
      if (payload.type === 'tool') {
        const step: AgentStep = {
          id: payload.id || crypto.randomUUID(),
          type: 'tool',
          label: payload.label,
          tool: payload.tool,
          status: payload.status || 'running',
          detail: payload.detail,
          args: payload.args,
        };
        set((state) => {
          const exists = state.agentTrace.some((item) => item.id === step.id);
          const agentTrace = exists
            ? state.agentTrace.map((item) => (item.id === step.id ? { ...item, ...step } : item))
            : [...state.agentTrace.slice(-30), step];
          return { agentTrace };
        });
      }
    });
    const offContext = api.events.onContext((payload) => {
      if (payload.requestId && payload.requestId !== get().chatRequestId) return;
      if (payload.status === 'compressing') {
        set({ contextCompressing: true });
        return;
      }
      if (payload.status === 'compressed') {
        set((state) => ({
          contextCompressing: false,
          chatSessions: payload.session
            ? [
                payload.session,
                ...state.chatSessions.filter((item) => item.id !== payload.session?.id),
              ]
            : state.chatSessions,
        }));
        get().toast('success', '上下文已自动压缩', '已改用摘要和最近消息继续对话。');
        return;
      }
      if (payload.status === 'error') {
        set({ contextCompressing: false });
        get().toast('error', '上下文压缩失败', payload.message);
      }
    });
    const offRag = api.events.onRagProgress((progress) => {
      set({ ragProgress: progress });
      if (progress.phase === 'done' || progress.phase === 'error') {
        void get().loadRagStatus();
      }
    });
    unsubscribers = [
      offVault,
      offOrganize,
      offChat,
      offTool,
      offAgent,
      offContext,
      offRag,
    ];
    return () => {
      unsubscribers.forEach((off) => off());
      unsubscribers = [];
      if (watcherTimer) {
        window.clearTimeout(watcherTimer);
        watcherTimer = null;
      }
    };
  },

  syncRoute: () => {
    const route = parseRoute();
    const current = get();
    if (route.page === current.page && route.note === current.activePath) return;
    set({ page: route.page, editing: false });
    if (route.note) {
      void get().openNote(route.note);
    } else {
      set({ activePath: null, note: null });
    }
  },

  navigate: (page, notePath) => {
    const target = notePath || null;
    const current = get();
    set({
      page,
      editing: false,
      activePath: target,
      note: target && current.note?.path === target ? current.note : null,
      paletteOpen: false,
      modal: null,
    });
    const hash = buildHash(page, target);
    if (window.location.hash !== hash) {
      window.history.pushState(null, '', hash);
    }
    if (target) void get().openNote(target);
  },

  selectNote: (path) => {
    set({ activePath: path, editing: false });
    window.history.replaceState(null, '', buildHash(get().page, path));
    void get().openNote(path);
  },

  openNote: async (path) => {
    const token = ++noteRequestToken;
    set({ noteLoading: true, activePath: path, editing: false });
    try {
      const note = await api.notes.read(path);
      if (token !== noteRequestToken) return;
      set({ note, noteLoading: false });
    } catch (error) {
      if (token !== noteRequestToken) return;
      set({ note: null, noteLoading: false });
      get().toast('error', '无法打开这条笔记', errorMessage(error));
    }
  },

  refreshNotes: async () => {
    if (!get().vault) return;
    try {
      const notes = await api.notes.list();
      const current = get();
      let note = current.note;
      const meta = current.activePath
        ? notes.find((item) => item.path === current.activePath)
        : null;
      if (
        current.activePath &&
        current.note &&
        current.note.type !== 'system' &&
        !meta &&
        !current.editing
      ) {
        note = null;
        set({ activePath: null });
      }
      if (meta && current.note && !current.editing && meta.updated !== current.note.updated) {
        try {
          const fresh = await api.notes.read(current.activePath!);
          if (get().activePath === current.activePath && !get().editing) note = fresh;
        } catch {
          // keep the current note
        }
      }
      set({ notes, stats: computeStats(notes), note });
    } catch {
      // file watcher refresh should stay quiet
    }
  },

  setEditor: (editing) => set({ editing }),

  saveNote: async (patch, pathOverride) => {
    const note = get().note;
    const targetPath = pathOverride || note?.path;
    if (!targetPath) return null;
    try {
      const saved = await api.notes.save(targetPath, patch);
      const meta = toMeta(saved);
      set((state) => {
        const notes = state.notes.map((item) => (item.path === saved.path ? meta : item));
        return {
          note: state.note?.path === saved.path ? saved : state.note,
          notes,
          stats: computeStats(notes),
        };
      });
      return saved;
    } catch (error) {
      get().toast('error', '没有保存成功', errorMessage(error));
      throw error;
    }
  },

  createNote: async (input) => {
    try {
      const result: CreateNoteResult = await api.notes.create(input);
      set({ notes: result.notes, stats: computeStats(result.notes) });
      const hash = buildHash('library', result.note.path);
      window.history.pushState(null, '', hash);
      set({
        page: 'library',
        activePath: result.note.path,
        note: result.note,
        editing: true,
        paletteOpen: false,
      });
      return result.note;
    } catch (error) {
      get().toast('error', '没能创建笔记', errorMessage(error));
      return null;
    }
  },

  deleteNote: async (path) => {
    try {
      const result = await api.notes.remove(path);
      set({
        notes: result.notes,
        stats: computeStats(result.notes),
        trashCount: result.trashCount ?? get().trashCount + 1,
      });
      if (get().activePath === path) {
        set({ activePath: null, note: null, editing: false });
        window.history.replaceState(null, '', buildHash(get().page));
      }
      get().toast('success', '已移到回收站', '可以在侧边栏「回收站」里恢复。');
    } catch (error) {
      get().toast('error', '没有删除成功', errorMessage(error));
    }
  },

  setTheme: async (theme) => {
    const current = get().settings;
    if (!current) return;
    set({ settings: { ...current, theme } });
    applyDomTheme(theme);
    try {
      const next = await api.settings.update({ theme });
      set({ settings: next });
      applyDomTheme(next.theme);
    } catch (error) {
      set({ settings: current });
      applyDomTheme(current.theme);
      get().toast('error', '主题没有保存', errorMessage(error));
    }
  },

  updateSettings: async (patch) => {
    try {
      const next = await api.settings.update(patch);
      set({ settings: next });
      applyDomTheme(next.theme);
      return next;
    } catch (error) {
      get().toast('error', '设置没有保存', errorMessage(error));
      return null;
    }
  },

  toast: (kind, title, description, action) => {
    const id = crypto.randomUUID();
    set((state) => ({
      toasts: [
        ...state.toasts.slice(-3),
        {
          id,
          kind,
          title,
          description,
          actionLabel: action?.label,
          action: action?.run,
        },
      ],
    }));
    window.setTimeout(() => {
      get().dismissToast(id);
    }, action ? 8000 : 4200);
    return id;
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  setPalette: (open) => set({ paletteOpen: open }),

  setModal: (modal) => set({ modal }),

  setChatDraft: (text) => set({ chatDraft: text }),

  createVault: async (parentPath, name) => {
    try {
      const state = await api.vault.create(parentPath, name);
      const boot = get().boot;
      set({
        ...stateFields(state),
        boot: boot ? { ...boot, ...state } : null,
        page: 'home',
        activePath: null,
        note: null,
        editing: false,
        paletteOpen: false,
      });
      window.history.replaceState(null, '', buildHash('home'));
      applyDomTheme(state.settings.theme);
      get().toast('success', '知识库已创建', '把第一份资料放进收件箱吧。');
      return true;
    } catch (error) {
      get().toast('error', '没能创建知识库', errorMessage(error));
      return false;
    }
  },

  openVault: async (path) => {
    try {
      const state = await api.vault.open(path);
      if (!state) return false;
      const boot = get().boot;
      set({
        ...stateFields(state),
        boot: boot ? { ...boot, ...state } : null,
        page: 'home',
        activePath: null,
        note: null,
        editing: false,
        paletteOpen: false,
      });
      window.history.replaceState(null, '', buildHash('home'));
      applyDomTheme(state.settings.theme);
      set({ ragStatus: null, ragProgress: null });
      void get().loadRagStatus();
      return true;
    } catch (error) {
      get().toast('error', '没能打开知识库', errorMessage(error));
      return false;
    }
  },

  importDialog: async () => {
    try {
      const outcome = await api.raw.importDialog();
      if (outcome.canceled) return outcome;
      set({ notes: outcome.notes, stats: computeStats(outcome.notes) });
      if (outcome.imported.length) {
        const first = outcome.imported[0];
        const large = isLargeNote(first);
        get().toast(
          'success',
          outcome.imported.length === 1 ? '资料已收进收件箱' : `已导入 ${outcome.imported.length} 份资料`,
          large ? '文件较大，已保存；未自动打开，点击列表可预览前 12 万字符。' : undefined,
        );
        get().navigate('inbox', large ? null : first.path);
      }
      if (outcome.failed.length) {
        get().toast(
          'error',
          `${outcome.failed.length} 份资料没有导入`,
          outcome.failed[0]?.message || '请检查文件格式',
        );
      }
      return outcome;
    } catch (error) {
      get().toast('error', '没能导入资料', errorMessage(error));
      return null;
    }
  },

  importUrl: async (url) => {
    try {
      const result = await api.raw.importUrl(url);
      set({ notes: result.notes, stats: computeStats(result.notes) });
      const large = isLargeNote(result.note);
      get().toast(
        'success',
        '网页已收进收件箱',
        large ? '内容较大，已保存；点击列表可预览前 12 万字符。' : undefined,
      );
      get().navigate('inbox', large ? null : result.note.path);
      return result.note;
    } catch (error) {
      get().toast('error', '没能读取这个网页', errorMessage(error));
      return null;
    }
  },

  importText: async (input) => {
    try {
      const result = await api.raw.importText(input);
      set({ notes: result.notes, stats: computeStats(result.notes) });
      const large = isLargeNote(result.note);
      get().toast(
        'success',
        '资料已收进收件箱',
        large ? '内容较大，已保存；点击列表可预览前 12 万字符。' : undefined,
      );
      get().navigate('inbox', large ? null : result.note.path);
      return result.note;
    } catch (error) {
      get().toast('error', '没能保存这份资料', errorMessage(error));
      return null;
    }
  },

  promoteRaw: async (notePath) => {
    try {
      const result = await api.raw.promote(notePath);
      set({
        notes: result.notes,
        stats: computeStats(result.notes),
        git: result.git,
      });
      get().toast(
        'success',
        result.created ? '已直接入库' : '这份资料已经在知识库里',
        result.created ? '没有调用 AI，原文已保存为来源条目。' : undefined,
      );
      get().navigate('library', result.path);
    } catch (error) {
      get().toast('error', '没能直接入库', errorMessage(error));
    }
  },

  organize: async (paths) => {
    if (!paths.length) return null;
    set({
      aiBusy: true,
      aiProgress: { current: 0, total: paths.length, title: '正在阅读资料' },
    });
    try {
      const preview = await api.ai.organize(paths);
      set({ aiBusy: false, aiProgress: null });
      return preview;
    } catch (error) {
      set({ aiBusy: false, aiProgress: null });
      const message = errorMessage(error);
      if (message.includes('取消')) {
        get().toast('info', '已停止整理');
      } else {
        get().toast('error', '这次没有整理成功', message);
      }
      return null;
    }
  },

  cancelOrganize: async () => {
    try {
      await api.ai.cancelOrganize();
    } catch {
      // 整理已经结束时取消是空操作
    }
  },

  applyOrganize: async (id) => {
    set({ aiBusy: true });
    try {
      const result = await api.ai.applyOrganize(id);
      set({
        notes: result.notes,
        stats: computeStats(result.notes),
        git: result.git,
        aiBusy: false,
      });
      get().toast(
        'success',
        `已写入 ${result.written.length} 个条目`,
        result.snapshotFile
          ? '同时写入了版本快照和快照备份。'
          : result.gitCommitted
            ? '同时留下了一个版本快照。'
            : undefined,
      );
      if (result.warning) get().toast('info', result.warning);
      if (result.written[0]) {
        get().navigate('library', result.written[0]);
      }
      return result;
    } catch (error) {
      set({ aiBusy: false });
      get().toast('error', '没有写入知识库', errorMessage(error));
      return null;
    }
  },

  sendChat: async (text) => {
    const content = text.trim();
    if (!content || get().chatStreaming) return;
    try {
      let sessionId = get().activeChatId;
      if (!sessionId) {
        const session = await api.chat.create();
        sessionId = session.id;
        set((state) => ({
          activeChatId: session.id,
          chat: [],
          chatSessions: [toChatMeta(session), ...state.chatSessions],
        }));
      }
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        createdAt: localNowIso(),
      };
      const history = get()
        .chat.filter((message) => !message.error)
        .map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          sources: message.sources,
          createdAt: message.createdAt,
        }));
      const outgoing = [...history, userMessage];
      const requestId = crypto.randomUUID();
      set((state) => ({
        chat: [...state.chat, userMessage],
        chatStreaming: true,
        chatStreamText: '',
        chatToolStatus: '',
        agentTrace: [],
        agentThinking: '',
        chatRequestId: requestId,
      }));
      const result = await api.ai.chat(outgoing, requestId, {
        sessionId,
        thinking: get().thinking,
        agentId: 'knowledge',
        notePath: get().chatNote?.path,
      });
      const assistant: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.content,
        sources: result.sources,
        createdAt: localNowIso(),
        agentTrace: get().agentTrace.length ? get().agentTrace : undefined,
        agentThinking: get().agentThinking || undefined,
      };
      const meta: ChatSessionMeta =
        result.session || {
          id: result.sessionId,
          title: result.sessionTitle || '新对话',
          createdAt: localNowIso(),
          updatedAt: localNowIso(),
          messageCount: outgoing.length + 1,
          preview: result.content.slice(0, 80),
        };
      set((state) => ({
        chat: [...state.chat, assistant],
        chatSessions: [meta, ...state.chatSessions.filter((item) => item.id !== meta.id)],
        activeChatId: result.sessionId,
        chatStreaming: false,
        chatStreamText: '',
        chatToolStatus: '',
        agentTrace: [],
        agentThinking: '',
        contextCompressing: false,
        chatRequestId: null,
      }));
    } catch (error) {
      const message = errorMessage(error);
      const assistant: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '这次没有连上模型服务，检查设置后再试一次。',
        createdAt: localNowIso(),
        error: true,
        agentTrace: get().agentTrace.length ? get().agentTrace : undefined,
        agentThinking: get().agentThinking || undefined,
      };
      set((state) => ({
        chat: [...state.chat, assistant],
        chatStreaming: false,
        chatStreamText: '',
        chatToolStatus: '',
        agentTrace: [],
        agentThinking: '',
        contextCompressing: false,
        chatRequestId: null,
      }));
      get().toast('error', '对话没有完成', message, {
        label: '去设置',
        run: () => get().navigate('settings'),
      });
    }
  },

  newChat: async () => {
    try {
      const session = await api.chat.create();
      set((state) => ({
        activeChatId: session.id,
        chat: [],
        chatSessions: [toChatMeta(session), ...state.chatSessions],
        chatToolStatus: '',
        chatStreamText: '',
        chatNote: null,
        agentTrace: [],
        agentThinking: '',
        contextCompressing: false,
        chatRequestId: null,
      }));
    } catch (error) {
      get().toast('error', '没能新建对话', errorMessage(error));
    }
  },

  selectChat: async (id) => {
    try {
      const session = await api.chat.select(id);
      set({
        activeChatId: session.id,
        chat: session.messages,
        chatToolStatus: '',
        chatStreamText: '',
        chatNote: null,
        agentTrace: [],
        agentThinking: '',
        contextCompressing: false,
        chatRequestId: null,
      });
    } catch (error) {
      get().toast('error', '没能打开这条对话', errorMessage(error));
    }
  },

  renameChat: async (id, title) => {
    try {
      const meta = await api.chat.rename(id, title);
      set((state) => ({
        chatSessions: state.chatSessions.map((session) =>
          session.id === id ? meta : session,
        ),
      }));
    } catch (error) {
      get().toast('error', '没能重命名对话', errorMessage(error));
    }
  },

  deleteChat: async (id) => {
    try {
      const result = await api.chat.remove(id);
      set({
        chatSessions: result.sessions,
        activeChatId: result.activeId,
        chat: result.messages,
        chatToolStatus: '',
        chatStreamText: '',
        chatNote: null,
        agentTrace: [],
        agentThinking: '',
        contextCompressing: false,
        chatRequestId: null,
      });
      get().toast('success', '对话已删除');
    } catch (error) {
      get().toast('error', '没能删除对话', errorMessage(error));
    }
  },

  clearChat: async () => {
    const id = get().activeChatId;
    if (!id) return;
    try {
      const meta = await api.chat.clear(id);
      set((state) => ({
        chat: [],
        chatSessions: state.chatSessions.map((session) =>
          session.id === id ? meta : session,
        ),
        chatToolStatus: '',
        chatStreamText: '',
        chatNote: null,
        agentTrace: [],
        agentThinking: '',
        contextCompressing: false,
        chatRequestId: null,
      }));
    } catch (error) {
      get().toast('error', '没能清空对话', errorMessage(error));
    }
  },

  compressChat: async () => {
    const id = get().activeChatId;
    if (!id || get().chatStreaming || get().contextCompressing) return;
    set({ contextCompressing: true });
    try {
      const result = await api.chat.compress(id);
      set({
        chatSessions: result.sessions,
        contextCompressing: false,
      });
      get().toast('success', '上下文已压缩', '后续会用摘要和最近消息继续对话。');
    } catch (error) {
      set({ contextCompressing: false });
      get().toast('error', '没能压缩上下文', errorMessage(error));
    }
  },

  setThinking: (value) => {
    set({ thinking: value });
    if (value && !get().settings?.ai.thinkingModel) {
      get().toast(
        'info',
        '还没有配置思考模型',
        '在设置里填写一个思考模型后即可使用。',
        { label: '去设置', run: () => get().navigate('settings') },
      );
    }
  },

  setChatNote: (note) => set({ chatNote: note }),

  loadRagStatus: async () => {
    try {
      const status = await api.rag.status();
      set({ ragStatus: status, ragProgress: status.progress });
    } catch {
      set({ ragStatus: null });
    }
  },

  buildRag: async () => {
    try {
      const status = await api.rag.build();
      set({ ragStatus: status, ragProgress: null });
    } catch (error) {
      const message = errorMessage(error);
      await get().loadRagStatus();
      set({ ragProgress: null });
      if (message.includes('取消')) {
        get().toast('info', '已停止建立索引');
      } else {
        get().toast('error', '语义索引没有建立成功', message);
      }
    }
  },

  cancelRag: async () => {
    try {
      await api.rag.cancel();
    } catch {
      // 建立已经结束时取消是空操作
    }
  },

  loadTrash: async () => {
    try {
      const entries = await api.trash.list();
      set({ trashEntries: entries, trashCount: entries.length });
    } catch (error) {
      get().toast('error', '没能读取回收站', errorMessage(error));
    }
  },

  restoreTrash: async (id) => {
    try {
      const result = await api.trash.restore(id);
      set({
        notes: result.notes,
        stats: computeStats(result.notes),
        trashEntries: get().trashEntries.filter((entry) => entry.id !== id),
        trashCount: Math.max(0, get().trashCount - 1),
      });
      get().toast('success', '已恢复到知识库', result.title);
      get().navigate('library', result.path);
    } catch (error) {
      get().toast('error', '没能恢复这条笔记', errorMessage(error));
    }
  },

  deleteTrashPermanently: async (id) => {
    try {
      const entries = await api.trash.remove(id);
      set({ trashEntries: entries, trashCount: entries.length });
      get().toast('success', '已永久删除');
    } catch (error) {
      get().toast('error', '没能删除', errorMessage(error));
    }
  },

  emptyTrash: async () => {
    try {
      await api.trash.empty();
      set({ trashEntries: [], trashCount: 0 });
      get().toast('success', '回收站已清空');
    } catch (error) {
      get().toast('error', '没能清空回收站', errorMessage(error));
    }
  },

  moveVault: async (targetParent) => {
    try {
      const state = await api.vault.move(targetParent);
      const boot = get().boot;
      set({
        ...stateFields(state),
        boot: boot ? { ...boot, ...state } : null,
        page: 'settings',
        activePath: null,
        note: null,
        editing: false,
      });
      get().toast('success', '知识库已迁移', state.vault?.path);
      return true;
    } catch (error) {
      get().toast('error', '没能迁移知识库', errorMessage(error));
      return false;
    }
  },

  setDataDir: async (dataDir) => {
    try {
      const result = await api.app.setDataDir(dataDir);
      if (result.restartRequired) {
        get().toast('success', '数据目录已设置', '重启应用后生效。', {
          label: '立即重启',
          run: () => void api.app.relaunch(),
        });
      } else {
        get().toast('info', '当前已经在这个数据目录');
      }
    } catch (error) {
      get().toast('error', '没能设置数据目录', errorMessage(error));
    }
  },

  relaunchApp: async () => {
    await api.app.relaunch();
  },
}));
