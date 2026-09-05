/**
 * boardkit —— 流程图 / 白板两个新编辑器共用的底层工具：
 *  - useHistory：带「拖拽批处理」的轻量撤销/重做
 *  - BkIcon：内联 SVG 图标集（与主应用风格一致的 24 网格 stroke 图标）
 *  - BOARD_COLORS：形状填充 / 描边色板（明暗通用的高饱和色 + 中性色）
 *  - svgToPng / downloadBlob：把 SVG 字符串光栅化为 PNG 并下载
 *  - ResizeHandles：选中图元右下角的缩放手柄（SVG 组件）
 */
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/* ---------- 撤销 / 重做（支持拖拽期间不产生历史点） ---------- */
export function useHistory<T>(initial: T) {
  const [st, setSt] = useState({ past: [] as T[], present: initial, future: [] as T[] });
  const batch = useRef<T | null>(null);

  /** commit=true 入历史；commit=false 仅更新 present（拖拽过程用） */
  const set = useCallback((next: T, commit = true) => {
    setSt((s) =>
      commit
        ? { past: [...s.past.slice(-99), s.present], present: next, future: [] }
        : { ...s, present: next },
    );
  }, []);

  const beginBatch = useCallback(() => {
    setSt((s) => {
      batch.current = s.present;
      return s;
    });
  }, []);

  const endBatch = useCallback(() => {
    const snap = batch.current;
    batch.current = null;
    if (snap !== null) {
      setSt((s) => ({ past: [...s.past.slice(-99), snap], present: s.present, future: [] }));
    }
  }, []);

  const undo = useCallback(() => {
    setSt((s) =>
      s.past.length
        ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] }
        : s,
    );
  }, []);

  const redo = useCallback(() => {
    setSt((s) =>
      s.future.length
        ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) }
        : s,
    );
  }, []);

  return {
    value: st.present,
    set,
    beginBatch,
    endBatch,
    undo,
    redo,
    canUndo: st.past.length > 0,
    canRedo: st.future.length > 0,
  };
}

/* ---------- 图标 ---------- */
export function BkIcon({ d, size = 16, sw = 1.8 }: { d: string; size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export const BI = {
  state: 'M6 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm-6-9a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 0c3 0 6 2 6 5M6 9c0 5 3 6 6 6',
  flow: 'M5 4h6v5H5zM13 15h6v5h-6zM13 4h6v5h-6zM8 9v3.5a2 2 0 0 0 2 2h6M16 9v2.5a2 2 0 0 1-2 2h-1',
  board: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5Zm4 10-2.5 3h13L15 13.5 12.5 16 10 13l-2 2ZM9.5 8.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3',
  trash: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  undo: 'M8 5 3 10l5 5M3 10h11a6 6 0 0 1 6 6v1',
  redo: 'm16 5 5 5-5 5M21 10H10a6 6 0 0 0-6 6v1',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8L17 7M7 17l-1.4 1.4',
  moon: 'M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5Z',
  image: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5Zm4 9-2.5 4h13L15 13l-2.5 3L10 13.5 8 14Zm1.5-5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  cursor: 'M5 3l7.5 17 1.8-6.7L21 11.5 5 3Z',
  rect: 'M5 6h14v12H5z',
  ellipse: 'M12 6c4 0 7 2.7 7 6s-3 6-7 6-7-2.7-7-6 3-6 7-6Z',
  arrow: 'M4 18 18 6m0 0h-8m8 0v8',
  line: 'M5 19 19 5',
  text: 'M5 6V4h14v2M12 4v16m-3 0h6',
  chevR: 'm9 6 6 6-6 6',
  chevD: 'm6 9 6 6 6-6',
  child: 'M12 5v14m-6-6 6 6 6-6',
  sibling: 'M5 12h14m-6-6 6 6-6 6',
  expand: 'M4 8V5a1 1 0 0 1 1-1h3m12 0h-3m3 0v3m0 8v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 8l4 4m12-4-4 4M4 16l4-4m12 4-4-4',
  collapse: 'M9 4v3a1 1 0 0 1-1 1H5m14 0h-3a1 1 0 0 1-1-1V4M9 20v-3a1 1 0 0 0-1-1H5m14 0h-3a1 1 0 0 0 1-1v3M9 8l3-3 3 3M9 16l3 3 3-3',
  front: 'M8 8h12v12H8zM4 16V4h12',
  back: 'M4 4h12v12H4zm16 4v12H8',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  hand: 'M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5v-1a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V13m-9-1v6l-1.8-2.2a1.6 1.6 0 0 0-2.5 2L8 21h8a4 4 0 0 0 4-4v-4',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
};

/* ---------- 形状色板 ---------- */
export const BOARD_COLORS = [
  { key: 'indigo', fill: '#6366f1', soft: '#eef2ff' },
  { key: 'sky', fill: '#0ea5e9', soft: '#e0f2fe' },
  { key: 'teal', fill: '#14b8a6', soft: '#ccfbf1' },
  { key: 'green', fill: '#22c55e', soft: '#dcfce7' },
  { key: 'amber', fill: '#f59e0b', soft: '#fef3c7' },
  { key: 'orange', fill: '#f97316', soft: '#ffedd5' },
  { key: 'rose', fill: '#f43f5e', soft: '#ffe4e6' },
  { key: 'violet', fill: '#8b5cf6', soft: '#f3e8ff' },
  { key: 'slate', fill: '#64748b', soft: '#f1f5f9' },
  { key: 'ink', fill: '#334155', soft: '#e2e8f0' },
];

export const NEUTRAL_STROKES = ['#334155', '#64748b', '#0ea5e9', '#14b8a6', '#f59e0b', '#f43f5e', '#8b5cf6'];

export function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** 依据填充色亮度返回适合叠加的文字色 */
export function readableOn(hex: string): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1e293b' : '#ffffff';
}

/**
 * 纯 SVG <text> 换行（导出光栅化时 foreignObject 会丢字，故用 <tspan>）。
 * 字宽估算：CJK≈1em，拉丁≈0.56em，与主应用口径一致。
 */
export function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const charW = (ch: string) => (ch.charCodeAt(0) > 0x2e80 ? fontSize : fontSize * 0.56);
  const lines: string[] = [];
  for (const raw of (text || '').split('\n')) {
    let cur = '', w = 0;
    for (const ch of raw) {
      const cw = charW(ch);
      if (w + cw > maxWidth && cur) { lines.push(cur); cur = ch; w = cw; }
      else { cur += ch; w += cw; }
    }
    lines.push(cur);
  }
  return lines.length ? lines : [''];
}

/* ---------- SVG 导出 ---------- */
export function svgToPng(svg: string, w: number, h: number, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = Math.round(w * scale);
      cv.height = Math.round(h * scale);
      const ctx = cv.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('no ctx')); return; }
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('svg load failed')); };
    img.src = url;
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function uid(prefix = 'n'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/* ---------- 缩放手柄（选中图元右下角） ---------- */
export function ResizeHandles({
  x, y, w, h, onResize, accent, onBegin, onEnd,
}: {
  x: number; y: number; w: number; h: number; accent: string;
  onResize: (dw: number, dh: number) => void;
  onBegin?: () => void; onEnd?: () => void;
}) {
  const start = useRef<{ px: number; py: number } | null>(null);
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={accent} strokeWidth={1.4}
        strokeDasharray="5 4" pointerEvents="none" rx={4} />
      <rect
        x={x + w - 5} y={y + h - 5} width={10} height={10} rx={2.5}
        fill="#fff" stroke={accent} strokeWidth={1.6}
        style={{ cursor: 'nwse-resize' }}
        onPointerDown={(e) => {
          e.stopPropagation();
          (e.target as Element).setPointerCapture(e.pointerId);
          start.current = { px: e.clientX, py: e.clientY };
          onBegin?.();
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          onResize(e.clientX - start.current.px, e.clientY - start.current.py);
          start.current = { px: e.clientX, py: e.clientY };
        }}
        onPointerUp={() => { start.current = null; onEnd?.(); }}
      />
    </g>
  );
}

/* ---------- 通用分段按钮 ---------- */
export function Seg({ options, value, onChange, size = 'sm' }: {
  options: { key: string; label: ReactNode; title?: string }[];
  value: string; onChange: (k: string) => void; size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex rounded-lg p-0.5 gap-0.5" style={{ background: 'var(--panel-2)' }}>
      {options.map((o) => (
        <button key={o.key} title={o.title} onClick={() => onChange(o.key)}
          className={`rounded-md font-medium transition-all ${size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'} ${value === o.key ? 'seg-on' : 'seg-off'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
