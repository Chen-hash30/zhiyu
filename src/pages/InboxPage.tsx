import { useEffect, useMemo, useState } from 'react';
import {
  ClipboardType,
  FilePlus2,
  Inbox,
  Link2,
  Search,
  Sparkles,
} from 'lucide-react';
import { relativeTime } from '../lib/format';
import { useAppStore } from '../store';
import type { NoteMeta } from '../types';
import { EmptyState } from '../components/EmptyState';
import { NoteEditor } from '../components/NoteEditor';
import { NoteReader } from '../components/NoteReader';

function NoteSkeleton() {
  return (
    <div className="detail-scroll">
      <div className="note-shell">
        <div className="skeleton" style={{ width: 90, height: 11, marginBottom: 18 }} />
        <div className="skeleton" style={{ width: '62%', height: 30, marginBottom: 12 }} />
        <div className="skeleton" style={{ width: 210, height: 11, marginBottom: 34 }} />
        {[100, 94, 97, 70, 98, 88].map((width, index) => (
          <div
            key={index}
            className="skeleton"
            style={{ width: `${width}%`, height: 13, marginBottom: 12 }}
          />
        ))}
      </div>
    </div>
  );
}

function isLargeMeta(note: NoteMeta) {
  return Boolean(note.truncated) || (note.size || 0) > 1_000_000;
}

export function InboxPage() {
  const notes = useAppStore((state) => state.notes);
  const stats = useAppStore((state) => state.stats);
  const activePath = useAppStore((state) => state.activePath);
  const note = useAppStore((state) => state.note);
  const noteLoading = useAppStore((state) => state.noteLoading);
  const editing = useAppStore((state) => state.editing);
  const selectNote = useAppStore((state) => state.selectNote);
  const navigate = useAppStore((state) => state.navigate);
  const setEditor = useAppStore((state) => state.setEditor);
  const saveNote = useAppStore((state) => state.saveNote);
  const importDialog = useAppStore((state) => state.importDialog);
  const setModal = useAppStore((state) => state.setModal);
  const setChatDraft = useAppStore((state) => state.setChatDraft);
  const setChatNote = useAppStore((state) => state.setChatNote);
  const organize = useAppStore((state) => state.organize);
  const promoteRaw = useAppStore((state) => state.promoteRaw);
  const organizeRunning = useAppStore((state) => state.organizeRunning);
  const toast = useAppStore((state) => state.toast);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [query, setQuery] = useState('');
  const [promoting, setPromoting] = useState(false);

  const rawNotes = useMemo(() => notes.filter((item) => item.type === 'raw'), [notes]);
  const pendingNotes = rawNotes.filter((item) => item.status !== 'processed');
  const visible = (filter === 'pending' ? pendingNotes : rawNotes).filter((item) => {
    const text = query.trim().toLowerCase();
    if (!text) return true;
    return `${item.title} ${item.excerpt} ${item.source}`.toLowerCase().includes(text);
  });

  useEffect(() => {
    if (organizeRunning) return;
    const current = rawNotes.find((item) => item.path === activePath);
    if (!current && !editing && visible.length) {
      const safe = visible.find((item) => !isLargeMeta(item));
      if (safe) selectNote(safe.path);
    }
  }, [activePath, editing, organizeRunning, rawNotes, selectNote, visible]);

  const resolveLink = (target: string) => {
    const normalized = target.replace(/\.md$/i, '').trim().toLowerCase();
    const found = notes.find((item) => {
      const candidates = [
        item.title,
        ...item.aliases,
        item.path.replace(/\.md$/i, ''),
        item.path.split('/').pop()?.replace(/\.md$/i, '') || '',
      ];
      return candidates.some((value) => value.trim().toLowerCase() === normalized);
    });
    if (found) {
      navigate('library', found.path);
    } else {
      toast('info', '还没有这条笔记', `知识库里还没有《${target}》，整理后会出现在这里。`);
    }
  };

  const startOrganize = (paths: string[]) => {
    if (!paths.length || organizeRunning) return;
    void organize(paths);
  };

  const promote = async (path: string) => {
    if (promoting) return;
    setPromoting(true);
    try {
      await promoteRaw(path);
    } finally {
      setPromoting(false);
    }
  };

  const selectedIsRaw = note?.type === 'raw';

  return (
    <div className="page page-split">
      <header className="page-head">
        <div className="page-head-main">
          <div className="page-eyebrow">收集</div>
          <h1 className="page-title">
            收件箱
            {stats.inbox > 0 ? <span className="title-count">{stats.inbox}</span> : null}
          </h1>
          <p className="page-subtitle">
            {stats.inbox
              ? `${stats.inbox} 份资料等待整理。先收集，再让知识慢慢成形。`
              : '收件箱已经清空。新的资料会先来到这里。'}
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setModal('import-text')}
          >
            <ClipboardType size={13.5} />
            粘贴文本
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => setModal('import-url')}
          >
            <Link2 size={13.5} />
            添加网页
          </button>
          {pendingNotes.length > 1 ? (
            <button
              type="button"
              className="btn btn-sm btn-outline"
              disabled={organizeRunning}
              onClick={() => void startOrganize(pendingNotes.map((item) => item.path))}
            >
              <Sparkles size={13.5} />
              整理全部
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => void importDialog()}
          >
            <FilePlus2 size={13.5} />
            导入资料
          </button>
        </div>
      </header>

      <div className="split-body">
        <aside className="list-pane">
          <div className="list-toolbar">
            <div className="search-field">
              <Search size={13} />
              <input
                className="input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索收件箱…"
              />
            </div>
            <div className="filter-row">
              <button
                type="button"
                className={`filter-chip${filter === 'pending' ? ' active' : ''}`}
                onClick={() => setFilter('pending')}
              >
                待整理 <span>{pendingNotes.length}</span>
              </button>
              <button
                type="button"
                className={`filter-chip${filter === 'all' ? ' active' : ''}`}
                onClick={() => setFilter('all')}
              >
                全部 <span>{rawNotes.length}</span>
              </button>
            </div>
          </div>
          <div className="list-scroll">
            {visible.length ? (
              visible.map((item: NoteMeta) => (
                <button
                  key={item.path}
                  type="button"
                  className={`note-item${activePath === item.path ? ' active' : ''}`}
                  onClick={() => selectNote(item.path)}
                >
                  <div className="note-item-top">
                    <span className={`type-dot ${item.type}`} />
                    <span className="note-item-title">{item.title}</span>
                    <span className="note-item-time">{relativeTime(item.updated)}</span>
                  </div>
                  <div className="note-item-excerpt">{item.excerpt || '还没有内容'}</div>
                  <div className="note-item-foot">
                    <span
                      className={`status-pill ${item.status === 'processed' ? 'status-done' : 'status-inbox'}`}
                    >
                      {item.status === 'processed' ? '已整理' : '待整理'}
                    </span>
                    {item.truncated ? (
                      <span className="chip chip-raw">大文件 · 只读预览</span>
                    ) : null}
                    {item.source ? (
                      <span className="note-item-tag truncate">
                        {/^https?:/i.test(item.source)
                          ? item.source.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
                          : item.source.split(/[\\/]/).pop()}
                      </span>
                    ) : null}
                  </div>
                </button>
              ))
            ) : (
              <div className="list-empty">
                {query ? '没有找到相关资料' : filter === 'pending' ? '这里已经清空了' : '还没有资料'}
              </div>
            )}
          </div>
        </aside>

        <section className="detail-pane">
          {noteLoading ? (
            <NoteSkeleton />
          ) : selectedIsRaw && note ? (
            editing ? (
              <NoteEditor note={note} onSave={saveNote} onDone={() => setEditor(false)} />
            ) : (
              <div className="detail-scroll">
                <NoteReader
                  note={note}
                  notes={notes}
                  onWikiLink={resolveLink}
                  onEdit={() => setEditor(true)}
                  onAsk={() => {
                    setChatNote({ path: note.path, title: note.title, type: note.type });
                    setChatDraft(`关于《${note.title}》，这份资料有哪些关键要点？`);
                    navigate('chat');
                  }}
                  onOrganize={() => void startOrganize([note.path])}
                  organizing={organizeRunning}
                  onPromote={() => void promote(note.path)}
                  promoting={promoting}
                />
              </div>
            )
          ) : (
            <div className="detail-empty">
              <EmptyState
                icon={<Inbox size={19} />}
                title={rawNotes.length ? '选择一份资料' : '收件箱是空的'}
                copy={
                  rawNotes.length
                    ? '在左侧选择一份资料，查看内容或让 AI 整理成知识条目。'
                    : '把网页、文件或一段想法放进来。知屿会先把它们安静地收在这里。'
                }
                actions={
                  <>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() => setModal('import-url')}
                    >
                      <Link2 size={13.5} />
                      添加网页
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() => setModal('import-text')}
                    >
                      <ClipboardTextIcon />
                      粘贴文本
                    </button>
                  </>
                }
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ClipboardTextIcon() {
  return <ClipboardType size={13.5} />;
}
