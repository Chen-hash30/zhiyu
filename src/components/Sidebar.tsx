import { useEffect, useRef, useState } from 'react';
import {
  ChevronsUpDown,
  FolderOpen,
  Inbox,
  LayoutGrid,
  LibraryBig,
  Lock,
  MessagesSquare,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  Sun,
  Trash2,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAppStore } from '../store';
import { Logo } from './Logo';

const NAV = [
  { page: 'home' as const, label: '概览', icon: LayoutGrid },
  { page: 'inbox' as const, label: '收件箱', icon: Inbox },
  { page: 'library' as const, label: '知识库', icon: LibraryBig },
  { page: 'chat' as const, label: '对话', icon: MessagesSquare },
  { page: 'graph' as const, label: '关系图谱', icon: Network },
  { page: 'trash' as const, label: '回收站', icon: Trash2 },
];

function currentDark(theme: string) {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function Sidebar() {
  const vault = useAppStore((state) => state.vault);
  const stats = useAppStore((state) => state.stats);
  const trashCount = useAppStore((state) => state.trashCount);
  const page = useAppStore((state) => state.page);
  const activePath = useAppStore((state) => state.activePath);
  const notes = useAppStore((state) => state.notes);
  const settings = useAppStore((state) => state.settings);
  const navigate = useAppStore((state) => state.navigate);
  const selectNote = useAppStore((state) => state.selectNote);
  const openVault = useAppStore((state) => state.openVault);
  const setTheme = useAppStore((state) => state.setTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => window.localStorage.getItem('zhiyu.sidebarCollapsed') === '1',
  );
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.localStorage.setItem('zhiyu.sidebarCollapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  if (!vault) return null;

  const recent = notes.filter((note) => note.type !== 'raw').slice(0, 4);
  const dark = currentDark(settings?.theme || 'light');

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-top">
        <div ref={menuRef} className="vault-wrap">
          <button
            type="button"
            className="vault-switch"
            onClick={() => setMenuOpen((value) => !value)}
            title={collapsed ? vault.name : undefined}
          >
            <span className="vault-avatar">
              <Logo size={24} />
            </span>
            <span className="vault-meta">
              <span className="vault-name">{vault.name}</span>
              <span className="vault-path">{vault.path}</span>
            </span>
            <ChevronsUpDown size={13} className="vault-chevron" />
          </button>
          {menuOpen ? (
            <div className="menu vault-menu">
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  void openVault();
                }}
              >
                <FolderOpen size={14} />
                打开其他知识库
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  void api.app.revealVault();
                }}
              >
                <FolderOpen size={14} />
                在文件夹中显示
              </button>
              <div className="menu-sep" />
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false);
                  navigate('settings');
                }}
              >
                <Settings2 size={14} />
                知识库设置
              </button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="主导航">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.page}
              type="button"
              className={`nav-item${page === item.page ? ' active' : ''}`}
              onClick={() => navigate(item.page)}
              title={collapsed ? item.label : undefined}
            >
              <Icon size={15.5} strokeWidth={1.7} />
              <span>{item.label}</span>
              {item.page === 'inbox' && stats.inbox > 0 ? (
                <span className="nav-count">{stats.inbox}</span>
              ) : null}
              {item.page === 'trash' && trashCount > 0 ? (
                <span className="nav-count muted">{trashCount}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {recent.length ? (
        <div className="side-section">
          <div className="side-label">最近编辑</div>
          <div className="side-recent">
            {recent.map((note) => (
              <button
                key={note.path}
                type="button"
                className="side-note"
                onClick={() => {
                  if (page !== 'library') navigate('library', note.path);
                  else selectNote(note.path);
                }}
                title={note.title}
              >
                <span className={`type-dot ${note.type}`} />
                <span>{note.title}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="sidebar-bottom">
        <button
          type="button"
          className={`nav-item${page === 'settings' ? ' active' : ''}`}
          onClick={() => navigate('settings')}
          title={collapsed ? '设置' : undefined}
        >
          <Settings2 size={15.5} strokeWidth={1.7} />
          <span>设置</span>
        </button>
        <button
          type="button"
          className="nav-item"
          onClick={() => void setTheme(dark ? 'light' : 'dark')}
          title={collapsed ? (dark ? '浅色外观' : '深色外观') : undefined}
        >
          {dark ? <Sun size={15.5} strokeWidth={1.7} /> : <Moon size={15.5} strokeWidth={1.7} />}
          <span>{dark ? '浅色外观' : '深色外观'}</span>
        </button>
        <div className="local-note">
          <Lock size={11} />
          本地存储 · 已自动保存
        </div>
      </div>
    </aside>
  );
}
