import { useEffect, useState } from 'react';
import { ClipboardType, FilePlus2, Link2, ScrollText } from 'lucide-react';
import { api } from '../lib/api';
import { useAppStore } from '../store';
import { Modal } from './Modal';

export function GlobalModals() {
  const modal = useAppStore((state) => state.modal);
  const setModal = useAppStore((state) => state.setModal);
  const createNote = useAppStore((state) => state.createNote);
  const importUrl = useAppStore((state) => state.importUrl);
  const importText = useAppStore((state) => state.importText);
  const toast = useAppStore((state) => state.toast);
  const close = () => setModal(null);

  return (
    <>
      <NewNoteModal
        open={modal === 'new-note'}
        onClose={close}
        onCreate={async (type, title) => {
          const note = await createNote({ type, title });
          if (note) close();
        }}
      />
      <UrlModal
        open={modal === 'import-url'}
        onClose={close}
        onImport={async (url) => {
          const note = await importUrl(url);
          if (note) close();
        }}
      />
      <TextModal
        open={modal === 'import-text'}
        onClose={close}
        onImport={async (input) => {
          const note = await importText(input);
          if (note) close();
        }}
      />
      <RulesModal
        open={modal === 'rules'}
        onClose={close}
        onSaved={() => {
          toast('success', '整理规则已更新', '下一次整理会按新的规则执行。');
          close();
        }}
      />
    </>
  );
}

function NewNoteModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (type: string, title: string) => Promise<void>;
}) {
  const [type, setType] = useState('concept');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setType('concept');
      setTitle('');
      setBusy(false);
    }
  }, [open]);

  const options = [
    { value: 'concept', label: '概念', hint: '一个想法、方法或原理' },
    { value: 'entity', label: '实体', hint: '人物、产品、组织或书籍' },
    { value: 'source', label: '来源', hint: '对一份资料的要点总结' },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建笔记"
      subtitle="先起一个名字，内容可以慢慢补。"
      width={500}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!title.trim() || busy}
            onClick={async () => {
              if (!title.trim()) return;
              setBusy(true);
              await onCreate(type, title.trim());
              setBusy(false);
            }}
          >
            {busy ? <span className="spinner" /> : <FilePlus2 size={14} />}
            创建并编辑
          </button>
        </>
      }
    >
      <div className="form-stack">
        <div className="field">
          <span className="field-label">类型</span>
          <div className="type-choice-grid">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`type-choice${type === option.value ? ' active' : ''}`}
                onClick={() => setType(option.value)}
              >
                <span className={`type-dot ${option.value}`} />
                <span className="type-choice-label">{option.label}</span>
                <span className="type-choice-hint">{option.hint}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="field-label">标题</span>
          <input
            className="input"
            data-autofocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：渐进式总结"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && title.trim() && !busy) {
                setBusy(true);
                void onCreate(type, title.trim()).finally(() => setBusy(false));
              }
            }}
          />
        </label>
      </div>
    </Modal>
  );
}

function UrlModal({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (url: string) => Promise<void>;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setUrl('');
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    await onImport(url.trim());
    setBusy(false);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="modal-title-inline">
          <Link2 size={15} /> 添加网页
        </span>
      }
      subtitle="知屿会读取网页正文，存进收件箱，等待整理。"
      width={520}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!url.trim() || busy}
            onClick={() => void submit()}
          >
            {busy ? <span className="spinner" /> : <Link2 size={14} />}
            {busy ? '正在读取…' : '读取网页'}
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">网页链接</span>
        <input
          className="input"
          data-autofocus
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.com/article"
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
        />
        <span className="field-hint">支持大多数公开网页。需要登录或完全依赖脚本渲染的页面可能读取不到。</span>
      </label>
    </Modal>
  );
}

function TextModal({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (input: { title: string; content: string; source?: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle('');
      setContent('');
      setSource('');
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    if (!content.trim() || busy) return;
    setBusy(true);
    await onImport({ title: title.trim(), content: content.trim(), source: source.trim() });
    setBusy(false);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="modal-title-inline">
          <ClipboardType size={15} /> 粘贴文本
        </span>
      }
      subtitle="一段摘录、一个想法，或从别处复制来的内容。"
      width={640}
      busy={busy}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!content.trim() || busy}
            onClick={() => void submit()}
          >
            {busy ? <span className="spinner" /> : <ClipboardType size={14} />}
            收进收件箱
          </button>
        </>
      }
    >
      <div className="form-stack">
        <div className="form-row">
          <label className="field">
            <span className="field-label">标题（可选）</span>
            <input
              className="input"
              data-autofocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="留空时会自动取第一行"
            />
          </label>
          <label className="field">
            <span className="field-label">来源（可选）</span>
            <input
              className="input"
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder="书名、网址或备注"
            />
          </label>
        </div>
        <label className="field">
          <span className="field-label">内容</span>
          <textarea
            className="textarea input-content"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="把想留下的内容贴在这里…"
          />
        </label>
      </div>
    </Modal>
  );
}

function RulesModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const toast = useAppStore((state) => state.toast);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.notes
      .read('AGENTS.md')
      .then((note) => setBody(note.body))
      .catch((error) => toast('error', '没能读取整理规则', error instanceof Error ? error.message : ''))
      .finally(() => setLoading(false));
  }, [open, toast]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="modal-title-inline">
          <ScrollText size={15} /> 整理规则
        </span>
      }
      subtitle="这份文件会随每次整理一起交给 AI。写得越具体，整理结果越稳定。"
      width={780}
      busy={busy}
      footer={
        <>
          <span className="foot-note">对应知识库根目录的 AGENTS.md</span>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!body.trim() || busy || loading}
            onClick={async () => {
              setBusy(true);
              try {
                await api.notes.save('AGENTS.md', { body });
                onSaved();
              } catch (error) {
                toast('error', '规则没有保存', error instanceof Error ? error.message : '');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <span className="spinner" /> : null}
            保存规则
          </button>
        </>
      }
    >
      {loading ? (
        <div className="rules-loading">
          <span className="spinner" /> 正在读取…
        </div>
      ) : (
        <textarea
          className="textarea rules-editor"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          spellCheck={false}
        />
      )}
    </Modal>
  );
}
