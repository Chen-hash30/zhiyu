import { Component, useEffect, type ReactNode } from 'react';
import { useAppStore } from './store';
import { WindowBar } from './components/WindowBar';
import { Sidebar } from './components/Sidebar';
import { ToastStack } from './components/ToastStack';
import { CommandPalette } from './components/CommandPalette';
import { GlobalModals } from './components/GlobalModals';
import { Logo } from './components/Logo';
import { OnboardingPage } from './pages/OnboardingPage';
import { HomePage } from './pages/HomePage';
import { InboxPage } from './pages/InboxPage';
import { LibraryPage } from './pages/LibraryPage';
import { ChatPage } from './pages/ChatPage';
import { GraphPage } from './pages/GraphPage';
import { TrashPage } from './pages/TrashPage';
import { SettingsPage } from './pages/SettingsPage';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('[知屿]', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-screen">
          <Logo size={44} />
          <h1>这一页遇到了一点问题</h1>
          <p>知识库文件没有受到影响。重新加载后可以继续。</p>
          <pre>{this.state.error.message}</pre>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function CurrentPage() {
  const page = useAppStore((state) => state.page);
  switch (page) {
    case 'inbox':
      return <InboxPage />;
    case 'library':
      return <LibraryPage />;
    case 'chat':
      return <ChatPage />;
    case 'graph':
      return <GraphPage />;
    case 'trash':
      return <TrashPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <HomePage />;
  }
}

export function App() {
  const ready = useAppStore((state) => state.ready);
  const boot = useAppStore((state) => state.boot);
  const vault = useAppStore((state) => state.vault);
  const settings = useAppStore((state) => state.settings);
  const init = useAppStore((state) => state.init);
  const bindEvents = useAppStore((state) => state.bindEvents);
  const syncRoute = useAppStore((state) => state.syncRoute);
  const setPalette = useAppStore((state) => state.setPalette);
  const setModal = useAppStore((state) => state.setModal);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => bindEvents(), [bindEvents]);

  useEffect(() => {
    const onRoute = () => syncRoute();
    window.addEventListener('hashchange', onRoute);
    window.addEventListener('popstate', onRoute);
    return () => {
      window.removeEventListener('hashchange', onRoute);
      window.removeEventListener('popstate', onRoute);
    };
  }, [syncRoute]);

  useEffect(() => {
    const theme = settings?.theme || 'light';
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
    };
    apply();
    if (theme === 'system') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
    return undefined;
  }, [settings?.theme]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (vault) setPalette(true);
      }
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        if (vault) setModal('new-note');
      }
      if (mod && event.key === ',') {
        event.preventDefault();
        if (vault) useAppStore.getState().navigate('settings');
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setModal, setPalette, vault]);

  if (!ready) {
    return (
      <div className="app">
        <WindowBar />
        <div className="splash">
          <div className="splash-mark">
            <Logo size={46} />
          </div>
          <div className="splash-text">正在打开知屿</div>
        </div>
      </div>
    );
  }

  if (!boot?.vault) {
    return (
      <div className="app">
        <WindowBar />
        <div className="onboarding-wrap">
          <OnboardingPage />
        </div>
        <ToastStack />
      </div>
    );
  }

  return (
    <div className="app">
      <WindowBar />
      <div className="app-body">
        <Sidebar />
        <main className="main">
          <ErrorBoundary>
            <CurrentPage />
          </ErrorBoundary>
        </main>
      </div>
      <CommandPalette />
      <GlobalModals />
      <ToastStack />
    </div>
  );
}
