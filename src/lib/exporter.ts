/* ============================================================
 * 导出渲染器：自包含 SVG / PNG 光栅化 / 剪贴板 / 下载
 * 与画布共用 <GraphLayer/>，保证所见即所得
 * ============================================================ */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProjectDoc } from './core';
import { THEME, FONT_STACK, sanitizeFilename } from './core';
import { docBounds, computeEdgeGeoms } from './geometry';
import { GraphLayer } from '../components/GraphLayer';

export interface ExportOpts {
  format: 'png' | 'svg';
  scale: 1 | 2 | 3 | 4;
  bg: 'white' | 'transparent' | 'theme';
  margin: 0 | 32 | 72;
  showLabels: boolean;
}

export function buildSvg(doc: ProjectDoc, opts: ExportOpts): string {
  const theme = doc.settings.theme;
  const geoms = computeEdgeGeoms(doc, doc.settings, theme);
  const b = docBounds(doc, doc.settings, geoms);
  const m = opts.margin;
  const W = Math.max(1, Math.round(b.w + m * 2));
  const H = Math.max(1, Math.round(b.h + m * 2));
  const bg = opts.bg === 'white' ? '#ffffff' : opts.bg === 'theme' ? THEME[theme].canvas : '';
  const inner = renderToStaticMarkup(
    createElement(GraphLayer, { doc, theme, showEdgeLabels: opts.showLabels })
  );
  const tx = (m - b.x).toFixed(1);
  const ty = (m - b.y).toFixed(1);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT_STACK}">`,
    `<!-- StateFlow Studio · ${doc.name} · 自包含 SVG（无外部依赖） -->`,
    bg ? `<rect width="${W}" height="${H}" fill="${bg}"/>` : '',
    `<g transform="translate(${tx},${ty})">${inner}</g>`,
    `</svg>`,
  ].filter(Boolean).join('\n');
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadSvg(doc: ProjectDoc, opts: ExportOpts) {
  const svg = buildSvg(doc, opts);
  downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${sanitizeFilename(doc.name)}.svg`);
}

/** PNG 光栅化：SVG → Image → Canvas → Blob */
export async function rasterizePng(doc: ProjectDoc, opts: ExportOpts): Promise<Blob> {
  const svg = buildSvg(doc, { ...opts, format: 'svg' });
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const img = new Image();
  img.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('svg rasterize failed'));
    img.src = url;
  });
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = opts.scale;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

export async function downloadPng(doc: ProjectDoc, opts: ExportOpts) {
  const blob = await rasterizePng(doc, opts);
  downloadBlob(blob, `${sanitizeFilename(doc.name)}@${opts.scale}x.png`);
}

/** 复制到剪贴板：2× 白底 PNG（FR-8.9） */
export async function copyPngToClipboard(doc: ProjectDoc): Promise<void> {
  const blob = await rasterizePng(doc, {
    format: 'png', scale: 2, bg: 'white', margin: 32, showLabels: true,
  });
  const Ctor = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (!Ctor || !navigator.clipboard?.write) throw new Error('clipboard unsupported');
  await navigator.clipboard.write([new Ctor({ 'image/png': blob })]);
}
