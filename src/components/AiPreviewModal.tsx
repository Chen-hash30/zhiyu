import { useEffect, useMemo, useState } from 'react';
import { Check, FilePlus2, FilePenLine, Sparkles } from 'lucide-react';
import { useAppStore } from '../store';
import type { OrganizePreview } from '../types';
import { MarkdownView } from './MarkdownView';
import { Modal } from './Modal';

export function AiPreviewModal({
  preview,
  onClose,
}: {
  preview: OrganizePreview | null;
  onClose: () => void;
}) {
  const applyOrganize = useAppStore((state) => state.applyOrganize);
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<'body' | 'diff'>('body');
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    setSelected(0);
    setTab('body');
    setApplying(false);
  }, [preview?.id]);

  const flat = useMemo(
    () =>
      preview
        ? preview.proposals.flatMap((proposal) =>
            proposal.pages.map((page) => ({ proposal, page })),
          )
        : [],
    [preview],
  );

  if (!preview) return null;
  const current = flat[Math.min(selected, flat.length - 1)];
  if (!current) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title="整理预览"
      subtitle={`${preview.stats.pages} 个条目 · 新增 ${preview.stats.creates} · 更新 ${preview.stats.updates}`}
      width={1050}
      className="modal-preview"
      bodyClassName="preview-modal-body"
      busy={applying}
      footer={
        <>
          <span className="foot-note">写入后会同步更新索引与整理日志</span>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={applying}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={applying}
            onClick={async () => {
              setApplying(true);
              const result = await applyOrganize(preview.id);
              setApplying(false);
              if (result) onClose();
            }}
          >
            {applying ? <span className="spinner" /> : <Check size={14} />}
            {applying ? '正在写入…' : `写入知识库 · ${preview.stats.pages}`}
          </button>
        </>
      }
    >
      <div className="preview-grid">
        <aside className="preview-list">
          {preview.proposals.map((proposal) => (
            <div key={proposal.rawPath}>
              <div className="preview-source">
                <span className="preview-source-label">来自资料</span>
                <span className="preview-source-title truncate">{proposal.rawTitle}</span>
              </div>
              {proposal.pages.map((page) => {
                const flatIndex = flat.findIndex(
                  (item) => item.proposal.rawPath === proposal.rawPath && item.page.path === page.path,
                );
                return (
                  <button
                    key={page.path}
                    type="button"
                    className={`preview-list-item${selected === flatIndex ? ' active' : ''}`}
                    onClick={() => {
                      setSelected(flatIndex);
                      setTab('body');
                    }}
                  >
                    <span className={`preview-action ${page.action}`}>
                      {page.action === 'create' ? <FilePlus2 size={12} /> : <FilePenLine size={12} />}
                      {page.action === 'create' ? '新增' : '更新'}
                    </span>
                    <span className="preview-item-title">{page.title}</span>
                    <span className="preview-item-path">{page.path.replace(/\.md$/, '')}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </aside>
        <section className="preview-main">
          <div className="preview-main-head">
            <div className="preview-main-title-row">
              <span className={`type-dot ${current.page.type}`} />
              <h3>{current.page.title}</h3>
              <span className={`preview-action ${current.page.action}`}>
                {current.page.action === 'create' ? '新增' : '更新'}
              </span>
            </div>
            <div className="preview-tabs">
              <button
                type="button"
                className={tab === 'body' ? 'active' : ''}
                onClick={() => setTab('body')}
              >
                整理后
              </button>
              {current.page.action === 'update' && current.page.diff ? (
                <button
                  type="button"
                  className={tab === 'diff' ? 'active' : ''}
                  onClick={() => setTab('diff')}
                >
                  改动
                </button>
              ) : null}
            </div>
          </div>
          <div className="preview-content">
            {tab === 'body' ? (
              <div className="preview-markdown">
                <MarkdownView content={current.page.body} compact />
              </div>
            ) : (
              <pre className="diff-view">
                {current.page.diff.split('\n').map((line, index) => {
                  let className = 'diff-line';
                  if (line.startsWith('@@')) className += ' hunk';
                  else if (line.startsWith('+++') || line.startsWith('---')) className += ' file';
                  else if (line.startsWith('+')) className += ' add';
                  else if (line.startsWith('-')) className += ' remove';
                  return (
                    <div key={`${index}-${line.slice(0, 12)}`} className={className}>
                      {line || ' '}
                    </div>
                  );
                })}
              </pre>
            )}
          </div>
          <div className="preview-main-foot">
            <span className={`type-badge ${current.page.type}`}>
              <span className={`type-dot ${current.page.type}`} />
              {current.page.path}
            </span>
            {current.page.tags.length ? (
              <span className="preview-tags">
                {current.page.tags.map((tag) => (
                  <span key={tag} className="chip">
                    #{tag}
                  </span>
                ))}
              </span>
            ) : null}
            <span className="preview-ai">
              <Sparkles size={12} /> 由 AI 按整理规则生成
            </span>
          </div>
        </section>
      </div>
    </Modal>
  );
}
