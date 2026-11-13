import { useEffect, useState } from 'react';
import { ArrowRight, FolderOpen, Lock, Sparkles, Waypoints } from 'lucide-react';
import { api } from '../lib/api';
import { useAppStore } from '../store';
import { Logo } from '../components/Logo';

function KnowledgeMap() {
  return (
    <div className="knowledge-map" aria-hidden="true">
      <svg viewBox="0 0 430 132" fill="none">
        <path d="M54 78C104 78 108 34 164 34C214 34 214 82 264 82C314 82 318 44 376 44" stroke="var(--line-strong)" strokeWidth="1" strokeDasharray="3 5" />
        <path d="M164 34C164 74 178 98 226 108C272 118 300 106 334 86" stroke="var(--line-strong)" strokeWidth="1" strokeDasharray="3 5" />
        <circle cx="54" cy="78" r="5.5" fill="var(--raw)" />
        <circle cx="164" cy="34" r="7" fill="var(--concept)" />
        <circle cx="264" cy="82" r="5.5" fill="var(--entity)" />
        <circle cx="376" cy="44" r="5" fill="var(--source)" />
        <circle cx="226" cy="108" r="4.5" fill="var(--muted)" />
        <circle cx="334" cy="86" r="4" fill="var(--concept)" opacity="0.55" />
        <text x="42" y="100" fill="var(--muted)" fontSize="9.5">资料</text>
        <text x="147" y="22" fill="var(--muted)" fontSize="9.5">概念</text>
        <text x="250" y="104" fill="var(--muted)" fontSize="9.5">实体</text>
        <text x="362" y="30" fill="var(--muted)" fontSize="9.5">来源</text>
      </svg>
      <span className="knowledge-map-caption">资料进来，知识长出来</span>
    </div>
  );
}

export function OnboardingPage() {
  const createVault = useAppStore((state) => state.createVault);
  const openVault = useAppStore((state) => state.openVault);
  const recentVaults = useAppStore((state) => state.recentVaults);
  const toast = useAppStore((state) => state.toast);
  const [name, setName] = useState('我的知识库');
  const [parent, setParent] = useState('');
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    api.app
      .defaultLocation()
      .then(setParent)
      .catch(() => {});
  }, []);

  const chooseFolder = async () => {
    setPicking(true);
    try {
      const path = await api.app.chooseFolder();
      if (path) setParent(path);
    } catch (error) {
      toast('error', '没能选择文件夹', error instanceof Error ? error.message : '');
    } finally {
      setPicking(false);
    }
  };

  const create = async () => {
    if (!name.trim() || !parent || busy) return;
    setBusy(true);
    await createVault(parent, name.trim());
    setBusy(false);
  };

  const open = async (path?: string) => {
    if (busy) return;
    setBusy(true);
    await openVault(path);
    setBusy(false);
  };

  return (
    <div className="onboarding">
      <div className="onboarding-glow glow-one" />
      <div className="onboarding-glow glow-two" />
      <div className="onboarding-grid">
        <section className="onboarding-left">
          <div className="onboarding-eyebrow">
            <Logo size={26} />
            <span>知屿 · 本地优先的个人知识库</span>
          </div>
          <h1 className="onboarding-title">
            把散落的资料，
            <br />
            养成一座<span>知识岛</span>。
          </h1>
          <p className="onboarding-lede">
            收集网页、想法和笔记，让 AI 按你的规则整理成概念、实体与来源。
            所有内容都是本地 Markdown 文件，留在你自己的电脑里。
          </p>
          <div className="onboarding-features">
            <div className="onboarding-feature">
              <span className="feature-icon">
                <Sparkles size={15} />
              </span>
              <div>
                <b>资料进来，知识长出来</b>
                <span>先预览，再写入。每次整理都有记录，也能随时回退。</span>
              </div>
            </div>
            <div className="onboarding-feature">
              <span className="feature-icon sage">
                <Waypoints size={15} />
              </span>
              <div>
                <b>连接比收藏更重要</b>
                <span>双向链接、关系图谱和全文搜索，让旧笔记重新被遇见。</span>
              </div>
            </div>
            <div className="onboarding-feature">
              <span className="feature-icon plum">
                <Lock size={15} />
              </span>
              <div>
                <b>数据只在这台电脑上</b>
                <span>纯 Markdown 文件，没有云端锁定，随时可以迁移或备份。</span>
              </div>
            </div>
          </div>
          <KnowledgeMap />
        </section>

        <section className="onboarding-right">
          <div className="onboarding-card">
            <div className="onboarding-card-kicker">开始</div>
            <h2>创建你的知识库</h2>
            <p className="onboarding-card-copy">给它一个名字，选择保存在哪里。剩下的交给知屿。</p>
            <div className="form-stack">
              <label className="field">
                <span className="field-label">名称</span>
                <input
                  className="input"
                  data-autofocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：我的知识库"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void create();
                  }}
                />
              </label>
              <div className="field">
                <span className="field-label">位置</span>
                <button type="button" className="path-picker" onClick={() => void chooseFolder()}>
                  <FolderOpen size={14} />
                  <span className={parent ? '' : 'placeholder'}>{parent || '选择一个文件夹'}</span>
                  <span className="path-picker-action">{picking ? '选择中…' : '更改'}</span>
                </button>
                <span className="field-hint">会在所选位置创建一个文件夹，所有笔记都以 Markdown 保存在本机。</span>
              </div>
              <button
                type="button"
                className="btn btn-primary onboarding-submit"
                disabled={!name.trim() || !parent || busy}
                onClick={() => void create()}
              >
                {busy ? <span className="spinner" /> : null}
                创建并打开
                {!busy ? <ArrowRight size={14} /> : null}
              </button>
            </div>
            <div className="onboarding-divider">
              <span>或者</span>
            </div>
            <button
              type="button"
              className="btn btn-outline onboarding-open"
              disabled={busy}
              onClick={() => void open()}
            >
              <FolderOpen size={14} />
              打开已有文件夹
            </button>
            {recentVaults.length ? (
              <div className="onboarding-recent">
                <div className="onboarding-recent-label">最近打开</div>
                {recentVaults.slice(0, 3).map((path) => (
                  <button
                    key={path}
                    type="button"
                    className="recent-vault"
                    onClick={() => void open(path)}
                    title={path}
                  >
                    <span className="recent-vault-icon">
                      <FolderOpen size={13} />
                    </span>
                    <span className="recent-vault-name">{path.split(/[\\/]/).pop()}</span>
                    <span className="recent-vault-path truncate">{path}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="onboarding-foot">
            <Lock size={11} />
            本地优先 · 不上传笔记 · 支持 Windows
          </div>
        </section>
      </div>
    </div>
  );
}
