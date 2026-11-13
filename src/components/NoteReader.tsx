import { useEffect, useRef, useState } from 'react';
import {
  BookMarked,
  ExternalLink,
  FileWarning,
  FolderSearch,
  Link2,
  MoreHorizontal,
  PencilLine,
  ScrollText,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatBytes, formatShortDate, hostname, relativeTime } from '../lib/format';
import { useAppStore } from '../store';
import type { NoteDetail, NoteMeta } from '../types';
import { ConfirmDialog } from './ConfirmDialog';
import { MarkdownView } from './MarkdownView';

function matchesLink(target: string, note: NoteMeta) {
  const normalized = target
    .replace(/\.md$/i, '')
    .trim()
    .toLowerCase();
  const candidates = [
    note.title,
    ...note.aliases,
    note.path.replace(/\.md$/i, ''),
    note.path.split('/').pop()?.replace(/\.md$/i, '') || '',
  ];
  return candidates.some((value) => value.trim().toLowerCase() === normalized);
}

export function NoteReader({
  note,
  notes,
  onWikiLink,
  onEdit,
  onAsk,
  onOrganize,
  organizing = false,
  onPromote,
  promoting = false,
}: {
  note: NoteDetail;
  notes: NoteMeta[];
  onWikiLink: (target: string) => void;
  onEdit: () => void;
  onAsk: () => void;
  onOrganize?: () => void;
  organizing?: boolean;
  onPromote?: () => void;
  promoting?: boolean;
}) {
  const deleteNote = useAppStore((state) => state.deleteNote);
  const navigate = useAppStore((state) => state.navigate);
  const toast = useAppStore((state) => state.toast);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const backlinks = notes.filter(
    (item) => item.path !== note.path && item.links.some((link) => matchesLink(link, note)),
  );
  const isSystem = note.type === 'system';
  const isRaw = note.type === 'raw';
  const truncated = Boolean(note.truncated);
  const sourceIsUrl = /^https?:\/\//i.test(note.source);

  return (
    <article className="note-shell">
      <div className="reader-top">
        <div className="reader-badges">
          <span className={`type-badge ${note.type}`}>
            <span className={`type-dot ${note.type}`} />
            {note.typeLabel}
          </span>
          {isRaw ? (
            <span className={`status-pill ${note.status === 'processed' ? 'status-done' : 'status-inbox'}`}>
              {note.status === 'processed' ? '已整理' : '待整理'}
            </span>
          ) : null}
        </div>
        <div className="reader-actions">
          {isRaw && onOrganize && !truncated ? (
            <button
              type="button"
              className={`btn btn-sm ${note.status === 'processed' ? 'btn-outline' : 'btn-accent'}`}
              onClick={onOrganize}
              disabled={organizing}
            >
              {organizing ? <span className="spinner" /> : <Sparkles size={13.5} />}
              {note.status === 'processed' ? '重新整理' : 'AI 整理'}
            </button>
          ) : null}
          {isRaw && onPromote && !truncated && note.status !== 'processed' ? (
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={onPromote}
              disabled={promoting}
              title="不调用 AI，直接把原文保存为来源条目"
            >
              {promoting ? <span className="spinner" /> : <BookMarked size={13.5} />}
              {promoting ? '正在入库' : '直接入库'}
            </button>
          ) : null}
          {!isSystem ? (
            <>
              <button type="button" className="btn btn-sm btn-ghost" onClick={onAsk}>
                <ScrollText size={13.5} />
                问 AI
              </button>
              {!truncated ? (
                <button type="button" className="btn btn-sm btn-ghost" onClick={onEdit}>
                  <PencilLine size={13.5} />
                  编辑
                </button>
              ) : null}
            </>
          ) : null}
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="icon-btn"
              aria-label="更多操作"
              onClick={() => setMenuOpen((value) => !value)}
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen ? (
              <div className="menu note-menu">
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    void api.notes.reveal(note.path);
                  }}
                >
                  <FolderSearch size={14} />
                  在文件夹中显示
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={async () => {
                    setMenuOpen(false);
                    try {
                      await navigator.clipboard.writeText(note.path);
                      toast('success', '路径已复制');
                    } catch {
                      toast('error', '没能复制路径');
                    }
                  }}
                >
                  <Link2 size={14} />
                  复制文件路径
                </button>
                {!isSystem ? (
                  <>
                    <div className="menu-sep" />
                    <button
                      type="button"
                      className="menu-item danger"
                      onClick={() => {
                        setMenuOpen(false);
                        setConfirmOpen(true);
                      }}
                    >
                      <Trash2 size={14} />
                      移到回收站
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <h1 className="note-title">{note.title}</h1>
      <div className="note-meta">
        <span>更新于 {relativeTime(note.updated)}</span>
        <span className="meta-sep" />
        {truncated ? (
          <span>只读预览</span>
        ) : (
          <>
            <span>约 {note.readingMinutes} 分钟</span>
            <span className="meta-sep" />
            <span>{note.wordCount} 字</span>
          </>
        )}
        {note.created ? (
          <>
            <span className="meta-sep" />
            <span>创建于 {formatShortDate(note.created)}</span>
          </>
        ) : null}
      </div>

      {note.tags.length ? (
        <div className="tag-row">
          {note.tags.map((tag) => (
            <span key={tag} className="chip">
              #{tag}
            </span>
          ))}
        </div>
      ) : null}

      {truncated ? (
        <div className="large-note-banner">
          <span className="large-note-icon">
            <FileWarning size={16} />
          </span>
          <div className="large-note-main">
            <b>内容较大，当前为只读预览</b>
            <span>
              文件约 {formatBytes(note.size || 0)}，应用只读取了前 12 万字符以避免卡顿；完整文件仍在磁盘上。
            </span>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => void api.notes.reveal(note.path)}
          >
            在文件夹中打开
          </button>
        </div>
      ) : null}

      {isRaw && note.source ? (
        <div className="source-card">
          <span className="source-icon">
            <Link2 size={14} />
          </span>
          <div className="source-main">
            <div className="source-label">来源</div>
            <div className="source-value truncate">{sourceIsUrl ? hostname(note.source) : note.source}</div>
          </div>
          {sourceIsUrl ? (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => void api.app.openExternal(note.source)}
            >
              打开原网页
              <ExternalLink size={12.5} />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="reader-body">
        {note.body.trim() ? (
          <MarkdownView content={note.body} onWikiLink={onWikiLink} />
        ) : (
          <div className="note-empty-body">
            <p>这条笔记还没有内容。</p>
            <button type="button" className="btn btn-sm btn-outline" onClick={onEdit}>
              开始写
            </button>
          </div>
        )}
      </div>

      {backlinks.length ? (
        <section className="backlinks">
          <div className="backlink-head">
            <span>被这些笔记引用</span>
            <span className="backlink-count">{backlinks.length}</span>
          </div>
          <div className="backlink-list">
            {backlinks.map((item) => (
              <button
                key={item.path}
                type="button"
                className="backlink-item"
                onClick={() => navigate('library', item.path)}
              >
                <span className={`type-dot ${item.type}`} />
                <span className="backlink-title">{item.title}</span>
                <span className="backlink-meta">{item.typeLabel}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="移到回收站？"
        description={`《${note.title}》会从知识库移到系统回收站，索引也会同步更新。`}
        confirmLabel="移到回收站"
        danger
        onCancel={() => setConfirmOpen(false)}
        onConfirm={async () => {
          setConfirmOpen(false);
          await deleteNote(note.path);
        }}
      />
    </article>
  );
}
