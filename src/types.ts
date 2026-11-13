export type ThemeSetting = 'system' | 'light' | 'dark';

export type NoteType = 'raw' | 'concept' | 'entity' | 'source' | 'note' | 'system';

export type Page = 'home' | 'inbox' | 'library' | 'chat' | 'graph' | 'trash' | 'settings';

export interface NoteMeta {
  path: string;
  title: string;
  type: NoteType;
  typeLabel: string;
  tags: string[];
  aliases: string[];
  created: string;
  updated: string;
  excerpt: string;
  links: string[];
  status: string;
  source: string;
  author: string;
  processedAt: string;
  wikiPaths: string[];
  wordCount: number;
  readingMinutes: number;
  size?: number;
  truncated?: boolean;
}

export interface NoteDetail extends NoteMeta {
  body: string;
  data: Record<string, unknown>;
}

export interface Stats {
  inbox: number;
  total: number;
  raw: number;
  week: number;
}

export interface VaultInfo {
  path: string;
  name: string;
  stats: Stats;
}

export interface PublicSettings {
  theme: ThemeSetting;
  vaultPath: string | null;
  recentVaults: string[];
  windowBounds: unknown;
  gitAutoSnapshot: boolean;
  snapshotDir: string;
  mcpServers: McpServerConfig[];
  ai: {
    preset: string;
    baseUrl: string;
    model: string;
    thinkingModel: string;
    contextWindow: number;
    autoCompress: boolean;
    hasKey: boolean;
  };
}

export interface McpServerConfig {
  id?: string;
  name?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface McpStatus {
  servers: { id: string; name: string; connected: boolean; toolCount: number }[];
  tools: { name: string; title: string; description: string; serverId: string; serverName: string }[];
  errors: { serverId: string; name: string; message: string }[];
}

export interface RagProgress {
  phase: 'model' | 'scan' | 'embed' | 'write' | 'done' | 'error';
  current: number;
  total: number;
  title: string;
  embedded?: number;
  reused?: number;
  chunks?: number;
  notes?: number;
}

export interface RagStatus {
  ready: boolean;
  building: boolean;
  model: string;
  bundled: boolean;
  notes: number;
  chunks: number;
  builtAt: string;
  progress: RagProgress | null;
}

export interface GitCommit {
  hash: string;
  date: string;
  message: string;
}

export interface GitState {
  available: boolean;
  isRepo: boolean;
  latest?: GitCommit | null;
  history: GitCommit[];
}

export interface ChatSource {
  path: string;
  title: string;
  type: NoteType;
  status?: string;
}

export interface ChatNoteRef {
  path: string;
  title: string;
  type: NoteType;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
  createdAt: string;
  error?: boolean;
  agentTrace?: AgentStep[];
  agentThinking?: string;
}

export interface AgentStep {
  id: string;
  type: 'thinking' | 'tool';
  content?: string;
  label?: string;
  tool?: string;
  status?: 'running' | 'done' | 'error';
  detail?: string;
  args?: Record<string, unknown>;
}

export interface AgentEvent {
  requestId?: string;
  id?: string;
  type: 'thinking' | 'thinking-delta' | 'tool';
  content?: string;
  delta?: string;
  label?: string;
  tool?: string;
  status?: 'running' | 'done' | 'error';
  detail?: string;
  args?: Record<string, unknown>;
}

export interface ChatSessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview: string;
  summary?: string;
  summaryCount?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  summary?: string;
  summaryCount?: number;
}

export interface ContextEvent {
  requestId?: string;
  status: 'compressing' | 'compressed' | 'error';
  session?: ChatSessionMeta;
  message?: string;
}

export interface ChatListState {
  sessions: ChatSessionMeta[];
  activeId: string | null;
}

export interface TrashEntry {
  id: string;
  title: string;
  type: NoteType;
  originalPath: string;
  fileName: string;
  deletedAt: string;
}

export interface OrganizePage {
  path: string;
  type: NoteType;
  title: string;
  action: 'create' | 'update';
  body: string;
  diff: string;
  aliases: string[];
  tags: string[];
}

export interface OrganizeProposal {
  rawPath: string;
  rawTitle: string;
  summary: string;
  log: string;
  pages: OrganizePage[];
}

export interface OrganizePreview {
  id: string;
  proposals: OrganizeProposal[];
  stats: {
    pages: number;
    creates: number;
    updates: number;
  };
}

export interface ApplyResult {
  written: string[];
  gitCommitted: boolean;
  snapshotFile?: string;
  warning: string;
  notes: NoteMeta[];
  stats: Stats;
  git: GitState;
}

export interface GitSnapshotResult extends GitState {
  snapshotFile?: string;
  warning?: string;
}

export interface AppState {
  vault: VaultInfo | null;
  notes: NoteMeta[];
  settings: PublicSettings;
  recentVaults: string[];
  git: GitState;
  chat: ChatMessage[];
  chatSessions: ChatSessionMeta[];
  activeChatId: string | null;
  trashCount: number;
}

export interface Bootstrap extends AppState {
  app: {
    name: string;
    version: string;
    platform: string;
  };
  dataDir: string;
  notice?: string;
}

export interface ImportOutcome {
  imported: NoteMeta[];
  failed: { path: string; message: string }[];
  canceled: boolean;
  notes: NoteMeta[];
  stats: Stats;
}

export interface SingleImportResult {
  note: NoteDetail;
  notes: NoteMeta[];
  stats: Stats;
}

export interface CreateNoteResult {
  note: NoteDetail;
  notes: NoteMeta[];
  stats: Stats;
}

export interface DeleteNoteResult {
  notes: NoteMeta[];
  stats: Stats;
  trashCount?: number;
  entry?: TrashEntry;
}

export interface RevertResult {
  git: GitState;
  notes: NoteMeta[];
  stats: Stats;
}

export interface SettingsPatch {
  theme?: ThemeSetting;
  gitAutoSnapshot?: boolean;
  snapshotDir?: string;
  mcpServers?: McpServerConfig[];
  ai?: {
    preset?: string;
    baseUrl?: string;
    model?: string;
    thinkingModel?: string;
    contextWindow?: number;
    autoCompress?: boolean;
    apiKey?: string;
    clearKey?: boolean;
  };
}

export interface DataDirInfo {
  current: string;
  defaultDir: string;
}

export interface ZhiyuApi {
  isElectron?: boolean;
  app: {
    bootstrap: () => Promise<Bootstrap>;
    chooseFolder: () => Promise<string | null>;
    defaultLocation: () => Promise<string>;
    revealVault: () => Promise<void>;
    openExternal: (url: string) => Promise<void>;
    openFolder: (folderPath: string) => Promise<void>;
    version: () => Promise<string>;
    getDataInfo: () => Promise<DataDirInfo>;
    setDataDir: (dataDir: string) => Promise<{ restartRequired: boolean; dataDir: string }>;
    relaunch: () => Promise<void>;
  };
  vault: {
    create: (parentPath: string, name: string) => Promise<AppState>;
    open: (targetPath?: string) => Promise<AppState | null>;
    move: (targetParent: string) => Promise<AppState>;
    refresh: () => Promise<AppState>;
  };
  notes: {
    list: () => Promise<NoteMeta[]>;
    read: (notePath: string) => Promise<NoteDetail>;
    save: (
      notePath: string,
      patch: { title?: string; body?: string; tags?: string[]; aliases?: string[] },
    ) => Promise<NoteDetail>;
    create: (input: { type: string; title: string; body?: string; tags?: string[] }) => Promise<CreateNoteResult>;
    remove: (notePath: string) => Promise<DeleteNoteResult>;
    reveal: (notePath: string) => Promise<void>;
  };
  trash: {
    list: () => Promise<TrashEntry[]>;
    restore: (id: string) => Promise<{ path: string; title: string; notes: NoteMeta[]; stats: Stats }>;
    remove: (id: string) => Promise<TrashEntry[]>;
    empty: () => Promise<TrashEntry[]>;
    count: () => Promise<number>;
  };
  chat: {
    list: () => Promise<ChatListState>;
    get: (id: string) => Promise<ChatSession | null>;
    create: (title?: string) => Promise<ChatSession>;
    select: (id: string) => Promise<ChatSession>;
    rename: (id: string, title: string) => Promise<ChatSessionMeta>;
    remove: (id: string) => Promise<ChatListState & { messages: ChatMessage[] }>;
    clear: (id: string) => Promise<ChatSessionMeta>;
    compress: (id: string) => Promise<{
      session: ChatSession;
      meta: ChatSessionMeta;
      sessions: ChatSessionMeta[];
    }>;
  };
  raw: {
    promote: (notePath: string) => Promise<{
      path: string;
      title: string;
      created: boolean;
      notes: NoteMeta[];
      stats: Stats;
      git: GitState;
      gitCommitted: boolean;
    }>;
    importText: (input: {
      title: string;
      content: string;
      source?: string;
      tags?: string[];
    }) => Promise<SingleImportResult>;
    importUrl: (url: string) => Promise<SingleImportResult>;
    importDialog: () => Promise<ImportOutcome>;
    importPaths: (paths: string[]) => Promise<ImportOutcome>;
  };
  ai: {
    organize: (paths: string[]) => Promise<OrganizePreview>;
    cancelOrganize: () => Promise<{ ok: boolean }>;
    applyOrganize: (id: string) => Promise<ApplyResult>;
    chat: (
      messages: ChatMessage[],
      requestId: string,
      options?: { sessionId?: string; thinking?: boolean; agentId?: string; notePath?: string },
    ) => Promise<ChatSendResult>;
    loadChat: () => Promise<ChatMessage[]>;
    clearChat: () => Promise<ChatMessage[]>;
    testConnection: (input: {
      preset?: string;
      baseUrl?: string;
      model?: string;
      apiKey?: string;
    }) => Promise<{ ok: boolean; message: string; models?: string[] }>;
  };
  settings: {
    update: (patch: SettingsPatch) => Promise<PublicSettings>;
  };
  mcp: {
    status: () => Promise<McpStatus>;
    refresh: () => Promise<McpStatus>;
  };
  rag: {
    status: () => Promise<RagStatus>;
    build: () => Promise<RagStatus>;
    cancel: () => Promise<{ ok: boolean }>;
  };
  git: {
    init: () => Promise<GitState>;
    snapshot: (message?: string) => Promise<GitSnapshotResult>;
    history: () => Promise<GitCommit[]>;
    revert: (hash: string) => Promise<RevertResult>;
  };
  window: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<boolean>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
  };
  events: {
    onVaultChanged: (callback: (payload: { event: string; path: string }) => void) => () => void;
    onOrganizeProgress: (
      callback: (progress: { current: number; total: number; title: string }) => void,
    ) => () => void;
    onChatDelta: (callback: (payload: { requestId: string; delta: string }) => void) => () => void;
    onChatTool: (callback: (payload: { requestId: string; label: string; status: string }) => void) => () => void;
    onAgent: (callback: (payload: AgentEvent) => void) => () => void;
    onContext: (callback: (payload: ContextEvent) => void) => () => void;
    onRagProgress: (callback: (payload: RagProgress) => void) => () => void;
  };
  files: {
    getPath: (file: File) => string;
  };
}

export interface ChatSendResult {
  content: string;
  sources: ChatSource[];
  sessionId: string;
  sessionTitle?: string;
  session?: ChatSessionMeta;
}
