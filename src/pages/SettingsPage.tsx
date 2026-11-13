import { useEffect, useState } from 'react';
import {
  ArrowRightLeft,
  Bot,
  Brain,
  Camera,
  CheckCircle2,
  Database,
  FolderCog,
  FolderOpen,
  GitBranch,
  HardDrive,
  Info,
  Palette,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Trash2,
  Undo2,
  Wrench,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { computeStats, useAppStore } from '../store';
import type { DataDirInfo, GitCommit, McpStatus, ThemeSetting } from '../types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Logo } from '../components/Logo';

const PRESETS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    hint: '中文稳定，性价比高',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    hint: '通用能力强',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen3:8b',
    hint: '本机运行，无需密钥',
  },
  {
    id: 'custom',
    name: '自定义',
    baseUrl: '',
    model: '',
    hint: '兼容 OpenAI 接口',
  },
];

const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
];

export function SettingsPage() {
  const settings = useAppStore((state) => state.settings);
  const vault = useAppStore((state) => state.vault);
  const git = useAppStore((state) => state.git);
  const boot = useAppStore((state) => state.boot);
  const trashCount = useAppStore((state) => state.trashCount);
  const setTheme = useAppStore((state) => state.setTheme);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const setModal = useAppStore((state) => state.setModal);
  const toast = useAppStore((state) => state.toast);
  const navigate = useAppStore((state) => state.navigate);
  const openVault = useAppStore((state) => state.openVault);
  const moveVault = useAppStore((state) => state.moveVault);
  const setDataDir = useAppStore((state) => state.setDataDir);
  const ragStatus = useAppStore((state) => state.ragStatus);
  const ragProgress = useAppStore((state) => state.ragProgress);
  const loadRagStatus = useAppStore((state) => state.loadRagStatus);
  const buildRag = useAppStore((state) => state.buildRag);
  const cancelRag = useAppStore((state) => state.cancelRag);

  const [preset, setPreset] = useState(settings?.ai.preset || 'deepseek');
  const [baseUrl, setBaseUrl] = useState(settings?.ai.baseUrl || '');
  const [model, setModel] = useState(settings?.ai.model || '');
  const [thinkingModel, setThinkingModel] = useState(settings?.ai.thinkingModel || '');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(Boolean(settings?.ai.hasKey));
  const [snapshotDir, setSnapshotDir] = useState(settings?.snapshotDir || '');
  const [mcpJson, setMcpJson] = useState(JSON.stringify(settings?.mcpServers || [], null, 2));
  const [mcpStatus, setMcpStatus] = useState<McpStatus | null>(null);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [dataInfo, setDataInfo] = useState<DataDirInfo | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [revertHash, setRevertHash] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<string | null>(null);
  const [pendingDataDir, setPendingDataDir] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setPreset(settings.ai.preset);
    setBaseUrl(settings.ai.baseUrl);
    setModel(settings.ai.model);
    setThinkingModel(settings.ai.thinkingModel || '');
    setHasKey(settings.ai.hasKey);
    setSnapshotDir(settings.snapshotDir || '');
    setMcpJson(JSON.stringify(settings.mcpServers || [], null, 2));
  }, [
    settings?.ai.preset,
    settings?.ai.baseUrl,
    settings?.ai.model,
    settings?.ai.thinkingModel,
    settings?.ai.hasKey,
    settings?.snapshotDir,
    settings?.mcpServers,
  ]);

  useEffect(() => {
    api.app.getDataInfo().then(setDataInfo).catch(() => {});
    api.mcp.status().then(setMcpStatus).catch(() => {});
    void loadRagStatus();
  }, [loadRagStatus]);

  if (!settings) return null;

  const ragProgressData = ragProgress || ragStatus?.progress || null;
  const ragBuilding = Boolean(ragStatus?.building);
  const ragPhaseLabels: Record<string, string> = {
    model: '加载本地模型',
    scan: '扫描笔记',
    embed: '生成向量',
    write: '写入索引',
    done: '索引已更新',
    error: '建立失败',
  };
  const ragPhaseLabel = ragProgressData
    ? ragPhaseLabels[ragProgressData.phase] || '建立索引'
    : '准备索引';
  const ragPercent =
    ragProgressData && ragProgressData.total
      ? Math.min(100, Math.round((ragProgressData.current / ragProgressData.total) * 100))
      : 0;
  const ragBuiltLabel = ragStatus?.builtAt
    ? ragStatus.builtAt.slice(0, 16).replace('T', ' ')
    : '';

  const choosePreset = (item: (typeof PRESETS)[number]) => {
    setPreset(item.id);
    if (item.baseUrl) setBaseUrl(item.baseUrl);
    if (item.model) setModel(item.model);
    setTestResult(null);
  };

  const saveAi = async () => {
    setSaving(true);
    const next = await updateSettings({
      ai: {
        preset,
        baseUrl,
        model,
        thinkingModel,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      },
    });
    setSaving(false);
    if (next) {
      setApiKey('');
      setHasKey(next.ai.hasKey);
      toast('success', '模型设置已保存');
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.ai.testConnection({
        preset,
        baseUrl,
        model,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setTestResult({ ok: true, message: result.message || '连接成功' });
    } catch (error) {
      setTestResult({ ok: false, message: errorMessage(error) });
    } finally {
      setTesting(false);
    }
  };

  const refreshGit = async () => {
    setBusy(true);
    try {
      const next = await api.git.history();
      const state = useAppStore.getState().git;
      if (state) {
        useAppStore.setState({
          git: { ...state, history: next, latest: next[0] || null },
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const initGit = async () => {
    setBusy(true);
    try {
      const next = await api.git.init();
      useAppStore.setState({ git: next });
      toast('success', '已开启版本快照', '之后每次整理都会留下一个可回退的版本。');
    } catch (error) {
      toast('error', '没能开启版本快照', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const snapshot = async () => {
    setBusy(true);
    try {
      const next = await api.git.snapshot('手动快照');
      useAppStore.setState({ git: next });
      if (next.warning) {
        toast('info', '版本已创建，但快照备份失败', next.warning);
      } else {
        toast(
          'success',
          '已创建版本快照',
          next.snapshotFile ? '同时写入了快照备份文件。' : undefined,
        );
      }
    } catch (error) {
      toast('error', '快照没有创建成功', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const revert = async (hash: string) => {
    setBusy(true);
    try {
      const result = await api.git.revert(hash);
      useAppStore.setState({
        git: result.git,
        notes: result.notes,
        stats: computeStats(result.notes),
      });
      toast('success', '已撤销这次整理', '文件会回到这次整理之前的状态。');
    } catch (error) {
      toast('error', '没能撤销', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const chooseSnapshotDir = async () => {
    const folder = await api.app.chooseFolder();
    if (!folder) return;
    const next = await updateSettings({ snapshotDir: folder });
    if (next) {
      setSnapshotDir(next.snapshotDir);
      toast('success', '快照备份目录已设置', folder);
    }
  };

  const clearSnapshotDir = async () => {
    const next = await updateSettings({ snapshotDir: '' });
    if (next) {
      setSnapshotDir('');
      toast('success', '已清除快照备份目录');
    }
  };

  const chooseDataDir = async () => {
    const folder = await api.app.chooseFolder();
    if (folder) setPendingDataDir(folder);
  };

  const chooseMoveParent = async () => {
    const folder = await api.app.chooseFolder();
    if (folder) setPendingMove(folder);
  };

  const currentPreset = PRESETS.find((item) => item.id === preset);

  const saveMcp = async () => {
    let parsed;
    try {
      parsed = JSON.parse(mcpJson);
    } catch {
      toast('error', 'MCP 配置不是合法 JSON');
      return;
    }
    if (!Array.isArray(parsed)) {
      toast('error', 'MCP 配置需要是一个数组');
      return;
    }
    setMcpBusy(true);
    const next = await updateSettings({ mcpServers: parsed });
    if (next) {
      setMcpJson(JSON.stringify(next.mcpServers, null, 2));
      const status = await api.mcp.refresh().catch(() => null);
      if (status) setMcpStatus(status);
      toast('success', 'MCP 配置已保存');
    }
    setMcpBusy(false);
  };

  const refreshMcp = async () => {
    setMcpBusy(true);
    try {
      setMcpStatus(await api.mcp.refresh());
    } catch (error) {
      toast('error', 'MCP 连接失败', errorMessage(error));
    } finally {
      setMcpBusy(false);
    }
  };

  return (
    <div className="page settings-page">
      <header className="page-head">
        <div className="page-head-main">
          <div className="page-eyebrow">偏好</div>
          <h1 className="page-title">设置</h1>
          <p className="page-subtitle">模型、外观、目录与知识库的行为，都在这里调整。</p>
        </div>
      </header>

      <div className="page-body settings-body">
        <section className="settings-section">
          <div className="settings-section-head">
            <div>
              <h2>
                <Bot size={16} /> 模型服务
              </h2>
              <p>整理和对话都通过这里配置的模型完成。密钥只保存在本机。</p>
            </div>
            {hasKey ? (
              <span className="settings-badge">
                <CheckCircle2 size={12} /> 已保存密钥
              </span>
            ) : null}
          </div>
          <div className="settings-card">
            <div className="preset-grid">
              {PRESETS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`preset-card${preset === item.id ? ' active' : ''}`}
                  onClick={() => choosePreset(item)}
                >
                  <span className="preset-name">{item.name}</span>
                  <span className="preset-hint">{item.hint}</span>
                  {preset === item.id ? <span className="preset-check">已选择</span> : null}
                </button>
              ))}
            </div>
            <div className="settings-form-grid">
              <label className="field">
                <span className="field-label">接口地址</span>
                <input
                  className="input"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://api.deepseek.com"
                  spellCheck={false}
                />
              </label>
              <label className="field">
                <span className="field-label">对话模型</span>
                <input
                  className="input"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="deepseek-chat"
                  spellCheck={false}
                />
              </label>
              <label className="field thinking-field">
                <span className="field-label">思考模型（可选）</span>
                <input
                  className="input"
                  value={thinkingModel}
                  onChange={(event) => setThinkingModel(event.target.value)}
                  placeholder="例如 deepseek-reasoner"
                  spellCheck={false}
                />
                <span className="field-hint">对话页的「思考」开关会切换到这里的模型。</span>
              </label>
              <label className="field settings-key-field">
                <span className="field-label">密钥</span>
                <input
                  className="input"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={hasKey ? '已保存，输入新密钥可替换' : '输入 API Key'}
                  spellCheck={false}
                  autoComplete="off"
                />
                <span className="field-hint">
                  {preset === 'ollama'
                    ? '本机 Ollama 通常不需要密钥。'
                    : '密钥使用系统安全存储加密，不会同步到任何地方。'}
                </span>
              </label>
            </div>
            <div className="settings-actions">
              <button type="button" className="btn btn-sm btn-outline" onClick={() => void test()} disabled={testing}>
                {testing ? <span className="spinner" /> : <ShieldCheck size={13.5} />}
                {testing ? '正在连接…' : '测试连接'}
              </button>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void saveAi()} disabled={saving}>
                {saving ? <span className="spinner" /> : null}
                保存模型设置
              </button>
              {testResult ? (
                <span className={`test-result ${testResult.ok ? 'ok' : 'bad'}`}>
                  <span className="test-dot" />
                  {testResult.message}
                </span>
              ) : (
                <span className="test-result muted">{currentPreset?.hint}</span>
              )}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-head">
            <div>
              <h2>
                <Database size={16} /> 语义检索
              </h2>
              <p>关键词加向量混合检索。模型随应用安装，本机运行，不需要联网。</p>
            </div>
            <span className={`settings-badge ${ragStatus?.ready ? 'sage' : 'neutral'}`}>
              {ragBuilding ? '建立中' : ragStatus?.ready ? '已启用' : '待建立'}
            </span>
          </div>
          <div className="settings-card rag-card">
            <div className="rag-stats">
              <div className="rag-stat">
                <b>{ragStatus?.notes ?? 0}</b>
                <span>篇笔记已索引</span>
              </div>
              <div className="rag-stat">
                <b>{ragStatus?.chunks ?? 0}</b>
                <span>个语义片段</span>
              </div>
              <div className="rag-stat wide">
                <b>{ragStatus?.model || '中英双引擎'}</b>
                <span>中文 + 英文模型 · 约 56MB · 不需要显卡</span>
              </div>
            </div>
            {ragBuilding ? (
              <div className="rag-progress">
                <div className="rag-progress-head">
                  <span>{ragPhaseLabel}</span>
                  <span>
                    {ragProgressData?.total
                      ? `${ragProgressData.current} / ${ragProgressData.total}`
                      : '准备中'}
                  </span>
                </div>
                <div className="context-meter">
                  <span style={{ width: `${Math.max(3, ragPercent)}%` }} />
                </div>
              </div>
            ) : null}
            <div className="settings-actions">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => void buildRag()}
                disabled={ragBuilding}
              >
                {ragBuilding ? <span className="spinner" /> : <RefreshCw size={13.5} />}
                {ragStatus?.ready ? '更新索引' : '建立索引'}
              </button>
              {ragBuilding ? (
                <button type="button" className="btn btn-sm btn-outline" onClick={() => void cancelRag()}>
                  停止
                </button>
              ) : null}
              <span className="test-result muted">
                {ragStatus?.ready
                  ? ragBuiltLabel
                    ? `上次更新 ${ragBuiltLabel}`
                    : '索引已就绪'
                  : '首次建立后，后续只处理有变化的笔记。'}
              </span>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-head">
            <div>
              <h2>
                <Wrench size={16} /> 工具与 MCP
              </h2>
              <p>对话页的知识助手会使用本地工具和这里连接的 MCP 工具。</p>
            </div>
            {mcpStatus ? (
              <span className="settings-badge neutral">
                {mcpStatus.tools.length} 个工具
              </span>
            ) : null}
          </div>
          <div className="settings-card mcp-card">
            <label className="field">
              <span className="field-label">MCP 服务配置（JSON 数组）</span>
              <textarea
                className="textarea mcp-editor"
                value={mcpJson}
                onChange={(event) => setMcpJson(event.target.value)}
                spellCheck={false}
                placeholder={'[\n  {\n    "id": "filesystem",\n    "name": "Filesystem",\n    "command": "npx",\n    "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\\\notes"]\n  }\n]'}
              />
              <span className="field-hint">
                使用 stdio 方式启动 MCP Server；保存后会自动连接并读取工具列表。
              </span>
            </label>
            <div className="settings-actions">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void saveMcp()} disabled={mcpBusy}>
                {mcpBusy ? <span className="spinner" /> : <Wrench size={13.5} />}
                保存并连接
              </button>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => void refreshMcp()} disabled={mcpBusy}>
                <RefreshCw size={13.5} />
                刷新工具
              </button>
              <span className="test-result muted">
                内置 Agent 默认使用本地只读工具，不会自动改文件。
              </span>
            </div>
            {mcpStatus?.servers.length ? (
              <div className="mcp-status-list">
                {mcpStatus.servers.map((server) => (
                  <div key={server.id} className="mcp-status-row">
                    <span className={`mcp-dot${server.connected ? ' ok' : ''}`} />
                    <span className="mcp-name">{server.name}</span>
                    <span className="mcp-meta">
                      {server.connected ? `${server.toolCount} 个工具` : '未连接'}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {mcpStatus?.errors.length ? (
              <div className="mcp-errors">
                {mcpStatus.errors.map((error) => (
                  <div key={`${error.serverId}-${error.message}`} className="mcp-error">
                    <b>{error.name}</b>
                    <span>{error.message}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-head">
            <div>
              <h2>
                <Palette size={16} /> 外观
              </h2>
              <p>选择一个适合长时间阅读的界面。</p>
            </div>
          </div>
          <div className="settings-card settings-row-card">
            <div className="settings-row">
              <div className="settings-row-main">
                <b>主题</b>
                <span>浅色像纸，深色适合夜晚。</span>
              </div>
              <div className="segmented">
                {THEMES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={settings.theme === item.value ? 'active' : ''}
                    onClick={() => void setTheme(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-head">
            <div>
              <h2>
                <GitBranch size={16} /> 版本快照
              </h2>
              <p>每次整理后留下可回退的版本；可额外把快照备份到独立目录。</p>
            </div>
            {git?.isRepo ? (
              <span className="settings-badge sage">
                <CheckCircle2 size={12} /> 已开启
              </span>
            ) : null}
          </div>
          <div className="settings-card settings-version-card">
            {!git?.available ? (
              <div className="settings-empty-row">
                <Info size={15} />
                没有检测到 Git。安装 Git 后可以开启版本快照。
              </div>
            ) : !git.isRepo ? (
              <div className="settings-empty-row">
                <div>
                  <b>还没有开启版本快照</b>
                  <span>在你的知识库文件夹中初始化 Git，不会影响现有文件。</span>
                </div>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => void initGit()} disabled={busy}>
                  {busy ? <span className="spinner" /> : <GitBranch size={13.5} />}
                  开启
                </button>
              </div>
            ) : (
              <>
                <div className="settings-row">
                  <div className="settings-row-main">
                    <b>整理后自动快照</b>
                    <span>每次 AI 写入后自动提交一个版本。</span>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={settings.gitAutoSnapshot}
                      onChange={(event) => void updateSettings({ gitAutoSnapshot: event.target.checked })}
                    />
                    <span className="switch-track" />
                  </label>
                </div>
                <div className="settings-row">
                  <div className="settings-row-main">
                    <b>快照备份目录</b>
                    <span>
                      {snapshotDir || '未设置。设置后每次提交会额外写入一个 .bundle 文件。'}
                    </span>
                  </div>
                  <div className="settings-inline-actions">
                    {snapshotDir ? (
                      <>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void api.app.openFolder(snapshotDir)}>
                          <FolderOpen size={13} />
                          打开
                        </button>
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => void clearSnapshotDir()}>
                          清除
                        </button>
                      </>
                    ) : null}
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => void chooseSnapshotDir()}>
                      <FolderCog size={13.5} />
                      选择目录
                    </button>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-main">
                    <b>当前版本</b>
                    <span>{git.latest ? `${git.latest.date} · ${git.latest.message}` : '还没有提交记录'}</span>
                  </div>
                  <div className="settings-inline-actions">
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => void refreshGit()} disabled={busy}>
                      <RefreshCw size={13} />
                      刷新
                    </button>
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => void snapshot()} disabled={busy}>
                      {busy ? <span className="spinner" /> : <Camera size={13.5} />}
                      创建快照
                    </button>
                  </div>
                </div>
                {git.history.length ? (
                  <div className="git-history">
                    <div className="git-history-head">最近版本</div>
                    {git.history.slice(0, 12).map((commit: GitCommit) => (
                      <div key={commit.hash} className="git-commit">
                        <span className="git-dot" />
                        <div className="git-main">
                          <b>{commit.message}</b>
                          <span>
                            {commit.date} · {commit.hash}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost git-undo"
                          disabled={busy}
                          onClick={() => setRevertHash(commit.hash)}
                        >
                          <Undo2 size={12.5} />
                          撤销
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-head">
            <div>
              <h2>
                <HardDrive size={16} /> 知识库与目录
              </h2>
              <p>知识库、应用设置和快照备份都可以独立放置。</p>
            </div>
          </div>
          <div className="settings-card settings-row-card">
            <div className="settings-row">
              <div className="settings-row-main">
                <b>知识库位置</b>
                <span className="settings-path" title={vault?.path}>
                  {vault?.path}
                </span>
              </div>
              <div className="settings-inline-actions">
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => void api.app.revealVault()}>
                  <FolderOpen size={13.5} />
                  打开
                </button>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => void openVault()}>
                  更换
                </button>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => void chooseMoveParent()}>
                  <ArrowRightLeft size={13} />
                  迁移
                </button>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-main">
                <b>应用数据目录</b>
                <span className="settings-path" title={dataInfo?.current}>
                  {dataInfo?.current || boot?.dataDir || '读取中…'}
                </span>
                <span>设置、密钥和外观偏好保存在这里；迁移后需要重启应用。</span>
              </div>
              <div className="settings-inline-actions">
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={!dataInfo?.current}
                  onClick={() => dataInfo?.current && void api.app.openFolder(dataInfo.current)}
                >
                  <FolderOpen size={13.5} />
                  打开
                </button>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => void chooseDataDir()}>
                  <Database size={13.5} />
                  更改
                </button>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-main">
                <b>整理规则</b>
                <span>决定 AI 如何提取概念、合并条目和建立链接。</span>
              </div>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setModal('rules')}>
                <ScrollText size={13.5} />
                编辑规则
              </button>
            </div>
            <div className="settings-row">
              <div className="settings-row-main">
                <b>回收站</b>
                <span>{trashCount ? `有 ${trashCount} 条笔记等待恢复或永久删除。` : '回收站是空的。'}</span>
              </div>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => navigate('trash')}>
                <Trash2 size={13.5} />
                打开回收站
              </button>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-head">
            <div>
              <h2>
                <Info size={16} /> 关于知屿
              </h2>
            </div>
          </div>
          <div className="settings-card about-card">
            <Logo size={44} />
            <div className="about-main">
              <b>知屿 {boot?.app.version || '1.0.0'}</b>
              <span>本地优先的个人知识库。笔记是 Markdown 文件，AI 只是帮你整理。</span>
              <span className="about-fine">Windows 桌面版 · 数据保存在本机</span>
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(revertHash)}
        title="撤销这次整理？"
        description="会创建一个反向提交，把这批文件恢复到整理前的状态。之后的新修改不会被删除，但如果与这次整理冲突，可能需要手动处理。"
        confirmLabel="撤销这次整理"
        danger
        busy={busy}
        onCancel={() => setRevertHash(null)}
        onConfirm={async () => {
          if (!revertHash) return;
          const hash = revertHash;
          setRevertHash(null);
          await revert(hash);
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingMove)}
        title="迁移知识库？"
        description={`知识库会整体移动到「${pendingMove || ''}\\${vault?.name || ''}」。文件、Git 历史、对话记录和回收站都会一起移动。移动期间请不要关闭应用。`}
        confirmLabel="迁移知识库"
        busy={busy}
        onCancel={() => setPendingMove(null)}
        onConfirm={async () => {
          if (!pendingMove) return;
          const target = pendingMove;
          setPendingMove(null);
          setBusy(true);
          await moveVault(target);
          setBusy(false);
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDataDir)}
        title="更改应用数据目录？"
        description={`当前设置会复制到「${pendingDataDir || ''}」，然后需要重启应用才能生效。知识库文件和快照不会被移动。`}
        confirmLabel="更改并提示重启"
        busy={busy}
        onCancel={() => setPendingDataDir(null)}
        onConfirm={async () => {
          if (!pendingDataDir) return;
          const target = pendingDataDir;
          setPendingDataDir(null);
          setBusy(true);
          await setDataDir(target);
          setBusy(false);
        }}
      />
    </div>
  );
}