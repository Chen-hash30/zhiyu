import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as highlightTags } from '@lezer/highlight';
import {
  ArrowLeft,
  Bold,
  Brackets,
  Code2,
  Heading2,
  Italic,
  Link2,
  List,
  Quote,
  X,
} from 'lucide-react';
import { clockText } from '../lib/format';
import { useAppStore } from '../store';
import type { NoteDetail } from '../types';

type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

export function NoteEditor({
  note,
  onSave,
  onDone,
}: {
  note: NoteDetail;
  onSave: (patch: { title?: string; body?: string; tags?: string[] }, notePath: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const themeSetting = useAppStore((state) => state.settings?.theme || 'light');
  const dark =
    themeSetting === 'dark' ||
    (themeSetting === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState<string[]>(note.tags);
  const [tagInput, setTagInput] = useState('');
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [lastSaved, setLastSaved] = useState(clockText());
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const latestRef = useRef({ title, body, tags });
  const initialSnapshot = useRef(JSON.stringify({ title: note.title, body: note.body, tags: note.tags }));
  const lastSavedSnapshot = useRef(initialSnapshot.current);
  const dirtyRef = useRef(false);

  useEffect(() => {
    latestRef.current = { title, body, tags };
  }, [title, body, tags]);

  const saveLatest = useCallback(async () => {
    if (!dirtyRef.current) return true;
    const snapshot = latestRef.current;
    const serialized = JSON.stringify(snapshot);
    dirtyRef.current = false;
    setStatus('saving');
    try {
      await onSave(
        {
          title: snapshot.title.trim() || '未命名笔记',
          body: snapshot.body,
          tags: snapshot.tags,
        },
        note.path,
      );
      lastSavedSnapshot.current = serialized;
      setLastSaved(clockText());
      const stillDirty = JSON.stringify(latestRef.current) !== serialized;
      dirtyRef.current = stillDirty;
      setStatus(stillDirty ? 'dirty' : 'saved');
      return true;
    } catch {
      dirtyRef.current = true;
      setStatus('error');
      return false;
    }
  }, [note.path, onSave]);

  useEffect(() => {
    const serialized = JSON.stringify({ title, body, tags });
    if (serialized === lastSavedSnapshot.current) {
      dirtyRef.current = false;
      setStatus((current) => (current === 'saving' ? current : 'saved'));
      return;
    }
    dirtyRef.current = true;
    setStatus('dirty');
    const timer = window.setTimeout(() => {
      void saveLatest();
    }, 850);
    return () => window.clearTimeout(timer);
  }, [title, body, tags, saveLatest]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveLatest();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [saveLatest]);

  useEffect(
    () => () => {
      if (dirtyRef.current) {
        const snapshot = latestRef.current;
        void onSave(
          {
            title: snapshot.title.trim() || '未命名笔记',
            body: snapshot.body,
            tags: snapshot.tags,
          },
          note.path,
        );
      }
    },
    [note.path, onSave],
  );

  const theme = useMemo(
    () =>
      EditorView.theme(
        {
          '&': {
            backgroundColor: 'transparent',
            color: dark ? '#ede8dd' : '#26221b',
            height: '100%',
          },
          '.cm-scroller': {
            fontFamily: 'var(--font-mono)',
            lineHeight: '1.9',
            fontSize: '13.5px',
            overflow: 'auto',
          },
          '.cm-content': {
            padding: '8px 0 90px',
            caretColor: dark ? '#e1a361' : '#b06a2f',
          },
          '.cm-line': { padding: '0 2px' },
          '.cm-cursor, .cm-dropCursor': {
            borderLeftColor: dark ? '#e1a361' : '#b06a2f',
            borderLeftWidth: '2px',
          },
          '.cm-selectionBackground, ::selection': {
            backgroundColor: dark ? 'rgba(225,163,97,.2)' : 'rgba(176,106,47,.16)',
          },
          '.cm-activeLine': {
            backgroundColor: dark ? 'rgba(255,255,255,.027)' : 'rgba(33,30,24,.023)',
            borderRadius: '4px',
          },
          '&.cm-focused': { outline: 'none' },
          '.cm-placeholder': { color: dark ? '#6d665b' : '#b7ae9e' },
        },
        { dark },
      ),
    [dark],
  );

  const highlight = useMemo(
    () =>
      HighlightStyle.define([
        { tag: highlightTags.heading, color: dark ? '#f0b97b' : '#8f5220', fontWeight: '650' },
        { tag: highlightTags.strong, color: dark ? '#f5efe4' : '#211e18', fontWeight: '700' },
        { tag: highlightTags.emphasis, fontStyle: 'italic', color: dark ? '#d7c7ad' : '#5f4a2f' },
        { tag: highlightTags.link, color: dark ? '#e1a361' : '#a15d25' },
        { tag: highlightTags.url, color: dark ? '#a8b99b' : '#5f7258' },
        { tag: highlightTags.monospace, color: dark ? '#d9c3a2' : '#7a5a35' },
        { tag: highlightTags.quote, color: dark ? '#b7ab99' : '#7c7364', fontStyle: 'italic' },
        { tag: highlightTags.list, color: dark ? '#e1a361' : '#b06a2f' },
        { tag: highlightTags.meta, color: dark ? '#8f877a' : '#8b8375' },
      ]),
    [dark],
  );

  const extensions = useMemo(
    () => [markdown(), EditorView.lineWrapping, theme, syntaxHighlighting(highlight)],
    [theme, highlight],
  );

  const insert = (before: string, after: string, placeholder: string) => {
    const view = editorRef.current?.view;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to) || placeholder;
    view.dispatch({
      changes: { from, to, insert: `${before}${selected}${after}` },
      selection: {
        anchor: from + before.length,
        head: from + before.length + selected.length,
      },
    });
    view.focus();
  };

  const prefixLine = (prefix: string) => {
    const view = editorRef.current?.view;
    if (!view) return;
    const line = view.state.doc.lineAt(view.state.selection.main.from);
    view.dispatch({ changes: { from: line.from, insert: prefix } });
    view.focus();
  };

  const addTag = () => {
    const next = tagInput.trim().replace(/^#/, '');
    if (next && !tags.includes(next)) setTags([...tags, next]);
    setTagInput('');
  };

  const statusText =
    status === 'saving'
      ? '正在保存'
      : status === 'dirty'
        ? '未保存'
        : status === 'error'
          ? '保存失败'
          : `已保存 ${lastSaved}`;

  return (
    <div className="editor">
      <div className="editor-head">
        <button type="button" className="icon-btn" onClick={onDone} aria-label="返回阅读">
          <ArrowLeft size={16} />
        </button>
        <div className="editor-crumb">编辑 · {note.typeLabel}</div>
        <span className={`save-state ${status}`}>
          <span className="save-dot" />
          {statusText}
        </span>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={async () => {
            if (await saveLatest()) onDone();
          }}
        >
          完成
        </button>
      </div>
      <div className="editor-scroll">
        <input
          className="editor-title-input"
          data-autofocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="笔记标题"
        />
        <div className="editor-tags">
          {tags.map((tag) => (
            <span key={tag} className="chip editor-tag">
              #{tag}
              <button
                type="button"
                onClick={() => setTags(tags.filter((item) => item !== tag))}
                aria-label={`移除标签 ${tag}`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
          <input
            className="tag-input"
            value={tagInput}
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault();
                addTag();
              }
              if (event.key === 'Backspace' && !tagInput && tags.length) {
                setTags(tags.slice(0, -1));
              }
            }}
            onBlur={addTag}
            placeholder="添加标签"
          />
        </div>
        <div className="editor-toolbar">
          <button type="button" className="icon-btn" data-tip="小标题" onClick={() => prefixLine('## ')}>
            <Heading2 size={15} />
          </button>
          <button type="button" className="icon-btn" data-tip="加粗" onClick={() => insert('**', '**', '重点')}>
            <Bold size={14.5} />
          </button>
          <button type="button" className="icon-btn" data-tip="斜体" onClick={() => insert('*', '*', '强调')}>
            <Italic size={14.5} />
          </button>
          <span className="toolbar-sep" />
          <button
            type="button"
            className="icon-btn"
            data-tip="链接"
            onClick={() => insert('[', '](https://)', '链接文字')}
          >
            <Link2 size={14.5} />
          </button>
          <button
            type="button"
            className="icon-btn"
            data-tip="双向链接"
            onClick={() => insert('[[', ']]', '条目名')}
          >
            <Brackets size={14.5} />
          </button>
          <span className="toolbar-sep" />
          <button type="button" className="icon-btn" data-tip="引用" onClick={() => prefixLine('> ')}>
            <Quote size={14.5} />
          </button>
          <button type="button" className="icon-btn" data-tip="列表" onClick={() => prefixLine('- ')}>
            <List size={14.5} />
          </button>
          <button type="button" className="icon-btn" data-tip="行内代码" onClick={() => insert('`', '`', '代码')}>
            <Code2 size={14.5} />
          </button>
        </div>
        <div className="editor-surface">
          <CodeMirror
            ref={editorRef}
            value={body}
            height="100%"
            theme="none"
            extensions={extensions}
            onChange={setBody}
            placeholder="从这里开始写…"
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: true,
              highlightActiveLineGutter: false,
              autocompletion: false,
              bracketMatching: true,
              closeBrackets: true,
              searchKeymap: true,
              allowMultipleSelections: true,
            }}
          />
        </div>
      </div>
    </div>
  );
}
