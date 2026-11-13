import { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { AiPreviewModal } from './AiPreviewModal';

export function OrganizeTask() {
  const running = useAppStore((state) => state.organizeRunning);
  const cancelling = useAppStore((state) => state.organizeCancelling);
  const startedAt = useAppStore((state) => state.organizeStartedAt);
  const progress = useAppStore((state) => state.aiProgress);
  const preview = useAppStore((state) => state.organizePreview);
  const cancelOrganize = useAppStore((state) => state.cancelOrganize);
  const setOrganizePreview = useAppStore((state) => state.setOrganizePreview);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running || !startedAt) {
      setElapsed(0);
      return undefined;
    }
    const update = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  return (
    <>
      {running ? (
        <div className="organize-dock" aria-live="polite">
          <div className="organize-dock-head">
            <span className="organize-dock-dot" />
            <b>AI 正在整理</b>
            <button
              type="button"
              className="organize-dock-stop"
              onClick={() => void cancelOrganize()}
              disabled={cancelling}
            >
              {cancelling ? '停止中…' : '停止'}
            </button>
          </div>
          <div className="organize-dock-title" title={progress?.title}>
            {progress?.title || '正在阅读资料'}
          </div>
          <div className="organize-dock-meta">
            <span>
              {progress && progress.total > 1
                ? `第 ${Math.max(1, progress.current)} / ${progress.total} 份`
                : '正在读取与归类'}
            </span>
            <span>已用 {elapsed} 秒</span>
          </div>
          <div className="organize-dock-bar">
            <span />
          </div>
        </div>
      ) : null}
      <AiPreviewModal preview={preview} onClose={() => setOrganizePreview(null)} />
    </>
  );
}
