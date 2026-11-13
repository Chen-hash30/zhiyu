import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  ClipboardType,
  FilePlus2,
  Inbox,
  Link2,
  Moon,
  ScrollText,
  Search,
  Settings2,
  Sun,
} from 'lucide-react';
import { createSearch, searchNotes } from '../lib/search';
import { useAppStore } from '../store';

interface PaletteItem {
  key: string;
  title: string;
  meta?: string;
  icon: ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const open = useAppStore((state) => state.paletteOpen);
  const setPalette = useAppStore((state) => state.setPalette);
  const notes = useAppStore((state) => state.notes);
  const navigate = useAppStore((state) => state.navigate);
  const setModal = useAppStore((state) => state.setModal);
  const setTheme = useAppStore((state) => state.setTheme);
  const settings = useAppStore((state) => state.settings);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const index = useMemo(() => createSearch(notes), [notes]);

  const dark =
    settings?.theme === 'dark' ||
    (settings?.theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  const matchedNotes = useMemo(() => {
    if (!query.trim()) {
      return notes.filter((note) => note.type !== 'raw').slice(0, 5);
    }
    return searchNotes(index, query).slice(0, 8);
  }, [query, notes, index]);

  const noteItems: PaletteItem[] = matchedNotes.map((note) => ({
    key: `note:${note.path}`,
    title: note.title,
    meta: note.typeLabel,
    icon: <span className={`type-dot ${note.type}`} />,
    run: () => {
      setPalette(false);
      if (note.type === 'raw') navigate('inbox', note.path);
      else navigate('library', note.path);
    },
  }));

  const allActions: PaletteItem[] = [
    {
      key: 'action:new',
      title: '新建笔记',
      meta: 'Ctrl N',
      icon: <FilePlus2 size={14} />,
      run: () => {
        setPalette(false);
        setModal('new-note');
      },
    },
    {
      key: 'action:url',
      title: '导入网页',
      icon: <Link2 size={14} />,
      run: () => {
        setPalette(false);
        setModal('import-url');
      },
    },
    {
      key: 'action:text',
      title: '粘贴文本',
      icon: <ClipboardType size={14} />,
      run: () => {
        setPalette(false);
        setModal('import-text');
      },
    },
    {
      key: 'action:inbox',
      title: '打开收件箱',
      icon: <Inbox size={14} />,
      run: () => {
        setPalette(false);
        navigate('inbox');
      },
    },
    {
      key: 'action:rules',
      title: '编辑整理规则',
      icon: <ScrollText size={14} />,
      run: () => {
        setPalette(false);
        setModal('rules');
      },
    },
    {
      key: 'action:theme',
      title: dark ? '切换到浅色外观' : '切换到深色外观',
      icon: dark ? <Sun size={14} /> : <Moon size={14} />,
      run: () => {
        setPalette(false);
        void setTheme(dark ? 'light' : 'dark');
      },
    },
    {
      key: 'action:settings',
      title: '打开设置',
      icon: <Settings2 size={14} />,
      run: () => {
        setPalette(false);
        navigate('settings');
      },
    },
  ];

  const actionItems = query.trim()
    ? allActions.filter((item) => item.title.includes(query.trim()))
    : allActions;

  const items = [...noteItems, ...actionItems];

  useEffect(() => {
    setActive((value) => Math.min(value, Math.max(0, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    if (!open) return;
    const element = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    element?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    item.run();
  };

  return (
    <div
      className="palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setPalette(false);
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="命令面板">
        <div className="palette-input-row">
          <Search size={16} />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="搜索笔记，或输入一个操作…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((value) => (value + 1) % Math.max(1, items.length));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((value) => (value - 1 + items.length) % Math.max(1, items.length));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                run(items[active]);
              } else if (event.key === 'Escape') {
                setPalette(false);
              }
            }}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div className="palette-results" ref={listRef}>
          {noteItems.length ? (
            <>
              <div className="palette-group">{query.trim() ? '搜索结果' : '最近编辑'}</div>
              {noteItems.map((item, itemIndex) => (
                <button
                  key={item.key}
                  type="button"
                  data-index={itemIndex}
                  className={`palette-item${active === itemIndex ? ' active' : ''}`}
                  onMouseMove={() => setActive(itemIndex)}
                  onClick={() => run(item)}
                >
                  <span className="p-icon">{item.icon}</span>
                  <span className="p-title">{item.title}</span>
                  <span className="p-meta">{item.meta}</span>
                </button>
              ))}
            </>
          ) : null}
          {actionItems.length ? (
            <>
              <div className="palette-group">操作</div>
              {actionItems.map((item, itemIndex) => {
                const flatIndex = noteItems.length + itemIndex;
                return (
                  <button
                    key={item.key}
                    type="button"
                    data-index={flatIndex}
                    className={`palette-item${active === flatIndex ? ' active' : ''}`}
                    onMouseMove={() => setActive(flatIndex)}
                    onClick={() => run(item)}
                  >
                    <span className="p-icon">{item.icon}</span>
                    <span className="p-title">{item.title}</span>
                    {item.meta ? <span className="p-meta">{item.meta}</span> : null}
                    {active === flatIndex ? <ArrowRight size={13} /> : null}
                  </button>
                );
              })}
            </>
          ) : null}
          {!items.length ? <div className="palette-empty">没有找到相关笔记或操作。</div> : null}
        </div>
        <div className="palette-foot">
          <span>
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> 选择
          </span>
          <span>
            <kbd className="kbd">Enter</kbd> 打开
          </span>
          <span>
            <kbd className="kbd">Esc</kbd> 关闭
          </span>
        </div>
      </div>
    </div>
  );
}
