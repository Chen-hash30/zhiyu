import { useEffect, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { relativeTime } from '../lib/format';
import { useAppStore } from '../store';
import type { TrashEntry } from '../types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';

const TYPE_LABEL: Record<string, string> = {
  raw: '资料',
  concept: '概念',
  entity: '实体',
  source: '来源',
  note: '笔记',
};

export function TrashPage() {
  const entries = useAppStore((state) => state.trashEntries);
  const trashCount = useAppStore((state) => state.trashCount);
  const loadTrash = useAppStore((state) => state.loadTrash);
  const restoreTrash = useAppStore((state) => state.restoreTrash);
  const deleteTrashPermanently = useAppStore((state) => state.deleteTrashPermanently);
  const emptyTrash = useAppStore((state) => state.emptyTrash);
  const [pendingDelete, setPendingDelete] = useState<TrashEntry | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadTrash();
  }, [loadTrash]);

  return (
    <div className="page trash-page">
      <header className="page-head">
        <div className="page-head-main">
          <div className="page-eyebrow">恢复</div>
          <h1 className="page-title">
            回收站
            {trashCount > 0 ? <span className="title-count neutral">{trashCount}</span> : null}
          </h1>
          <p className="page-subtitle">删除的笔记会先放在这里，确认不再需要后再永久删除。</p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={!entries.length}
            onClick={() => setConfirmEmpty(true)}
          >
            <Trash2 size={13.5} />
            清空回收站
          </button>
        </div>
      </header>

      <div className="page-body trash-body">
        {entries.length ? (
          <div className="trash-list">
            {entries.map((entry) => (
              <div key={entry.id} className="trash-item">
                <span className={`type-dot ${entry.type}`} />
                <div className="trash-main">
                  <div className="trash-title-row">
                    <span className="trash-title">{entry.title}</span>
                    <span className={`type-badge ${entry.type}`}>
                      {TYPE_LABEL[entry.type] || '笔记'}
                    </span>
                  </div>
                  <div className="trash-path">{entry.originalPath}</div>
                </div>
                <span className="trash-time">{relativeTime(entry.deletedAt)}</span>
                <div className="trash-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      await restoreTrash(entry.id);
                      setBusy(false);
                    }}
                  >
                    <RotateCcw size={13} />
                    恢复
                  </button>
                  <button
                    type="button"
                    className="icon-btn trash-delete"
                    aria-label="永久删除"
                    disabled={busy}
                    onClick={() => setPendingDelete(entry)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="trash-empty-wrap">
            <EmptyState
              icon={<Trash2 size={19} />}
              tone="plum"
              title="回收站是空的"
              copy="在笔记的更多操作里选择「移到回收站」，删除的内容会先出现在这里。"
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="永久删除这条笔记？"
        description={`《${pendingDelete?.title || ''}》会从磁盘上删除，无法再恢复。`}
        confirmLabel="永久删除"
        danger
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          const id = pendingDelete.id;
          setPendingDelete(null);
          setBusy(true);
          await deleteTrashPermanently(id);
          setBusy(false);
        }}
      />

      <ConfirmDialog
        open={confirmEmpty}
        title="清空回收站？"
        description={`回收站里的 ${entries.length} 条笔记都会被永久删除，无法恢复。`}
        confirmLabel="全部永久删除"
        danger
        busy={busy}
        onCancel={() => setConfirmEmpty(false)}
        onConfirm={async () => {
          setConfirmEmpty(false);
          setBusy(true);
          await emptyTrash();
          setBusy(false);
        }}
      />
    </div>
  );
}