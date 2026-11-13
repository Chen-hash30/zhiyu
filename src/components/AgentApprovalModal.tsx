import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAppStore } from '../store';
import { Modal } from './Modal';

export function AgentApprovalModal() {
  const approval = useAppStore((state) => state.agentApproval);
  const resolveAgentApproval = useAppStore((state) => state.resolveAgentApproval);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBusy(false);
  }, [approval?.id]);

  const respond = async (approved: boolean) => {
    if (busy) return;
    setBusy(true);
    await resolveAgentApproval(approved);
    setBusy(false);
  };

  return (
    <Modal
      open={Boolean(approval)}
      onClose={() => void respond(false)}
      title="需要你的确认"
      subtitle="知识助手想执行一个外部操作"
      width={520}
      busy={busy}
      footer={
        <>
          <span className="foot-note">确认前不会下载或写入任何内容</span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void respond(false)}
            disabled={busy}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void respond(true)}
            disabled={busy}
          >
            {busy ? <span className="spinner" /> : null}
            {busy ? '处理中…' : '允许保存'}
          </button>
        </>
      }
    >
      {approval ? (
        <div className="approval-body">
          <div className="approval-head">
            <ShieldAlert size={16} />
            <b>{approval.label || '外部操作'}</b>
          </div>
          <p className="approval-summary">{approval.summary}</p>
          {approval.url ? <code className="approval-url">{approval.url}</code> : null}
          <p className="approval-note">
            只会提取网页、PDF、Word 或文本的正文并存入收件箱，不会执行网页里的指令，也不会改动其他文件。
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
