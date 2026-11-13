import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Compass,
  Maximize2,
  Minus,
  Network,
  Plus,
  Tags,
} from 'lucide-react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { useAppStore } from '../store';
import type { NoteType } from '../types';
import { EmptyState } from '../components/EmptyState';

interface GraphNode extends SimulationNodeDatum {
  id: string;
  path: string;
  title: string;
  type: NoteType;
  degree: number;
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
}

const TYPE_LABEL: Record<string, string> = {
  concept: '概念',
  entity: '实体',
  source: '来源',
  note: '笔记',
};

const TYPE_COLOR: Record<string, string> = {
  concept: 'var(--concept)',
  entity: 'var(--entity)',
  source: 'var(--source)',
  note: 'var(--note)',
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function GraphPage() {
  const notes = useAppStore((state) => state.notes);
  const navigate = useAppStore((state) => state.navigate);
  const activePath = useAppStore((state) => state.activePath);
  const [layoutKey, setLayoutKey] = useState(0);
  const [labels, setLabels] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 900, height: 620 });
  const [transform, setTransform] = useState({ k: 1, x: 0, y: 0 });
  const [, setTick] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<Simulation<GraphNode, GraphLink> | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const transformRef = useRef(transform);
  const dragRef = useRef<{
    mode: 'pan' | 'node';
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    node?: GraphNode;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  const data = useMemo(() => {
    const wiki = notes.filter((note) => note.type !== 'raw' && note.type !== 'system');
    const nodes: GraphNode[] = wiki.map((note) => ({
      id: note.path,
      path: note.path,
      title: note.title,
      type: note.type,
      degree: 0,
    }));
    const byPath = new Map(nodes.map((node) => [node.path, node]));
    const findTarget = (target: string) => {
      const normalized = target.replace(/\.md$/i, '').trim().toLowerCase();
      const found = wiki.find((note) => {
        const candidates = [
          note.title,
          ...note.aliases,
          note.path.replace(/\.md$/i, ''),
          note.path.split('/').pop()?.replace(/\.md$/i, '') || '',
        ];
        return candidates.some((value) => value.trim().toLowerCase() === normalized);
      });
      return found?.path || null;
    };
    const links: GraphLink[] = [];
    const seen = new Set<string>();
    for (const note of wiki) {
      for (const target of note.links) {
        const targetPath = findTarget(target);
        if (!targetPath || targetPath === note.path) continue;
        const key = [note.path, targetPath].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        links.push({ source: note.path, target: targetPath });
        byPath.get(note.path)!.degree += 1;
        byPath.get(targetPath)!.degree += 1;
      }
    }
    return { nodes, links };
  }, [notes]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setSize({ width: rect.width, height: rect.height });
      }
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!data.nodes.length) return;
    simulationRef.current?.stop();
    const nodes = data.nodes.map((node, index) => ({
      ...node,
      x: size.width / 2 + Math.cos((index / Math.max(1, data.nodes.length)) * Math.PI * 2) * 130,
      y: size.height / 2 + Math.sin((index / Math.max(1, data.nodes.length)) * Math.PI * 2) * 130,
    }));
    const links = data.links.map((link) => ({ ...link }));
    nodesRef.current = nodes;
    setTransform({ k: 1, x: 0, y: 0 });
    const simulation = forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        forceLink<GraphNode, GraphLink>(links)
          .id((node) => node.id)
          .distance((link) => 98 + Math.min(45, (link.source as GraphNode).degree * 5))
          .strength(0.45),
      )
      .force('charge', forceManyBody<GraphNode>().strength(-330))
      .force('collide', forceCollide<GraphNode>().radius((node) => 18 + node.degree * 1.2))
      .force('center', forceCenter<GraphNode>(size.width / 2, size.height / 2))
      .alphaDecay(0.035)
      .on('tick', () => setTick((value) => value + 1));
    simulationRef.current = simulation;
    return () => {
      simulation.stop();
    };
  }, [data, size.width, size.height, layoutKey]);

  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setTransform((current) => {
        const k = clamp(current.k * (event.deltaY < 0 ? 1.1 : 0.9), 0.45, 2.4);
        return {
          k,
          x: px - ((px - current.x) / current.k) * k,
          y: py - ((py - current.y) / current.k) * k,
        };
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  if (!data.nodes.length) {
    return (
      <div className="page graph-page">
        <header className="page-head">
          <div className="page-head-main">
            <div className="page-eyebrow">连接</div>
            <h1 className="page-title">关系图谱</h1>
            <p className="page-subtitle">当知识开始互相引用，图谱就会长出来。</p>
          </div>
        </header>
        <div className="detail-empty">
          <EmptyState
            icon={<Network size={19} />}
            tone="sage"
            title="图谱还是空的"
            copy="先整理一份资料，或者新建几条互相链接的笔记。"
            actions={
              <button type="button" className="btn btn-sm btn-outline" onClick={() => navigate('inbox')}>
                打开收件箱
              </button>
            }
          />
        </div>
      </div>
    );
  }

  const nodes = nodesRef.current;
  const links = simulationRef.current
    ? (simulationRef.current.force('link') as ReturnType<typeof forceLink<GraphNode, GraphLink>>).links()
    : (data.links as GraphLink[]);

  const focus = hovered || activePath;
  const neighbors = new Set<string>();
  if (focus) {
    neighbors.add(focus);
    for (const link of links) {
      const source = typeof link.source === 'string' ? link.source : link.source.id;
      const target = typeof link.target === 'string' ? link.target : link.target.id;
      if (source === focus) neighbors.add(target);
      if (target === focus) neighbors.add(source);
    }
  }

  const zoomBy = (factor: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    const cx = (rect?.width || size.width) / 2;
    const cy = (rect?.height || size.height) / 2;
    setTransform((current) => {
      const k = clamp(current.k * factor, 0.45, 2.4);
      return {
        k,
        x: cx - ((cx - current.x) / current.k) * k,
        y: cy - ((cy - current.y) / current.k) * k,
      };
    });
  };

  const hoveredNode = nodes.find((node) => node.id === hovered);

  return (
    <div className="page graph-page">
      <header className="page-head">
        <div className="page-head-main">
          <div className="page-eyebrow">连接</div>
          <h1 className="page-title">
            关系图谱
            <span className="title-count neutral">{data.nodes.length}</span>
          </h1>
          <p className="page-subtitle">
            {data.nodes.length} 个节点 · {data.links.length} 条连接 · 点击节点打开笔记
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className={`btn btn-sm ${labels ? 'btn-outline' : 'btn-ghost'}`}
            onClick={() => setLabels((value) => !value)}
          >
            <Tags size={13.5} />
            {labels ? '隐藏标签' : '显示标签'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => setLayoutKey((value) => value + 1)}
          >
            <Compass size={13.5} />
            重新布局
          </button>
        </div>
      </header>
      <div className="graph-stage" ref={stageRef}>
        <svg
          ref={svgRef}
          className="graph-svg"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            if ((event.target as Element).closest('[data-node]')) return;
            dragRef.current = {
              mode: 'pan',
              startX: event.clientX,
              startY: event.clientY,
              originX: transform.x,
              originY: transform.y,
              moved: false,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag) return;
            const dx = event.clientX - drag.startX;
            const dy = event.clientY - drag.startY;
            if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
            if (drag.mode === 'pan') {
              setTransform((current) => ({
                ...current,
                x: drag.originX + dx,
                y: drag.originY + dy,
              }));
            } else if (drag.node && stageRef.current) {
              const rect = stageRef.current.getBoundingClientRect();
              const view = transformRef.current;
              drag.node.fx = (event.clientX - rect.left - view.x) / view.k;
              drag.node.fy = (event.clientY - rect.top - view.y) / view.k;
              simulationRef.current?.alpha(0.35).restart();
            }
          }}
          onPointerUp={() => {
            const drag = dragRef.current;
            dragRef.current = null;
            if (!drag) return;
            if (drag.mode === 'node' && drag.node) {
              if (!drag.moved) {
                navigate('library', drag.node.path);
              } else {
                drag.node.fx = null;
                drag.node.fy = null;
                simulationRef.current?.alpha(0.25).restart();
              }
            }
          }}
        >
          <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
            {links.map((link, index) => {
              const source = typeof link.source === 'string' ? nodes.find((n) => n.id === link.source) : link.source;
              const target = typeof link.target === 'string' ? nodes.find((n) => n.id === link.target) : link.target;
              if (!source || !target || source.x == null || target.x == null) return null;
              const dim = focus ? !(neighbors.has(source.id) && neighbors.has(target.id)) : false;
              return (
                <line
                  key={`${source.id}-${target.id}-${index}`}
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke={dim ? 'var(--line)' : 'var(--line-strong)'}
                  strokeWidth={dim ? 0.8 : 1}
                />
              );
            })}
            {nodes.map((node) => {
              if (node.x == null || node.y == null) return null;
              const radius = 6 + Math.min(7, node.degree * 1.35);
              const dim = focus ? !neighbors.has(node.id) : false;
              const isActive = focus === node.id;
              return (
                <g
                  key={node.id}
                  data-node={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  style={{ cursor: 'pointer', opacity: dim ? 0.3 : 1 }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    dragRef.current = {
                      mode: 'node',
                      startX: event.clientX,
                      startY: event.clientY,
                      originX: transformRef.current.x,
                      originY: transformRef.current.y,
                      node,
                      moved: false,
                    };
                    svgRef.current?.setPointerCapture(event.pointerId);
                  }}
                  onPointerEnter={() => setHovered(node.id)}
                  onPointerLeave={() => setHovered((value) => (value === node.id ? null : value))}
                >
                  {isActive ? (
                    <circle r={radius + 6} fill="none" stroke="var(--accent)" strokeWidth={1.2} opacity={0.65} />
                  ) : null}
                  <circle
                    r={radius}
                    fill={TYPE_COLOR[node.type] || 'var(--note)'}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                  {labels && (transform.k > 0.62 || isActive) ? (
                    <text
                      y={radius + 14}
                      textAnchor="middle"
                      fill="var(--ink-2)"
                      fontSize={10.5}
                      fontWeight={isActive ? 600 : 500}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {node.title.length > 12 ? `${node.title.slice(0, 12)}…` : node.title}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>

        {hoveredNode && hoveredNode.x != null && hoveredNode.y != null ? (
          <div
            className="graph-tooltip"
            style={{
              left: hoveredNode.x * transform.k + transform.x + 16,
              top: hoveredNode.y * transform.k + transform.y - 12,
            }}
          >
            <b>{hoveredNode.title}</b>
            <span>
              {TYPE_LABEL[hoveredNode.type] || '笔记'} · {hoveredNode.degree} 条连接
            </span>
          </div>
        ) : null}

        <div className="graph-legend">
          {(['concept', 'entity', 'source', 'note'] as NoteType[]).map((type) => (
            <span key={type} className="graph-legend-item">
              <i style={{ background: TYPE_COLOR[type] }} />
              {TYPE_LABEL[type]}
            </span>
          ))}
        </div>

        <div className="graph-controls">
          <button type="button" className="icon-btn" onClick={() => zoomBy(1.2)} aria-label="放大">
            <Plus size={15} />
          </button>
          <button type="button" className="icon-btn" onClick={() => zoomBy(0.83)} aria-label="缩小">
            <Minus size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setTransform({ k: 1, x: 0, y: 0 })}
            aria-label="重置视图"
          >
            <Maximize2 size={14} />
          </button>
        </div>
        <div className="graph-zoom">{Math.round(transform.k * 100)}%</div>
        <div className="graph-hint">拖拽移动 · 滚轮缩放 · 点击打开</div>
      </div>
    </div>
  );
}
