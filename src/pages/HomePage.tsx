import { useState } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  ClipboardType,
  FilePlus2,
  Inbox,
  LibraryBig,
  Link2,
  ScrollText,
  Sparkles,
} from 'lucide-react';
import { greeting, relativeTime, todayLine } from '../lib/format';
import { useAppStore } from '../store';
import type { NoteType } from '../types';
import { EmptyState } from '../components/EmptyState';

const DISTRIBUTION: { type: NoteType; label: string }[] = [
  { type: 'concept', label: '概念' },
  { type: 'entity', label: '实体' },
  { type: 'source', label: '来源' },
  { type: 'note', label: '笔记' },
];

export function HomePage() {
  const vault = useAppStore((state) => state.vault);
  const notes = useAppStore((state) => state.notes);
  const stats = useAppStore((state) => state.stats);
  const navigate = useAppStore((state) => state.navigate);
  const importDialog = useAppStore((state) => state.importDialog);
  const setModal = useAppStore((state) => state.setModal);
  const setChatDraft = useAppStore((state) => state.setChatDraft);
  const [ask, setAsk] = useState('');

  const wikiNotes = notes.filter((note) => note.type !== 'raw');
  const recent = wikiNotes.slice(0, 5);
  const inboxNotes = notes.filter((note) => note.type === 'raw' && note.status !== 'processed');
  const distribution = DISTRIBUTION.map((item) => ({
    ...item,
    count: wikiNotes.filter((note) => note.type === item.type).length,
  })).filter((item) => item.count > 0);
  const maxCount = Math.max(1, ...distribution.map((item) => item.count));

  const askNow = () => {
    const text = ask.trim();
    if (!text) {
      navigate('chat');
      return;
    }
    setChatDraft(text);
    navigate('chat');
    setAsk('');
  };

  return (
    <div className="page home">
      <header className="page-head home-head">
        <div className="page-head-main">
          <div className="page-eyebrow">{todayLine()}</div>
          <h1 className="home-greeting">{greeting()}</h1>
          <p className="page-subtitle">
            在「{vault?.name}」里，今天想把哪份资料变成自己的知识？
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => setModal('import-text')}
          >
            <ClipboardType size={13.5} />
            粘贴文本
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => void importDialog()}>
            <FilePlus2 size={13.5} />
            导入资料
          </button>
        </div>
      </header>

      <div className="page-body home-body">
        <form
          className="ask-bar"
          onSubmit={(event) => {
            event.preventDefault();
            askNow();
          }}
        >
          <span className="ask-icon">
            <Sparkles size={15} />
          </span>
          <input
            className="ask-input"
            value={ask}
            onChange={(event) => setAsk(event.target.value)}
            placeholder="问知识库任何问题，例如：智能体记忆有哪些分层？"
          />
          <span className="ask-hint">会引用你的笔记</span>
          <button type="submit" className="ask-send" aria-label="提问">
            <ArrowUp size={15} />
          </button>
        </form>

        <div className="stats-row">
          <div className="stat-card">
            <span className="stat-icon raw">
              <Inbox size={15} />
            </span>
            <div className="stat-value">{stats.inbox}</div>
            <div className="stat-label">待整理</div>
            <div className="stat-hint">把资料变成条目</div>
          </div>
          <div className="stat-card">
            <span className="stat-icon concept">
              <LibraryBig size={15} />
            </span>
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">知识条目</div>
            <div className="stat-hint">概念 · 实体 · 来源</div>
          </div>
          <div className="stat-card">
            <span className="stat-icon entity">
              <Activity size={15} />
            </span>
            <div className="stat-value">{stats.week}</div>
            <div className="stat-label">本周更新</div>
            <div className="stat-hint">持续生长的证据</div>
          </div>
        </div>

        <div className="home-grid">
          <div className="home-col-main">
            <section className="hero-card">
              <div className="hero-copy">
                <div className="hero-kicker">
                  <span className="hero-dot" />
                  收件箱
                </div>
                <div className="hero-number">
                  {stats.inbox}
                  <span>份资料{stats.inbox === 1 ? '等你整理' : '等你整理'}</span>
                </div>
                <p className="hero-copy-text">
                  AI 会按你的整理规则提取概念、实体和来源。先看预览，再决定写入。
                </p>
                <div className="hero-actions">
                  <button
                    type="button"
                    className="hero-cta"
                    onClick={() => {
                      if (inboxNotes[0]) navigate('inbox', inboxNotes[0].path);
                      else navigate('inbox');
                    }}
                  >
                    {stats.inbox ? '开始整理' : '打开收件箱'}
                    <ArrowRight size={14} />
                  </button>
                  <button type="button" className="hero-ghost" onClick={() => navigate('inbox')}>
                    查看全部
                  </button>
                </div>
              </div>
              <div className="hero-art" aria-hidden="true">
                <svg viewBox="0 0 270 210" fill="none">
                  <circle cx="196" cy="104" r="76" stroke="rgba(245,239,226,0.11)" />
                  <circle cx="196" cy="104" r="52" stroke="rgba(245,239,226,0.08)" />
                  <circle cx="196" cy="104" r="30" stroke="rgba(245,239,226,0.07)" />
                  <path
                    d="M128 150C152 128 158 94 196 80C226 69 244 48 250 28"
                    stroke="rgba(221,160,92,0.42)"
                    strokeDasharray="2 6"
                  />
                  <path
                    d="M118 66C144 72 160 88 174 104C190 122 214 132 244 136"
                    stroke="rgba(245,239,226,0.18)"
                    strokeDasharray="2 6"
                  />
                  <circle cx="196" cy="80" r="6" fill="#DDA05C" />
                  <circle cx="174" cy="104" r="4" fill="#F5EFE2" opacity="0.72" />
                  <circle cx="244" cy="136" r="3.5" fill="#F5EFE2" opacity="0.5" />
                  <circle cx="250" cy="28" r="3" fill="#DDA05C" opacity="0.6" />
                  <circle cx="128" cy="150" r="2.5" fill="#F5EFE2" opacity="0.4" />
                </svg>
              </div>
            </section>

            <section className="panel recent-panel">
              <div className="panel-head">
                <div>
                  <h2>最近更新</h2>
                  <p>你的知识正在这些链接之间生长。</p>
                </div>
                <button type="button" className="panel-link" onClick={() => navigate('library')}>
                  查看知识库
                  <ChevronRight size={13} />
                </button>
              </div>
              {recent.length ? (
                <div className="recent-list">
                  {recent.map((note) => (
                    <button
                      key={note.path}
                      type="button"
                      className="recent-item"
                      onClick={() => navigate('library', note.path)}
                    >
                      <span className={`type-dot ${note.type}`} />
                      <span className="recent-main">
                        <span className="recent-title">{note.title}</span>
                        <span className="recent-excerpt">{note.excerpt}</span>
                      </span>
                      <span className="recent-time">{relativeTime(note.updated)}</span>
                      <ChevronRight size={13} className="recent-arrow" />
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<LibraryBig size={18} />}
                  title="知识库还是空的"
                  copy="先从收件箱整理第一份资料，或者自己新建一条笔记。"
                  actions={
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => setModal('new-note')}>
                      新建笔记
                    </button>
                  }
                />
              )}
            </section>
          </div>

          <div className="home-col-side">
            <section className="panel distribution-panel">
              <div className="panel-head">
                <div>
                  <h2>知识分布</h2>
                  <p>{stats.total} 个条目，正在连接成网。</p>
                </div>
              </div>
              {distribution.length ? (
                <div className="distribution-list">
                  {distribution.map((item) => (
                    <div key={item.type} className="distribution-row">
                      <span className={`type-dot ${item.type}`} />
                      <span className="distribution-label">{item.label}</span>
                      <span className="distribution-bar">
                        <span
                          className={`distribution-fill ${item.type}`}
                          style={{ width: `${Math.max(8, (item.count / maxCount) * 100)}%` }}
                        />
                      </span>
                      <span className="distribution-count">{item.count}</span>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="distribution-link"
                    onClick={() => navigate('graph')}
                  >
                    在关系图谱中查看
                    <ArrowRight size={12.5} />
                  </button>
                </div>
              ) : (
                <div className="mini-empty">整理第一份资料后，这里会出现知识结构。</div>
              )}
            </section>

            <section className="panel quick-panel">
              <div className="panel-head">
                <div>
                  <h2>快速开始</h2>
                  <p>给知识库添点新东西。</p>
                </div>
              </div>
              <div className="quick-list">
                <button type="button" className="quick-item" onClick={() => setModal('import-url')}>
                  <span className="quick-icon">
                    <Link2 size={14} />
                  </span>
                  <span className="quick-main">
                    <b>添加网页</b>
                    <span>读取正文，存进收件箱</span>
                  </span>
                  <ChevronRight size={13} />
                </button>
                <button type="button" className="quick-item" onClick={() => setModal('import-text')}>
                  <span className="quick-icon">
                    <ClipboardType size={14} />
                  </span>
                  <span className="quick-main">
                    <b>粘贴文本</b>
                    <span>一段摘录、一个想法</span>
                  </span>
                  <ChevronRight size={13} />
                </button>
                <button type="button" className="quick-item" onClick={() => setModal('new-note')}>
                  <span className="quick-icon">
                    <FilePlus2 size={14} />
                  </span>
                  <span className="quick-main">
                    <b>新建笔记</b>
                    <span>直接从空白开始写</span>
                  </span>
                  <ChevronRight size={13} />
                </button>
                <button type="button" className="quick-item" onClick={() => setModal('rules')}>
                  <span className="quick-icon">
                    <ScrollText size={14} />
                  </span>
                  <span className="quick-main">
                    <b>整理规则</b>
                    <span>决定 AI 如何写你的知识</span>
                  </span>
                  <ChevronRight size={13} />
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
