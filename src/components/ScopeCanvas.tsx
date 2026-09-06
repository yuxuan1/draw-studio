/* ============================================================
 * ScopeCanvas —— 基于 React Flow（@xyflow/react）
 *
 * 基础交互全部交给框架（久经考验，不再手调）：
 *  - 左键拖空白 = 平移 · Shift+拖 = 框选 · 滚轮 = 缩放（指向光标）
 *  - 四锚点(t/r/b/l)拖拽连线 · 节点拖拽 · 小地图/缩放原生支持
 *
 * 领域层保持不变（真源优先级红线）：
 *  Domain Model(projectProcess 投影) → ScopeLayout(布局) → RF 渲染态
 *  拖拽结束才写回 ScopeLayout（Command，可撤销、可合并）
 * ============================================================ */
import '@xyflow/react/dist/style.css';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant,
  Handle, Position, MarkerType, useReactFlow,
} from '@xyflow/react';
import type {
  Node as RFNode, Edge as RFEdge, Connection, NodeChange, NodeProps,
  OnSelectionChangeParams,
} from '@xyflow/react';
import { useScope } from '../store/scopeStore';
import { THEME, SHAPE_COLORS, shapePair, readableOn, FONT_STACK } from '../lib/core';
import type { ThemeMode } from '../lib/core';
import type { RenderNode, Handle as FFHandle, ID, CallNode } from '../lib/domain';
import { NODE_DEFAULTS, buildProjectCallGraph, OVERVIEW_CARD } from '../lib/domain';

/* ---------------- 自定义节点：流程节点 ---------------- */
type FFNodeData = { node: RenderNode; theme: ThemeMode; editable: boolean; selected: boolean };

const HANDLE_SIDES: { side: FFHandle; pos: Position }[] = [
  { side: 't', pos: Position.Top },
  { side: 'r', pos: Position.Right },
  { side: 'b', pos: Position.Bottom },
  { side: 'l', pos: Position.Left },
];

function FFNode({ data }: NodeProps) {
  const { node: n, theme, editable, selected } = data as unknown as FFNodeData;
  const th = THEME[theme];
  const { fill, stroke } = shapePair((n.properties?.color as string) ?? NODE_DEFAULTS[n.type].color, theme);
  const text = readableOn(fill);
  const isDiamond = n.type === 'decision' || n.type === 'choice';
  const isStadium = n.type === 'start' || n.type === 'end';
  const w = n.w, h = n.h;
  const radius = isStadium ? h / 2 : 10;
  const border = selected ? th.sel : stroke;
  const bw = selected ? 2.4 : 1.6;

  return (
    <div className="group relative" style={{ width: w, height: h, cursor: editable ? 'move' : 'pointer' }}>
      {isDiamond ? (
        <svg width={w} height={h} className="absolute inset-0" style={{ overflow: 'visible' }}>
          {selected && (
            <path d={`M ${w / 2} -5 L ${w + 7} ${h / 2} L ${w / 2} ${h + 5} L -7 ${h / 2} Z`}
              fill="none" stroke={th.selGlow} strokeWidth={4} opacity={0.9} />
          )}
          <path d={`M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`}
            fill={fill} stroke={border} strokeWidth={bw} strokeLinejoin="round" />
        </svg>
      ) : (
        <div className="absolute inset-0" style={{
          background: fill,
          border: `${bw}px ${n.type === 'comment' ? 'dashed' : 'solid'} ${border}`,
          borderRadius: radius,
          boxShadow: selected ? `0 0 0 4px ${th.selGlow}` : undefined,
        }} />
      )}
      {/* call 节点的内框（双线效果） */}
      {n.type === 'call' && (
        <div className="absolute pointer-events-none" style={{
          inset: 5, border: `1.1px solid ${stroke}`, opacity: 0.65,
          borderRadius: Math.max(0, radius - 5),
        }} />
      )}
      {/* 名称 */}
      <div className="absolute inset-0 flex items-center justify-center px-2.5 text-center pointer-events-none"
        style={{
          color: text, fontSize: 12.5, lineHeight: 1.25, fontFamily: FONT_STACK,
          fontWeight: n.type === 'call' ? 700 : 600,
        }}>
        <span className="break-words">{n.name}{n.type === 'call' ? ' »' : ''}</span>
      </div>
      {/* 四锚点：每侧 source(可见) + target(透明命中区)，任意方向可连 */}
      {HANDLE_SIDES.map(({ side, pos }) => (
        <Fragment key={side}>
          <Handle type="target" position={pos} id={side}
            style={{ opacity: 0, width: 16, height: 16, border: 'none', background: 'transparent', pointerEvents: editable ? 'auto' : 'none' }} />
          <Handle type="source" position={pos} id={side}
            className={`!border-2 !border-white transition-opacity ${selected ? '!opacity-100' : '!opacity-0 group-hover:!opacity-100'}`}
            style={{ width: 10, height: 10, background: th.sel, pointerEvents: editable ? 'auto' : 'none' }} />
        </Fragment>
      ))}
    </div>
  );
}

/* ---------------- 自定义节点：全局调用图卡片 ---------------- */
type OvData = { name: string; nodeCount: number; callCount: number; colorKey: keyof typeof SHAPE_COLORS; theme: ThemeMode; selected: boolean };
const OV_KEYS = Object.keys(SHAPE_COLORS) as (keyof typeof SHAPE_COLORS)[];

function OverviewNode({ data }: NodeProps) {
  const d = data as unknown as OvData;
  const th = THEME[d.theme];
  const { fill, stroke } = SHAPE_COLORS[d.colorKey][d.theme];
  const text = readableOn(fill);
  return (
    <div className="relative" style={{
      width: OVERVIEW_CARD.w, height: OVERVIEW_CARD.h,
      background: fill, borderRadius: 12, cursor: 'pointer',
      border: `1.6px solid ${d.selected ? th.sel : stroke}`,
      boxShadow: d.selected ? `0 0 0 4px ${th.selGlow}` : '0 2px 10px rgba(0,0,0,.12)',
    }}>
      <div className="absolute left-0 top-0 h-full" style={{ width: 5, background: stroke, borderRadius: '12px 0 0 12px' }} />
      <div className="absolute inset-0 pl-4 pr-3 flex flex-col justify-center gap-0.5 pointer-events-none">
        <div className="text-[13px] font-bold truncate" style={{ color: text, fontFamily: FONT_STACK }}>{d.name}</div>
        <div className="text-[10.5px] truncate" style={{ color: text, opacity: 0.78, fontFamily: FONT_STACK }}>
          {d.nodeCount} 节点 · {d.callCount} 调用 · 双击进入
        </div>
      </div>
      <div className="absolute right-2.5 top-1.5 text-[12px] font-extrabold pointer-events-none" style={{ color: text, opacity: 0.7 }}>»</div>
    </div>
  );
}

const nodeTypes = { ff: FFNode, ov: OverviewNode };

/* ---------------- 画布主体（Provider 内） ---------------- */
function CanvasInner() {
  const app = useScope();
  const rf = useReactFlow();
  const th = THEME[app.theme];
  const editable = app.mode === 'edit';
  const [renaming, setRenaming] = useState<{ id: ID; x: number; y: number; w: number } | null>(null);
  const scopeKey = `${app.scope.pageId}:${app.scope.processId ?? ''}:${app.viewKind}`;

  /* P 键面板的世界坐标换算（注册给 store） */
  useEffect(() => {
    app.screenToWorldRef.current = (sx: number, sy: number) => rf.screenToFlowPosition({ x: sx, y: sy });
  });

  /* ---------- Domain → RF 渲染态（投影，不回写真源） ---------- */
  const callGraph = useMemo(() => buildProjectCallGraph(app.project), [app.project]);
  const overviewPos = app.layouts['__overview']?.positions ?? {};

  const nodes: RFNode[] = useMemo(() => {
    if (app.viewKind === 'callgraph') {
      return callGraph.nodes.map((n, i) => ({
        id: n.id, type: 'ov',
        position: overviewPos[n.id] ?? { x: 0, y: 0 },
        /* 显式尺寸：让 RF 不必依赖测量，避免 0×0 导致 fitView/边锚点计算异常 */
        style: { width: OVERVIEW_CARD.w, height: OVERVIEW_CARD.h },
        data: { name: n.name, nodeCount: n.nodeCount, callCount: n.callCount, colorKey: OV_KEYS[i % OV_KEYS.length], theme: app.theme, selected: false },
      }));
    }
    return app.projection.nodes.map((n) => ({
      id: n.id, type: 'ff',
      position: { x: n.x, y: n.y },
      style: { width: n.w, height: n.h },
      data: { node: n, theme: app.theme, editable, selected: app.sel.kind === 'node' && app.sel.ids.includes(n.id) },
    }));
  }, [app.viewKind, callGraph, overviewPos, app.projection, app.theme, editable, app.sel]);

  const edges: RFEdge[] = useMemo(() => {
    if (app.viewKind === 'callgraph') {
      return callGraph.edges.map((e, i) => ({
        id: `ov-${i}`, source: e.source, target: e.target, type: 'straight',
        style: { stroke: th.edge, strokeWidth: 1.6, strokeDasharray: '6 4', opacity: 0.75 },
        markerEnd: { type: MarkerType.ArrowClosed, color: th.edge, width: 18, height: 18 },
      }));
    }
    return app.projection.edges.map((e) => {
      const selected = app.sel.kind === 'edge' && app.sel.id === e.id;
      const color = e.style?.color || (selected ? th.sel : th.edge);
      return {
        id: e.id, source: e.source, target: e.target,
        type: e.kind, // 'straight' | 'step' | 'smoothstep' —— RF 原生线形
        sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
        label: e.label, selected,
        style: { stroke: color, strokeWidth: selected ? 2.4 : 1.8, strokeDasharray: e.dashed ? '7 5' : undefined },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
        labelStyle: { fill: th.edgeLabelText, fontSize: 10.5, fontWeight: 600, fontFamily: FONT_STACK },
        labelBgStyle: { fill: th.edgeLabelBg, fillOpacity: 1 },
        labelBgPadding: [7, 5] as [number, number],
        labelBgBorderRadius: 6,
      };
    });
  }, [app.viewKind, callGraph, app.projection, app.sel, th]);

  /* ---------- 交互 → 写回真源（Command，可撤销） ---------- */
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    for (const c of changes) {
      /* 拖拽结束才提交一次（store 内按 pid+node 合并为一条 Undo） */
      if (c.type === 'position' && !c.dragging && c.position) {
        if (app.viewKind === 'callgraph') app.moveOverviewNode(c.id, c.position);
        else app.moveNode(c.id, c.position);
      }
    }
  }, [app]);

  const onSelectionChange = useCallback((p: OnSelectionChangeParams) => {
    if (p.edges.length) app.setSel({ kind: 'edge', id: p.edges[0].id, ids: p.edges.map((e) => e.id) });
    else if (p.nodes.length) app.setSel({ kind: 'node', ids: p.nodes.map((n) => n.id) });
    else app.setSel({ kind: null });
  }, [app]);

  const onConnect = useCallback((c: Connection) => {
    app.createEdge(c.source, c.target, (c.sourceHandle ?? 'b') as FFHandle, (c.targetHandle ?? 't') as FFHandle);
  }, [app]);

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, rn: RFNode) => {
    if (app.viewKind === 'callgraph') { app.enterScope(rn.id); return; }
    const n = app.projection.nodes.find((x) => x.id === rn.id);
    if (!n) return;
    if (n.type === 'call') { app.enterScope((n as CallNode).targetProcessId); return; }
    if (!editable) return;
    const sp = rf.flowToScreenPosition({ x: n.x, y: n.y });
    setRenaming({ id: n.id, x: sp.x, y: sp.y, w: n.w });
  }, [app, editable, rf]);

  /* 始终读取最新 nodes（供延迟回调使用，不进入依赖） */
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  /* 适应视图：切换 Scope/视图、外部请求（自动布局/返回）、首次挂载时执行。
     延迟到 RF 完成节点测量后再适配，且只在有节点时执行，
     避免在空集/未测量状态下 fitView 计算出异常视口导致画面消失。 */
  useEffect(() => {
    const t = setTimeout(() => {
      if (nodesRef.current.length) rf.fitView({ padding: 0.15, maxZoom: 1.4, duration: 200 });
    }, 60);
    return () => clearTimeout(t);
  }, [scopeKey, app.fitSignal, rf]);

  const page = app.project.pages.find((p) => p.id === app.scope.pageId);

  return (
    <div className="relative flex-1 min-w-0 overflow-hidden" style={{ background: th.canvas }}>
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        onNodeDoubleClick={onNodeDoubleClick}
        isValidConnection={(c) => c.source !== c.target}
        nodesDraggable={editable}
        nodesConnectable={editable}
        edgesReconnectable={false}
        deleteKeyCode={null}
        minZoom={0.15} maxZoom={2.5}
        connectionLineStyle={{ stroke: th.sel, strokeWidth: 2, strokeDasharray: '6 4' }}
        connectionRadius={36}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.3} color={th.dot} />
      </ReactFlow>

      {/* 视图切换：当前流程 / 全局调用 */}
      {page?.type === 'flow' && (
        <div className="absolute left-1/2 top-3 -translate-x-1/2 z-10 seg" style={{ background: 'var(--panel)', boxShadow: 'var(--shadow)' }}>
          <button className={`seg-btn ${app.viewKind === 'flow' ? 'on' : ''}`} onClick={() => app.setViewKind('flow')}>当前流程</button>
          <button className={`seg-btn ${app.viewKind === 'callgraph' ? 'on' : ''}`} onClick={() => app.setViewKind('callgraph')}>全局调用</button>
        </div>
      )}

      {/* 面包屑 */}
      <Breadcrumbs />

      {/* 缩放控件 */}
      <div className="absolute right-3 bottom-3 z-10 flex flex-col rounded-lg overflow-hidden"
        style={{ background: 'var(--panel)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
        <button className="zoom-btn" onClick={() => rf.zoomIn()} aria-label="放大" title="放大">＋</button>
        <button className="zoom-btn" onClick={() => rf.zoomOut()} aria-label="缩小" title="缩小">－</button>
        <button className="zoom-btn" onClick={() => rf.fitView({ padding: 0.15, duration: 220 })} aria-label="适应视图" title="适应视图 (F)">⤢</button>
      </div>

      {/* 内联重命名 */}
      {renaming && (() => {
        const n = app.projection.nodes.find((x) => x.id === renaming.id);
        if (!n) return null;
        return (
          <input autoFocus className="absolute field-input z-20" defaultValue={n.name}
            style={{ left: renaming.x, top: renaming.y + 2, width: Math.max(130, renaming.w) }}
            onBlur={(e) => { const v = e.target.value.trim(); if (v) app.renameNode(renaming.id, v); setRenaming(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { const v = (e.target as HTMLInputElement).value.trim(); if (v) app.renameNode(renaming.id, v); setRenaming(null); }
              if (e.key === 'Escape') setRenaming(null);
            }} />
        );
      })()}
    </div>
  );
}

/* ---------------- 面包屑（Scope 层级，可点返回） ---------------- */
function Breadcrumbs() {
  const app = useScope();
  const th = THEME[app.theme];
  if (app.viewKind === 'callgraph') {
    return (
      <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
        style={{ background: 'var(--panel)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
        <span className="text-[11.5px] font-bold" style={{ color: th.sel }}>全局调用关系</span>
        <span className="text-[10.5px]" style={{ color: 'var(--muted)' }}>单击选中 · 双击进入流程</span>
      </div>
    );
  }
  const page = app.project.pages.find((p) => p.id === app.scope.pageId);
  const names = app.scopeStack.map((s) => app.project.processes.find((p) => p.id === s.processId)?.name).filter(Boolean) as string[];
  return (
    <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-lg px-2 py-1.5"
      style={{ background: 'var(--panel)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)', maxWidth: '70%' }}>
      {app.canBack && (
        <button onClick={app.back} className="px-1.5 py-0.5 rounded text-[12px] font-bold transition-colors hover:bg-[var(--panel-2)]"
          style={{ color: 'var(--accent)' }} title="返回上级 (Alt+←)">←</button>
      )}
      <span className="text-[11.5px] font-semibold truncate" style={{ color: 'var(--muted)' }}>{page?.name}</span>
      {names.map((nm, i) => (
        <span key={i} className="flex items-center gap-1 min-w-0">
          <span style={{ color: 'var(--muted)' }}>/</span>
          <button className="text-[11.5px] font-bold truncate transition-colors hover:underline"
            style={{ color: i === names.length - 1 ? th.sel : 'var(--text)' }}
            onClick={() => { const pid = app.scopeStack[i].processId; if (pid) app.gotoProcess(pid); }}>
            {nm}
          </button>
        </span>
      ))}
    </div>
  );
}

/* ---------------- 默认导出（套 Provider） ---------------- */
export default function ScopeCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
