/* ============================================================
 * 布局引擎：LR / TB 有向层级（拓扑分层 + 重心排序）/ 环形 / 网格
 * 输出仅为坐标（左上角锚点），不改变状态与转移数据
 * ============================================================ */

import type { ProjectDoc, ProjectSettings, LayoutKind } from './core';
import { nodeSize, START_ID } from './core';

const LAYER_GAP = 110;   // 层间距
const NODE_GAP = 54;     // 同层结点间距
const MARGIN = 60;

export function runLayout(
  doc: ProjectDoc, kind: LayoutKind, settings: ProjectSettings
): Map<string, { x: number; y: number }> {
  const nodes = doc.states;
  const result = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return result;

  const sizes = new Map(nodes.map((s) => [s.id, nodeSize(s, settings)]));
  const edges = doc.transitions.filter(
    (t) => t.source !== t.target && t.source && t.target
  );

  if (kind === 'circle') {
    const order = bfsOrder(doc);
    const n = order.length;
    const R = Math.max(170, (n * 62) / (2 * Math.PI) + 70);
    const cx = R + MARGIN, cy = R + MARGIN;
    order.forEach((id, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const size = sizes.get(id)!;
      result.set(id, {
        x: Math.round(cx + R * Math.cos(a) - size.w / 2),
        y: Math.round(cy + R * Math.sin(a) - size.h / 2),
      });
    });
    return result;
  }

  if (kind === 'grid') {
    const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    let maxW = 0, maxH = 0;
    nodes.forEach((s) => {
      const z = sizes.get(s.id)!;
      maxW = Math.max(maxW, z.w); maxH = Math.max(maxH, z.h);
    });
    const cellW = maxW + 96, cellH = maxH + 84;
    nodes.forEach((s, i) => {
      const size = sizes.get(s.id)!;
      const col = i % cols, row = Math.floor(i / cols);
      result.set(s.id, {
        x: Math.round(MARGIN + col * cellW + (maxW - size.w) / 2),
        y: Math.round(MARGIN + row * cellH + (maxH - size.h) / 2),
      });
    });
    return result;
  }

  /* ---- LR / TB：最长路径分层 ---- */
  const layer = new Map<string, number>();
  nodes.forEach((s) => layer.set(s.id, 0));
  const known = new Set(nodes.map((s) => s.id));
  for (let iter = 0; iter < nodes.length; iter++) {
    let changed = false;
    for (const e of edges) {
      if (!known.has(e.source) || !known.has(e.target)) continue;
      const next = layer.get(e.source)! + 1;
      if (next > layer.get(e.target)!) { layer.set(e.target, next); changed = true; }
    }
    if (!changed) break;
  }

  const maxLayer = Math.max(...layer.values());
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  nodes.forEach((s) => layers[layer.get(s.id)!].push(s.id));

  // 重心排序（两轮：正向 + 反向）
  const indexOf = (arr: string[], id: string) => arr.indexOf(id);
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  edges.forEach((e) => {
    if (!known.has(e.source) || !known.has(e.target)) return;
    (succs.get(e.source) ?? succs.set(e.source, []).get(e.source)!).push(e.target);
    (preds.get(e.target) ?? preds.set(e.target, []).get(e.target)!).push(e.source);
  });
  for (let L = 1; L <= maxLayer; L++) {
    layers[L].sort((a, b) => bary(a, preds, layers[L - 1]) - bary(b, preds, layers[L - 1]));
  }
  for (let L = maxLayer - 1; L >= 0; L--) {
    layers[L].sort((a, b) => bary(a, succs, layers[L + 1]) - bary(b, succs, layers[L + 1]));
  }
  function bary(id: string, rel: Map<string, string[]>, ref: string[]): number {
    const nb = (rel.get(id) ?? []).filter((x) => ref.includes(x));
    if (nb.length === 0) return indexOf(ref, id) >= 0 ? 0 : 0;
    return nb.reduce((acc, x) => acc + indexOf(ref, x), 0) / nb.length;
  }

  // 逐层坐标：LR 横向推进；TB 交换轴向
  const horiz = kind === 'LR';
  let crossCursor = MARGIN; // 主轴游标
  const crossSizes: number[] = layers.map((ids) =>
    ids.reduce((acc, id) => {
      const z = sizes.get(id)!;
      return acc + (horiz ? z.h : z.w) + NODE_GAP;
    }, -NODE_GAP)
  );
  const maxCross = Math.max(...crossSizes, 0);

  layers.forEach((ids, L) => {
    const mainMax = Math.max(...ids.map((id) => (horiz ? sizes.get(id)!.w : sizes.get(id)!.h)));
    let cursor = MARGIN + (maxCross - crossSizes[L]) / 2; // 层内居中
    ids.forEach((id) => {
      const z = sizes.get(id)!;
      const crossPos = cursor;
      const mainPos = crossCursor + (mainMax - (horiz ? z.w : z.h)) / 2;
      result.set(id, horiz
        ? { x: Math.round(mainPos), y: Math.round(crossPos) }
        : { x: Math.round(crossPos), y: Math.round(mainPos) });
      cursor += (horiz ? z.h : z.w) + NODE_GAP;
    });
    crossCursor += mainMax + LAYER_GAP;
  });

  return result;
}

/** 环形布局顺序：自初始结点 BFS，其余按文档序补齐 */
function bfsOrder(doc: ProjectDoc): string[] {
  const order: string[] = [];
  const visited = new Set<string>();
  const adj = new Map<string, string[]>();
  doc.transitions.forEach((t) => {
    if (t.source === t.target) return;
    const arr = adj.get(t.source);
    if (arr) arr.push(t.target); else adj.set(t.source, [t.target]);
  });
  const startId = doc.states.some((s) => s.id === START_ID) ? START_ID : doc.states[0]?.id;
  const queue: string[] = startId ? [startId] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (doc.states.some((s) => s.id === id)) order.push(id);
    (adj.get(id) ?? []).forEach((n) => { if (!visited.has(n)) queue.push(n); });
  }
  doc.states.forEach((s) => { if (!visited.has(s.id)) order.push(s.id); });
  return order;
}
