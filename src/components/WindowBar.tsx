import { useEffect, useState } from 'react';
import { Copy, Minus, Search, Square, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAppStore } from '../store';
import { Logo } from './Logo';

export function WindowBar() {
  const vault = useAppStore((state) => state.vault);
  const boot = useAppStore((state) => state.boot);
  const setPalette = useAppStore((state) => state.setPalette);
  const [maximized, setMaximized] = useState(false);
  const isMac = boot?.app.platform === 'darwin';

  useEffect(() => {
    void api.window.isMaximized().then(setMaximized).catch(() => {});
    return api.window.onMaximizedChange(setMaximized);
  }, []);

  return (
    <header
      className={`titlebar${isMac ? ' is-mac' : ''}`}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('button, input')) return;
        void api.window.toggleMaximize();
      }}
    >
      <div className="titlebar-brand">
        <Logo size={21} />
        <span className="brand-name">知屿</span>
      </div>
      <div className="titlebar-center">
        {vault ? (
          <button type="button" className="command-entry" onClick={() => setPalette(true)}>
            <Search size={13} strokeWidth={1.8} />
            <span>搜索知识库</span>
            <kbd className="kbd">Ctrl K</kbd>
          </button>
        ) : null}
      </div>
      <div className="win-controls no-drag">
        <button
          type="button"
          className="win-btn"
          aria-label="最小化"
          onClick={() => void api.window.minimize()}
        >
          <Minus size={14} strokeWidth={1.6} />
        </button>
        <button
          type="button"
          className="win-btn"
          aria-label={maximized ? '还原窗口' : '最大化'}
          onClick={async () => setMaximized(await api.window.toggleMaximize())}
        >
          {maximized ? <Copy size={11.5} strokeWidth={1.6} /> : <Square size={11.5} strokeWidth={1.6} />}
        </button>
        <button
          type="button"
          className="win-btn close"
          aria-label="关闭"
          onClick={() => void api.window.close()}
        >
          <X size={15} strokeWidth={1.6} />
        </button>
      </div>
    </header>
  );
}
