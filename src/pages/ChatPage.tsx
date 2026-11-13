import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  BookOpen,
  Bot,
  Brain,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Gauge,
  History,
  Layers,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { relativeTime } from '../lib/format';
import { estimateContextTokens, formatTokens } from '../lib/context';
import { useAppStore } from '../store';
import type { AgentStep, ChatMessage, ChatSource, ChatSessionMeta } from '../types';
import { Logo } from '../components/Logo';
import { MarkdownView } from '../components/MarkdownView';
import { ConfirmDialog } from '../components/ConfirmDialog';

const CONTEXT_PRESETS = [
  { value: 32000, label: '32K' },
  { value: 64000, label: '64K' },
  { value: 128000, label: '128K' },
  { value: 200000, label: '200K' },
  { value: 400000, label: '400K' },
  { value: 1000000, label: '1M' },
];

function parseContextWindow(raw: string): number {
  const text = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[,_\s]/g, '');
  const match = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(text);
  if (!match) return NaN;
  const unit = match[2] === 'k' ? 1000 : match[2] === 'm' ? 1000000 : 1;
  return Math.round(Number(match[1]) * unit);
}

const ASSISTANT_NAME = '知识助手';

function sourceLabel(type: string) {
  if (type === 'raw') return '资料';
  if (type === 'concept') return '概念';
  if (type === 'entity') return '实体';
  if (type === 'source') return '来源';
  return '笔记';
}

function AssistantAvatar() {
  return (
    <span className="assistant-avatar">
      <Logo size={24} />
    </span>
  );
}

function Sources({ sources }: { sources?: ChatSource[] }) {
  const navigate = useAppStore((state) => state.navigate);
  if (!sources?.length) return null;
  return (
    <div className="chat-sources">
      <span className="chat-sources-label">检索到</span>
      {sources.map((source) => (
        <button
          key={source.path}
          type="button"
          className="source-chip"
          onClick={() => navigate('library', source.path)}
        >
          <span className={`type-dot ${source.type}`} />
          {source.title}
          <span className="source-chip-type">
            {sourceLabel(source.type)}
            {source.type === 'raw' && source.status
              ? ` · ${source.status === 'processed' ? '已整理' : '待整理'}`
              : ''}
          </span>
        </button>
      ))}
    </div>
  );
}

function ThinkingBlock({
  content,
  active = false,
}: {
  content?: string;
  active?: boolean;
}) {
  const [open, setOpen] = useState(active);
  const previousActive = useRef(active);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (previousActive.current !== active) {
      setOpen(active);
      previousActive.current = active;
    }
  }, [active]);

  useEffect(() => {
    if (open && active && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [content, open, active]);

  if (!content) return null;

  return (
    <div className={`thinking-block${active ? ' active' : ''}`}>
      <button
        type="button"
        className="thinking-head"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="thinking-title">
          <Brain size={12} />
          思考
        </span>
        <span className="thinking-state">{active ? '思考中' : '已完成'}</span>
        <ChevronDown size={13} className={`agent-chevron${open ? ' open' : ''}`} />
      </button>
      {open ? (
        <div className="thinking-body" ref={bodyRef}>
          <pre>{content}</pre>
        </div>
      ) : null}
    </div>
  );
}

function AgentTrace({
  steps,
  active = false,
}: {
  steps?: AgentStep[];
  active?: boolean;
}) {
  const tools = (steps || []).filter((step) => step.type === 'tool');
  const [open, setOpen] = useState(active);
  const previousActive = useRef(active);
  const bodyRef = useRef<HTMLDivElement>(null);
  const tail = tools
    .map((step) => `${step.id}:${step.status}:${(step.detail || '').length}`)
    .join('|');

  useEffect(() => {
    if (previousActive.current !== active) {
      setOpen(active);
      previousActive.current = active;
    }
  }, [active]);

  useEffect(() => {
    if (open && active && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [tail, open, active]);

  if (!tools.length) return null;

  return (
    <div className={`agent-trace${active ? ' active' : ''}`}>
      <button
        type="button"
        className="agent-trace-head"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="agent-trace-title">
          <Bot size={12} />
          Agent 执行过程
          <em>{tools.length} 个工具</em>
        </span>
        <ChevronDown size={13} className={`agent-chevron${open ? ' open' : ''}`} />
      </button>
      {open ? (
        <div className="agent-trace-body" ref={bodyRef}>
          {tools.map((step) => (
            <div key={step.id} className={`agent-step ${step.status || ''}`}>
              <Wrench size={13} />
              <div className="step-main">
                <div className="step-line">
                  <b>{step.label || step.tool || '调用工具'}</b>
                  <span className="step-status">
                    {step.status === 'done'
                      ? '完成'
                      : step.status === 'error'
                        ? '失败'
                        : '执行中'}
                  </span>
                </div>
                {step.detail ? <pre>{step.detail}</pre> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MessageItem({
  message,
  copied,
  onCopy,
}: {
  message: ChatMessage;
  copied: boolean;
  onCopy: (message: ChatMessage) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="chat-row user">
        <div className="user-bubble">{message.content}</div>
      </div>
    );
  }
  return (
    <div className={`chat-row assistant${message.error ? ' error' : ''}`}>
      <AssistantAvatar />
      <div className="assistant-main">
        <ThinkingBlock content={message.agentThinking} />
        <AgentTrace steps={message.agentTrace} />
        <div className="assistant-bubble">
          <MarkdownView content={message.content} />
        </div>
        <Sources sources={message.sources} />
        <div className="chat-actions">
          <button
            type="button"
            className="chat-action"
            onClick={() => onCopy(message)}
            aria-label="复制回答"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? '已复制' : '复制'}
          </button>
          {message.error ? (
            <button
              type="button"
              className="chat-action"
              onClick={() => useAppStore.getState().navigate('settings')}
            >
              <Settings2 size={12} />
              检查设置
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ChatPage() {
  const chat = useAppStore((state) => state.chat);
  const sessions = useAppStore((state) => state.chatSessions);
  const activeChatId = useAppStore((state) => state.activeChatId);
  const notes = useAppStore((state) => state.notes);
  const settings = useAppStore((state) => state.settings);
  const chatStreaming = useAppStore((state) => state.chatStreaming);
  const chatStreamText = useAppStore((state) => state.chatStreamText);
  const chatToolStatus = useAppStore((state) => state.chatToolStatus);
  const agentTrace = useAppStore((state) => state.agentTrace);
  const agentThinking = useAppStore((state) => state.agentThinking);
  const hasToolSteps = agentTrace.some((step) => step.type === 'tool');
  const thinkingActive = chatStreaming && !chatStreamText && !hasToolSteps;
  const agentActive = chatStreaming && !chatStreamText && hasToolSteps;
  const chatDraft = useAppStore((state) => state.chatDraft);
  const chatNote = useAppStore((state) => state.chatNote);
  const setChatNote = useAppStore((state) => state.setChatNote);
  const thinking = useAppStore((state) => state.thinking);
  const setChatDraft = useAppStore((state) => state.setChatDraft);
  const sendChat = useAppStore((state) => state.sendChat);
  const newChat = useAppStore((state) => state.newChat);
  const selectChat = useAppStore((state) => state.selectChat);
  const renameChat = useAppStore((state) => state.renameChat);
  const deleteChat = useAppStore((state) => state.deleteChat);
  const clearChat = useAppStore((state) => state.clearChat);
  const setThinking = useAppStore((state) => state.setThinking);
  const compressChat = useAppStore((state) => state.compressChat);
  const contextCompressing = useAppStore((state) => state.contextCompressing);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const toast = useAppStore((state) => state.toast);
  const navigate = useAppStore((state) => state.navigate);

  const [input, setInput] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ChatSessionMeta | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [contextWindowDraft, setContextWindowDraft] = useState(
    String(settings?.ai.contextWindow || 128000),
  );
  const [contextSaved, setContextSaved] = useState(false);
  const saveContextWindowRef = useRef<(raw?: string) => void>(() => {});
  const [sessionMenuId, setSessionMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((session) => session.id === activeChatId);
  const contextSummary = activeSession?.summary || '';
  const summaryCount = activeSession?.summaryCount || 0;
  const contextWindow = Number(settings?.ai.contextWindow) || 128000;
  const usedTokens = estimateContextTokens(chat, contextSummary, summaryCount);
  const contextPercent = Math.min(100, Math.round((usedTokens / contextWindow) * 100));
  const canCompress = chat.length - summaryCount > 6;
  const activeTitle =
    !activeSession || activeSession.title === '新对话' ? '问问知识库' : activeSession.title;
  const baseUrl = settings?.ai.baseUrl || '';
  const localModel = /127\.0\.0\.1|localhost/.test(baseUrl);
  const needsSetup = Boolean(settings && !settings.ai.hasKey && !localModel);

  const suggestions = notes
    .filter((note) => note.type !== 'raw')
    .slice(0, 3)
    .map((note) =>
      note.type === 'entity'
        ? `《${note.title}》有什么特点和适用场景？`
        : note.type === 'source'
          ? `《${note.title}》讲了什么？`
          : `《${note.title}》的核心观点是什么？`,
    );

  useEffect(() => {
    if (!chatDraft) return;
    setInput(chatDraft);
    setChatDraft('');
    window.setTimeout(() => textareaRef.current?.focus(), 60);
  }, [chatDraft, setChatDraft]);

  useLayoutEffect(() => {
    const area = textareaRef.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${Math.min(area.scrollHeight, 160)}px`;
  }, [input]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chat.length, chatStreaming, chatStreamText, activeChatId]);

  useEffect(() => {
    setContextWindowDraft(String(contextWindow));
  }, [contextWindow]);

  useEffect(() => {
    if (!contextOpen) return;
    const onDown = (event: MouseEvent) => {
      if (contextRef.current?.contains(event.target as Node)) return;
      saveContextWindowRef.current();
      setContextOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [contextOpen]);

  const submit = () => {
    const text = input.trim();
    if (!text || chatStreaming) return;
    setInput('');
    void sendChat(text);
    window.setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const copyMessage = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId(null), 1600);
    } catch {
      toast('error', '没能复制回答');
    }
  };

  const beginRename = (session: ChatSessionMeta) => {
    setSessionMenuId(null);
    setEditingId(session.id);
    setEditingTitle(session.title);
  };

  const applyContextWindow = async (value: number) => {
    const next = Math.min(2_000_000, Math.max(8000, Math.round(value)));
    const saved = await updateSettings({ ai: { contextWindow: next } });
    if (saved) {
      setContextWindowDraft(String(saved.ai.contextWindow));
      setContextSaved(true);
      window.setTimeout(() => setContextSaved(false), 1600);
    } else {
      setContextWindowDraft(String(contextWindow));
    }
  };

  const saveContextWindow = (raw?: string) => {
    const text = String(raw ?? contextWindowDraft);
    if (text.trim() === String(contextWindow)) return;
    const next = parseContextWindow(text);
    if (!Number.isFinite(next) || next < 8000 || next > 2_000_000) {
      toast('error', '上下文窗口需要在 8,000 到 2,000,000 tokens 之间');
      setContextWindowDraft(String(contextWindow));
      return;
    }
    void applyContextWindow(next);
  };

  useEffect(() => {
    saveContextWindowRef.current = saveContextWindow;
  });

  const finishRename = async () => {
    if (!editingId) return;
    const next = editingTitle.trim();
    if (next) await renameChat(editingId, next);
    setEditingId(null);
  };

  return (
    <div className="page chat-page">
      <div className={`chat-layout${historyOpen ? ' history-open' : ''}`}>
        <aside className="chat-history-pane">
          <div className="chat-history-head">
            <div>
              <div className="chat-history-kicker">对话记录</div>
              <div className="chat-history-count">{sessions.length} 段对话</div>
            </div>
            <button type="button" className="icon-btn" onClick={() => void newChat()} aria-label="新对话">
              <Plus size={15} />
            </button>
          </div>
          <div className="chat-history-list">
            {sessions.length ? (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className={`chat-session${session.id === activeChatId ? ' active' : ''}`}
                >
                  {editingId === session.id ? (
                    <input
                      className="chat-session-rename"
                      data-autofocus
                      value={editingTitle}
                      onChange={(event) => setEditingTitle(event.target.value)}
                      onBlur={() => void finishRename()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void finishRename();
                        if (event.key === 'Escape') setEditingId(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="chat-session-main"
                      onClick={() => {
                        void selectChat(session.id);
                        setHistoryOpen(false);
                      }}
                    >
                      <span className="chat-session-title">{session.title}</span>
                      <span className="chat-session-preview">
                        {session.preview || '还没有消息'}
                      </span>
                      <span className="chat-session-time">{relativeTime(session.updatedAt)}</span>
                    </button>
                  )}
                  <div className="chat-session-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="对话操作"
                      onClick={() => setSessionMenuId(sessionMenuId === session.id ? null : session.id)}
                    >
                      <MoreHorizontal size={14} />
                    </button>
                    {sessionMenuId === session.id ? (
                      <div className="menu chat-session-menu">
                        <button
                          type="button"
                          className="menu-item"
                          onClick={() => beginRename(session)}
                        >
                          <Pencil size={13} />
                          重命名
                        </button>
                        <button
                          type="button"
                          className="menu-item danger"
                          onClick={() => {
                            setSessionMenuId(null);
                            setConfirmDelete(session);
                          }}
                        >
                          <Trash2 size={13} />
                          删除对话
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="chat-history-empty">还没有对话记录</div>
            )}
          </div>
          <button type="button" className="chat-history-new" onClick={() => void newChat()}>
            <Plus size={14} />
            新对话
          </button>
        </aside>

        <section className="chat-main">
          <header className="chat-main-head">
            <button
              type="button"
              className="icon-btn chat-history-toggle"
              onClick={() => setHistoryOpen((value) => !value)}
              aria-label="历史对话"
            >
              <History size={16} />
            </button>
            <div className="chat-title-block">
              <h1 className="chat-title">{activeTitle}</h1>
              <p className="chat-subtitle">
                {ASSISTANT_NAME} · {chatStreaming && chatToolStatus ? chatToolStatus : '回答会优先依据你的笔记，并标出出处。'}
              </p>
            </div>
            <div className="chat-head-actions">
              <div className="context-wrap" ref={contextRef}>
                <button
                  type="button"
                  className={`context-pill${contextPercent >= 80 ? ' warn' : ''}${contextCompressing ? ' busy' : ''}`}
                  onClick={() => {
                    if (contextOpen) saveContextWindowRef.current();
                    setContextOpen((value) => !value);
                  }}
                  title="上下文管理"
                >
                  {contextCompressing ? <span className="spinner" /> : <Gauge size={14} />}
                  {contextCompressing ? '压缩中' : `上下文 ${contextPercent}%`}
                </button>
                {contextOpen ? (
                  <div className="context-panel">
                    <div className="context-panel-head">
                      <b>上下文管理</b>
                      <span>估算值</span>
                    </div>
                    <div className="context-usage-row">
                      <span>已用约 {formatTokens(usedTokens)}</span>
                      <span>{formatTokens(contextWindow)} tokens</span>
                    </div>
                    <div className={`context-meter${contextPercent >= 80 ? ' warn' : ''}`}>
                      <span style={{ width: `${Math.max(2, contextPercent)}%` }} />
                    </div>
                    <div className="context-field">
                      <label htmlFor="context-window">上下文窗口</label>
                      <div className="context-input-wrap">
                        <input
                          id="context-window"
                          type="text"
                          inputMode="numeric"
                          placeholder="128000"
                          value={contextWindowDraft}
                          onChange={(event) => setContextWindowDraft(event.target.value)}
                          onBlur={() => saveContextWindow()}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              saveContextWindow();
                              event.currentTarget.blur();
                            }
                          }}
                        />
                        <span>tokens</span>
                        <button
                          type="button"
                          className="context-save"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => saveContextWindow()}
                        >
                          {contextSaved ? <Check size={11} /> : null}
                          {contextSaved ? '已保存' : '保存'}
                        </button>
                      </div>
                    </div>
                    <div className="context-preset-row">
                      {CONTEXT_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          type="button"
                          className={`context-preset${contextWindow === preset.value ? ' active' : ''}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            if (contextWindow !== preset.value) void applyContextWindow(preset.value);
                          }}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <p className="context-hint">支持 8,000–2,000,000，也可以直接填 128K 或 1M。</p>
                    <div className="context-switch-row">
                      <div>
                        <b>自动压缩</b>
                        <span>超过 80% 时自动摘要旧消息</span>
                      </div>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={settings?.ai.autoCompress !== false}
                          onChange={(event) =>
                            void updateSettings({
                              ai: { autoCompress: event.target.checked },
                            })
                          }
                        />
                        <span className="switch-track" />
                      </label>
                    </div>
                    <div className="context-summary-row">
                      <span>
                        {summaryCount
                          ? `已压缩 ${summaryCount} 条历史消息`
                          : '尚未压缩历史消息'}
                      </span>
                    </div>
                    {contextSummary ? (
                      <div className="context-panel-summary">
                        <div>当前压缩摘要</div>
                        <pre>{contextSummary}</pre>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-sm btn-outline context-compress"
                      disabled={!canCompress || chatStreaming || contextCompressing}
                      onClick={() => void compressChat()}
                    >
                      {contextCompressing ? <span className="spinner" /> : <Minimize2 size={13} />}
                      {contextCompressing ? '正在压缩…' : '立即压缩上下文'}
                    </button>
                    <p className="context-note">
                      只影响发送给模型的上下文，不会删除聊天记录。
                    </p>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className={`thinking-toggle${thinking ? ' active' : ''}`}
                onClick={() => setThinking(!thinking)}
                title={settings?.ai.thinkingModel ? '切换思考模式' : '先在设置里填写思考模型'}
              >
                <Brain size={14} />
                思考
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={!chat.length || chatStreaming}
                onClick={() => setConfirmClear(true)}
              >
                <Trash2 size={13.5} />
                清空
              </button>
            </div>
          </header>

          <div className="chat-body">
            {needsSetup ? (
              <div className="chat-config-banner">
                <span className="chat-config-icon">
                  <Settings2 size={15} />
                </span>
                <div>
                  <b>还没有连接模型服务</b>
                  <span>填入模型接口和密钥后，就可以开始对话。</span>
                </div>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => navigate('settings')}>
                  去设置
                </button>
              </div>
            ) : null}

            {contextSummary ? (
              <div className="context-summary-card">
                <button
                  type="button"
                  className="context-summary-head"
                  onClick={() => setSummaryOpen((value) => !value)}
                >
                  <span>
                    <Layers size={13} />
                    已压缩 {summaryCount} 条历史消息
                  </span>
                  <span>
                    {summaryOpen ? '收起' : '查看摘要'}
                    <ChevronDown
                      size={13}
                      className={`agent-chevron${summaryOpen ? ' open' : ''}`}
                    />
                  </span>
                </button>
                {summaryOpen ? (
                  <pre className="context-summary-body">{contextSummary}</pre>
                ) : null}
              </div>
            ) : null}

            {!chat.length && !chatStreaming ? (
              <div className="chat-empty">
                <div className="chat-empty-mark">
                  <Logo size={42} />
                </div>
                <h2>从你的知识库开始</h2>
                <p>
                  试试让{ASSISTANT_NAME}帮你查收件箱、找相关笔记，或者直接问一个具体问题。
                </p>
                <div className="suggestion-list">
                  {(suggestions.length
                    ? suggestions
                    : ['我的收件箱里有哪些待整理资料？', '帮我梳理一下最近记录的概念。']
                  ).map((question) => (
                    <button
                      key={question}
                      type="button"
                      className="suggestion"
                      onClick={() => void sendChat(question)}
                    >
                      <Sparkles size={13} />
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="chat-thread">
                {chat.map((message) => (
                  <MessageItem
                    key={message.id}
                    message={message}
                    copied={copiedId === message.id}
                    onCopy={(item) => void copyMessage(item)}
                  />
                ))}
                {chatStreaming ? (
                  <div className="chat-row assistant">
                    <AssistantAvatar />
                    <div className="assistant-main">
                      <ThinkingBlock content={agentThinking} active={thinkingActive} />
                      <AgentTrace steps={agentTrace} active={agentActive} />
                      <div className="assistant-bubble streaming">
                        {chatStreamText ? (
                          <>
                            <MarkdownView content={chatStreamText} />
                            <span className="stream-cursor" />
                          </>
                        ) : (
                          <span className="typing-dots">
                            <i />
                            <i />
                            <i />
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="composer-wrap">
            <div className="composer">
              {chatNote ? (
                <div className="composer-note">
                  <FileText size={12} />
                  <span title={chatNote.title}>{chatNote.title}</span>
                  <button
                    type="button"
                    onClick={() => setChatNote(null)}
                    aria-label="移除资料"
                    title="移除资料"
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : null}
              <textarea
                ref={textareaRef}
                className="composer-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={`向${ASSISTANT_NAME}提问…`}
                rows={1}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              <div className="composer-foot">
                <span className="composer-agent">
                  <Bot size={13} />
                  {ASSISTANT_NAME}
                </span>
                <span className="composer-mode">
                  <BookOpen size={12} />
                  基于知识库
                </span>
                <span className="composer-hint">Enter 发送 · Shift + Enter 换行</span>
                <button
                  type="button"
                  className="composer-send"
                  disabled={!input.trim() || chatStreaming}
                  onClick={submit}
                  aria-label="发送"
                >
                  {chatStreaming ? <span className="spinner" /> : <ArrowUp size={15} />}
                </button>
              </div>
            </div>
            <div className="composer-note">AI 可能会出错，重要结论请回看来源。</div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="清空当前对话？"
        description="这段对话的消息会被清空，但笔记和整理结果不会受到影响。"
        confirmLabel="清空"
        danger
        onCancel={() => setConfirmClear(false)}
        onConfirm={async () => {
          setConfirmClear(false);
          await clearChat();
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        title="删除这段对话？"
        description={`「${confirmDelete?.title || ''}」的对话记录会被永久删除，笔记不受影响。`}
        confirmLabel="删除对话"
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (!confirmDelete) return;
          const id = confirmDelete.id;
          setConfirmDelete(null);
          await deleteChat(id);
        }}
      />
    </div>
  );
}