import { useEffect, useMemo, useState } from 'react';
import { FilePlus2, LibraryBig, Search, Sparkles } from 'lucide-react';
import { relativeTime } from '../lib/format';
import { createSearch, searchNotes } from '../lib/search';
import { useAppStore } from '../store';
import type { NoteMeta, NoteType } from '../types';
import { EmptyState } from '../components/EmptyState';
import { NoteEditor } from '../components/NoteEditor';
import { NoteReader } from '../components/NoteReader';

const FILTERS: { value: 'all' | NoteType; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'concept', label: '概念' },
  { value: 'entity', label: '实体' },
  { value: 'source', label: '来源' },
  { value: 'note', label: '笔记' },
];

const GROUP_ORDER: { type: NoteType; label: string }[] = [
  { type: 'concept', label: '概念' },
  { type: 'entity', label: '实体' },
  { type: 'source', label: '来源' },
  { type: 'note', label: '笔记' },
];

function NoteSkeleton() {
  return (
    <div className="detail-scroll">
      <div className="note-shell">
        <div className="skeleton" style={{ width: 84, height: 11, marginBottom: 18 }} />
        <div className="skeleton" style={{ width: '58%', height: 30, marginBottom: 12 }} />
        <div className="skeleton" style={{ width: 220, height: 11, marginBottom: 34 }} />
        {[100, 96, 88, 99, 74].map((width, index) => (
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

export function LibraryPage() {
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
  const setModal = useAppStore((state) => state.setModal);
  const setChatDraft = useAppStore((state) => state.setChatDraft);
  const setChatNote = useAppStore((state) => state.setChatNote);
  const toast = useAppStore((state) => state.toast);
  const [filter, setFilter] = useState<'all' | NoteType>('all');
  const [query, setQuery] = useState('');

  const wikiNotes = useMemo(() => notes.filter((item) => item.type !== 'raw'), [notes]);
  const index = useMemo(() => createSearch(wikiNotes), [wikiNotes]);
  const searched = useMemo(
    () => (query.trim() ? searchNotes(index, query) : []),
    [query, index],
  );

  const filtered = useMemo(() => {
    const source = query.trim() ? searched : wikiNotes;
    return source.filter((item) => filter === 'all' || item.type === filter);
  }, [query, searched, wikiNotes, filter]);

  const groups = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        ...group,
        items: filtered.filter((item) => item.type === group.type),
      })).filter((group) => group.items.length),
    [filtered],
  );

  useEffect(() => {
    if (editing) return;
    const current = wikiNotes.find((item) => item.path === activePath);
    if (current) return;
    if (note?.type === 'system' && activePath) return;
    const safe = wikiNotes.find((item) => !isLargeMeta(item));
    if (safe) selectNote(safe.path);
  }, [activePath, editing, note?.type, selectNote, wikiNotes]);

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
      selectNote(found.path);
    } else {
      toast('info', '还没有这条笔记', `知识库里还没有《${target}》。可以在整理规则中让 AI 下次补上。`);
    }
  };

  const renderItem = (item: NoteMeta) => (
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
      {item.tags.length ? (
        <div className="note-item-foot">
          <span className="note-item-tag">#{item.tags.slice(0, 3).join(' · #')}</span>
        </div>
      ) : null}
      {item.truncated ? (
        <div className="note-item-foot">
          <span className="chip chip-raw">大文件 · 只读预览</span>
        </div>
      ) : null}
    </button>
  );

  return (
    <div className="page page-split">
      <header className="page-head">
        <div className="page-head-main">
          <div className="page-eyebrow">沉淀</div>
          <h1 className="page-title">
            知识库
            <span className="title-count neutral">{stats.total}</span>
          </h1>
          <p className="page-subtitle">
            {stats.total
              ? `${stats.total} 个条目，彼此连接。慢一点读，快一点找。`
              : '整理后的概念、实体和来源都会安静地住在这里。'}
          </p>
        </div>
        <div className="page-actions">
          {stats.inbox > 0 ? (
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => navigate('inbox')}
            >
              <Sparkles size={13.5} />
              整理收件箱
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => setModal('new-note')}
          >
            <FilePlus2 size={13.5} />
            新建笔记
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
                placeholder="搜索标题、标签或摘要…"
              />
            </div>
            <div className="filter-row">
              {FILTERS.map((item) => {
                const count =
                  item.value === 'all'
                    ? wikiNotes.length
                    : wikiNotes.filter((noteItem) => noteItem.type === item.value).length;
                if (!count && item.value !== 'all' && filter !== item.value) return null;
                return (
                  <button
                    key={item.value}
                    type="button"
                    className={`filter-chip${filter === item.value ? ' active' : ''}`}
                    onClick={() => setFilter(item.value)}
                  >
                    {item.label} <span>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="list-scroll">
            {filtered.length ? (
              query.trim() || filter !== 'all' ? (
                filtered.map(renderItem)
              ) : (
                groups.map((group) => (
                  <div key={group.type}>
                    <div className="list-section">
                      <span>{group.label}</span>
                      <span>{group.items.length}</span>
                    </div>
                    {group.items.map(renderItem)}
                  </div>
                ))
              )
            ) : (
              <div className="list-empty">
                {query ? '没有找到相关笔记' : '还没有知识条目'}
              </div>
            )}
          </div>
        </aside>

        <section className="detail-pane">
          {noteLoading ? (
            <NoteSkeleton />
          ) : note && note.type !== 'raw' ? (
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
                    setChatDraft(`关于《${note.title}》，这篇笔记有哪些相关观点？`);
                    navigate('chat');
                  }}
                />
              </div>
            )
          ) : (
            <div className="detail-empty">
              <EmptyState
                icon={<LibraryBig size={19} />}
                tone="sage"
                title={wikiNotes.length ? '选择一条笔记' : '知识库还是空的'}
                copy={
                  wikiNotes.length
                    ? '在左侧选择一条笔记开始阅读，或者新建一条。'
                    : '先把资料放进收件箱，整理后它们会在这里长成概念、实体和来源。'
                }
                actions={
                  <>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() => setModal('new-note')}
                    >
                      <FilePlus2 size={13.5} />
                      新建笔记
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => navigate('inbox')}
                    >
                      打开收件箱
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
