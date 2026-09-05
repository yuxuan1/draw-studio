/* ============================================================
 * GraphLayer：结点 + 连线的纯 SVG 渲染层
 * 画布（交互态）与导出（renderToStaticMarkup）共用，保证 WYSIWYG
 * ============================================================ */

import { useMemo } from 'react';
import type { ProjectDoc, ProjectState, ThemeMode } from '../lib/core';
import {
  PALETTES, THEME, FONT_STACK, START_ID, nodeSize, truncateText,
} from '../lib/core';
import {
  computeEdgeGeoms, shapesOf, arrowPoints, renderActionLines,
} from '../lib/geometry';

export interface GraphLayerProps {
  doc: ProjectDoc;
  theme: ThemeMode;
  showEdgeLabels?: boolean;
  interactive?: boolean;
  selectedStates?: ReadonlySet<string>;
  selectedTransitions?: ReadonlySet<string>;
  hoverId?: string | null;
  connectTargetId?: string | null;
}

export function GraphLayer({
  doc, theme, showEdgeLabels = true, interactive = false,
  selectedStates, selectedTransitions, hoverId, connectTargetId,
}: GraphLayerProps) {
  const settings = doc.settings;
  const T = THEME[theme];
  const geoms = useMemo(
    () => computeEdgeGeoms(doc, settings, theme),
    [doc, settings, theme]
  );
  const shapes = useMemo(() => shapesOf(doc, settings), [doc, settings]);

  return (
    <g fontFamily={FONT_STACK}>
      {/* ---------- 连线层 ---------- */}
      <g>
        {geoms.map((g) => {
          const sel = selectedTransitions?.has(g.id) ?? false;
          const color = sel ? T.sel : g.color;
          const width = sel ? Math.max(g.width, 2) : g.width;
          return (
            <g key={g.id} data-edge-id={g.id}>
              {interactive && (
                <path d={g.d} fill="none" stroke="rgba(0,0,0,0)" strokeWidth={18}
                  strokeLinecap="round" style={{ pointerEvents: 'stroke', cursor: 'pointer' }} />
              )}
              {sel && (
                <path d={g.d} fill="none" stroke={T.selGlow} strokeWidth={width + 6}
                  strokeLinecap="round" />
              )}
              <path d={g.d} fill="none" stroke={color} strokeWidth={width}
                strokeDasharray={g.dash} strokeLinecap="round" />
              <polygon points={arrowPoints(g.ax, g.ay, g.aa, settings.arrowSize)} fill={color} />
              {showEdgeLabels && g.lines.length > 0 && (
                <g transform={`translate(${(g.labelX - g.labelW / 2).toFixed(1)},${(g.labelY - g.labelH / 2).toFixed(1)})`}>
                  <rect width={g.labelW} height={g.labelH} rx={g.labelH / 2}
                    fill={T.edgeLabelBg} stroke={sel ? T.sel : T.edgeLabelBorder} strokeWidth={sel ? 1.4 : 1} />
                  {g.lines.map((line, i) => (
                    <text key={i} x={g.labelW / 2} y={13 + i * 15} textAnchor="middle"
                      fontSize={11} fontWeight={sel ? 700 : 500} fill={sel ? T.sel : T.edgeLabelText}>
                      {line}
                    </text>
                  ))}
                </g>
              )}
            </g>
          );
        })}
      </g>

      {/* ---------- 结点层 ---------- */}
      <g>
        {doc.states.map((s) => (
          <NodeGlyph key={s.id} s={s} doc={doc} theme={theme} T={T}
            selected={selectedStates?.has(s.id) ?? false}
            showHandles={interactive && (hoverId === s.id)}
            connectTarget={connectTargetId === s.id}
            interactive={interactive} />
        ))}
      </g>
    </g>
  );
}

/* ---------------- 单个结点 ---------------- */

function NodeGlyph({
  s, doc, theme, T, selected, showHandles, connectTarget, interactive,
}: {
  s: ProjectState;
  doc: ProjectDoc;
  theme: ThemeMode;
  T: (typeof THEME)[ThemeMode];
  selected: boolean;
  showHandles: boolean;
  connectTarget: boolean;
  interactive: boolean;
}) {
  const settings = doc.settings;
  const { w, h } = nodeSize(s, settings);
  const pal = PALETTES[s.color]?.[theme] ?? PALETTES.indigo[theme];
  const x = s.position.x, y = s.position.y;
  const stroke = connectTarget ? T.sel : selected ? T.sel : pal.border;
  const sw = selected || connectTarget ? 2.2 : 1.5;

  const handles = s.kind === 'junction' || s.kind === 'start'
    ? [
        { hx: x + w / 2, hy: y - 2 }, { hx: x + w + 2, hy: y + h / 2 },
        { hx: x + w / 2, hy: y + h + 2 }, { hx: x - 2, hy: y + h / 2 },
      ]
    : [
        { hx: x + w / 2, hy: y }, { hx: x + w, hy: y + h / 2 },
        { hx: x + w / 2, hy: y + h }, { hx: x, hy: y + h / 2 },
      ];

  return (
    <g data-node-id={s.id} transform={`translate(${x},${y})`}
      style={interactive ? { cursor: 'move' } : undefined}>
      {/* 选中光环 */}
      {(selected || connectTarget) && (
        s.kind === 'junction' || s.kind === 'start' ? (
          <circle cx={w / 2} cy={h / 2} r={(s.kind === 'junction' ? 13 : 11) + 5}
            fill="none" stroke={T.selGlow} strokeWidth={6} />
        ) : (
          <rect x={-5} y={-5} width={w + 10} height={h + 10} rx={14}
            fill="none" stroke={T.selGlow} strokeWidth={6} />
        )
      )}

      {s.kind === 'junction' && (
        <circle cx={w / 2} cy={h / 2} r={13} fill={T.junctionFill}
          stroke={selected || connectTarget ? T.sel : T.junctionBorder} strokeWidth={2.5} />
      )}

      {s.kind === 'start' && (
        <>
          <circle cx={w / 2} cy={h / 2} r={11} fill={T.startFill}
            stroke={selected || connectTarget ? T.sel : 'none'} strokeWidth={2} />
          <circle cx={w / 2} cy={h / 2} r={3.6} fill={T.startDot} />
        </>
      )}

      {(s.kind === 'state' || s.kind === 'terminal') && (
        <>
          <rect width={w} height={h} rx={10} fill={pal.fill}
            stroke={stroke} strokeWidth={sw} />
          {s.kind === 'terminal' && (
            <rect x={3.5} y={3.5} width={w - 7} height={h - 7} rx={7}
              fill="none" stroke={pal.border} strokeWidth={1.2} opacity={0.85} />
          )}
          <rect x={1} y={8} width={4} height={h - 16} rx={2} fill={pal.accent} />
          <text x={15} y={22.5} fontSize={13} fontWeight={650} fill={pal.text}>
            {truncateText(s.name || 'State', 13, w - 26)}
          </text>
          {renderActionLines(s, settings, w).map((l, i) => (
            <text key={i} x={15} y={NODE_ACTION_BASE + i * 16} fontSize={11}>
              <tspan fontStyle="italic" fill={T.muted}>{l.k}/ </tspan>
              <tspan fill={T.actionText}>{l.t}</tspan>
            </text>
          ))}
        </>
      )}

      {/* 连线手柄（画布交互态） */}
      {showHandles && handles.map((p, i) => (
        <circle key={i} data-handle="1" data-node-id={s.id}
          cx={p.hx - x} cy={p.hy - y} r={5.5}
          fill={T.sel} stroke="#fff" strokeWidth={1.6}
          style={{ cursor: 'crosshair', pointerEvents: 'all' }} />
      ))}
    </g>
  );
}

const NODE_ACTION_BASE = 34 + 11.5;
