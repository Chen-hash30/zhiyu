import {
  Children,
  isValidElement,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUpRight, Check, Copy } from 'lucide-react';
import { api } from '../lib/api';

export function preprocessWikiLinks(markdown: string) {
  const parts = String(markdown || '').split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => {
        const text = (label || target).trim().replace(/[\[\]]/g, '');
        return `[${text}](wiki://${encodeURIComponent(target.trim())})`;
      });
    })
    .join('');
}

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement(node)) {
    return nodeText((node.props as { children?: ReactNode }).children);
  }
  return '';
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  }
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  let language = '';
  const first = Children.toArray(children)[0];
  if (isValidElement(first)) {
    const className = String((first.props as { className?: string }).className || '');
    const match = className.match(/language-([\w-]+)/);
    if (match) language = match[1];
  }
  const text = nodeText(children);
  return (
    <div className="code-block">
      <div className="code-block-head">
        <span>{language || '代码'}</span>
        <button
          type="button"
          className="code-copy"
          onClick={async () => {
            if (await copyText(text)) {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }
          }}
          aria-label="复制代码"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

interface MarkdownViewProps {
  content: string;
  onWikiLink?: (target: string) => void;
  compact?: boolean;
}

export function MarkdownView({ content, onWikiLink, compact = false }: MarkdownViewProps) {
  const prepared = useMemo(() => preprocessWikiLinks(content), [content]);
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) => {
        if (href?.startsWith('wiki://')) {
          const target = decodeURIComponent(href.slice(7));
          return (
            <button type="button" className="wiki-link" onClick={() => onWikiLink?.(target)}>
              {children}
            </button>
          );
        }
        if (href && /^https?:\/\//i.test(href)) {
          return (
            <a
              href={href}
              className="external-link"
              onClick={(event) => {
                event.preventDefault();
                void api.app.openExternal(href);
              }}
            >
              {children}
              <ArrowUpRight size={12} strokeWidth={1.8} />
            </a>
          );
        }
        if (href && /\.md(#.*)?$/i.test(href)) {
          const target = decodeURI(href.split('#')[0]).replace(/^\.\//, '');
          return (
            <button type="button" className="wiki-link" onClick={() => onWikiLink?.(target)}>
              {children}
            </button>
          );
        }
        return <a href={href}>{children}</a>;
      },
      pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
      img: ({ src, alt }) => <img src={src} alt={alt || ''} loading="lazy" />,
    }),
    [onWikiLink],
  );

  return (
    <div className={`markdown${compact ? ' markdown-compact' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={(url) =>
          url.startsWith('wiki://') || /^(https?:|mailto:)/i.test(url) || /\.md(#.*)?$/i.test(url)
            ? url
            : ''
        }
      >
        {prepared}
      </ReactMarkdown>
    </div>
  );
}
