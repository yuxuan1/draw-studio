/* ============================================================
 * 应用外壳：顶栏（中文菜单）/ 底栏 / 导出弹窗 / 帮助弹窗 / Toast
 * ============================================================ */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useApp } from '../store';
import type { ExportOpts } from '../lib/exporter';
import { buildSvg, downloadSvg, downloadPng, copyPngToClipboard } from '../lib/exporter';
import { SAMPLES, sanitizeFilename } from '../lib/core';

/* ---------------- 图标 ---------------- */

const sv = (d: string, s = 15) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);
const Ic = {
  undo: sv('M8 5L3 10l5 5M3 10h11a6 6 0 0 1 6 6v1'),
  redo: sv('M16 5l5 5-5 5M21 10H10a6 6 0 0 0-6 6v1'),
  grid: sv('M4 4h16v16H4zM4 10h16M10 4v16'),
  map: sv('M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14'),
  sun: sv('M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4'),
  moon: sv('M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z'),
  chevD: sv('M6 9l6 6 6-6', 12),
  check: sv('M5 13l4 4L19 7', 13),
  export: sv('M12 3v12M7 10l5 5 5-5M4 21h16'),
  file: sv('M6 2h9l5 5v15H6V2ZM14 2v6h6'),
  help: sv('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM9.2 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4M12 17.5v.1'),
  copy: sv('M9 9h11v11H9V9ZM5 15H4V4h11v1'),
  download: sv('M12 3v12M7 10l5 5 5-5M4 21h16'),
  newFile: sv('M6 2h9l5 5v15H6V2ZM14 2v6h6M12 11v6M9 14h6'),
  open: sv('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z'),
  save: sv('M5 3h11l5 5v13H5V3ZM8 3v5h7V3M8 21v-7h8v7'),
  fit: sv('M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4'),
};

/* ---------------- 下拉菜单 ---------------- */

function Menu({ label, icon, children, align = 'left' }: {
  label: string; icon?: ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button className={`btn !h-[30px] ${open ? '!border-[var(--accent)] !text-[var(--accent)]' : ''}`}
        onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {icon}{label}{Ic.chevD}
      </button>
      {open && (
        <div className={`menu-panel absolute top-full mt-1 z-50 ${align === 'right' ? 'right-0' : 'left-0'}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, children, kbd, disabled }: {
  onClick: () => void; children: ReactNode; kbd?: string; disabled?: boolean;
}) {
  return (
    <button className="menu-item" role="menuitem" disabled={disabled} onClick={onClick}>
      {children}{kbd && <span className="mi-key">{kbd}</span>}
    </button>
  );
}

/* ---------------- 顶栏 ---------------- */

export function TopBar() {
  const app = useApp();
  const st = app.doc.settings;
  const fileRef = useRef<HTMLInputElement>(null);

  const openFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const text = await f.text();
      app.importRaw(JSON.parse(text), true);
    } catch {
      app.toast('文件解析失败：不是有效的 JSON 工程', 'err');
    }
  };

  return (
    <header className="h-[50px] flex-none flex items-center gap-2 px-3"
      style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
      {/* 品牌 */}
      <div className="flex items-center gap-2 pr-1 select-none">
        <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
          <rect x="1.5" y="11" width="12" height="12" rx="3.5" fill="var(--accent)" />
          <rect x="18.5" y="3" width="12" height="9" rx="3" fill="none" stroke="var(--faint)" strokeWidth="2" />
          <rect x="18.5" y="20" width="12" height="9" rx="3" fill="none" stroke="var(--faint)" strokeWidth="2" />
          <path d="M14 15 L18 8 M14 19 L18 24" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <div className="leading-none">
          <div className="font-display font-bold text-[14.5px] tracking-tight">
            StateFlow <span style={{ color: 'var(--accent)' }}>Studio</span>
          </div>
          <div className="text-[9.5px] mt-[3px] tracking-[0.14em]" style={{ color: 'var(--faint)' }}>状态机图设计器</div>
        </div>
      </div>

      <div className="w-px h-6" style={{ background: 'var(--border)' }} />

      {/* 工程名（内联编辑，不进历史） */}
      <input
        className="font-display font-bold text-[13.5px] !border-transparent hover:!border-[var(--border-strong)] focus:!border-[var(--accent)] !bg-transparent w-[168px] transition-colors"
        style={{ borderRadius: 7 }}
        value={app.doc.name}
        onChange={(e) => app.renameProject(e.target.value)}
        onBlur={(e) => { if (!e.target.value.trim()) app.renameProject('未命名状态机'); }}
        aria-label="工程名" title="点击编辑工程名"
      />

      <div className="w-px h-6" style={{ background: 'var(--border)' }} />

      <button className="icon-btn" onClick={app.undo} disabled={!app.canUndo} title="撤销 (Ctrl/⌘+Z)" aria-label="撤销">{Ic.undo}</button>
      <button className="icon-btn" onClick={app.redo} disabled={!app.canRedo} title="重做 (Ctrl/⌘+Shift+Z)" aria-label="重做">{Ic.redo}</button>

      <div className="w-px h-6" style={{ background: 'var(--border)' }} />

      <Menu label="布局">
        {(close) => (
          <>
            {([['LR', '横向层级（左 → 右）'], ['TB', '纵向层级（上 → 下）'], ['circle', '环形'], ['grid', '网格']] as const).map(([k, label]) => (
              <MenuItem key={k} onClick={() => { app.applyLayout(k); close(); }}>
                <span className="w-4">{st.layout === k && <span style={{ color: 'var(--accent)' }}>{Ic.check}</span>}</span>
                {label}
              </MenuItem>
            ))}
            <div className="menu-sep" />
            <MenuItem onClick={() => { app.applyLayout(st.layout); close(); }} kbd="L">按当前设置重排</MenuItem>
          </>
        )}
      </Menu>

      <button className="icon-btn" onClick={() => app.requestFit()} title="适应视图 (F)" aria-label="适应视图">{Ic.fit}</button>
      <button className={`icon-btn ${st.showGrid ? 'on' : ''}`} onClick={() => app.setViewSettings({ showGrid: !st.showGrid })}
        title="网格背景" aria-label="网格背景" aria-pressed={st.showGrid}>{Ic.grid}</button>
      <button className={`icon-btn ${st.showMiniMap ? 'on' : ''}`} onClick={() => app.setViewSettings({ showMiniMap: !st.showMiniMap })}
        title="小地图" aria-label="小地图" aria-pressed={st.showMiniMap}>{Ic.map}</button>
      <button className="icon-btn" onClick={() => app.setViewSettings({ theme: st.theme === 'light' ? 'dark' : 'light' })}
        title={st.theme === 'light' ? '切换暗色主题' : '切换亮色主题'} aria-label="切换主题">
        {st.theme === 'light' ? Ic.moon : Ic.sun}
      </button>

      <div className="flex-1" />

      <Menu label="导出" icon={Ic.export}>
        {(close) => (
          <>
            <MenuItem onClick={() => { app.setModal('export'); close(); }}>导出图片…（PNG / SVG）</MenuItem>
            <MenuItem onClick={async () => {
              close();
              try { await copyPngToClipboard(app.doc); app.toast('已复制 2× PNG 到剪贴板'); }
              catch { app.toast('复制失败，请改用「导出图片」下载', 'err'); }
            }}>{Ic.copy} 复制 PNG 到剪贴板</MenuItem>
            <div className="menu-sep" />
            <MenuItem onClick={() => { app.saveProjectFile(); close(); }} kbd="Ctrl S">{Ic.save} 保存工程文件</MenuItem>
          </>
        )}
      </Menu>

      <Menu label="文件" icon={Ic.file}>
        {(close) => (
          <>
            <MenuItem onClick={() => { app.newProject(); close(); }}>{Ic.newFile} 新建空白工程</MenuItem>
            <MenuItem onClick={() => { fileRef.current?.click(); close(); }}>{Ic.open} 打开工程文件…</MenuItem>
            <MenuItem onClick={() => { app.saveProjectFile(); close(); }} kbd="Ctrl S">{Ic.save} 保存工程文件</MenuItem>
            <div className="menu-sep" />
            {SAMPLES.map((s, i) => (
              <MenuItem key={s.name} onClick={() => { app.loadSample(i); close(); }}>载入示例：{s.name}</MenuItem>
            ))}
          </>
        )}
      </Menu>

      <Menu label="帮助" icon={Ic.help} align="right">
        {(close) => (
          <>
            <MenuItem onClick={() => { app.setHelpTab('keys'); app.setModal('help'); close(); }}>快捷键速查</MenuItem>
            <MenuItem onClick={() => { app.setHelpTab('syntax'); app.setModal('help'); close(); }}>标签语法说明</MenuItem>
            <div className="menu-sep" />
            <MenuItem onClick={() => { app.setHelpTab('about'); app.setModal('help'); close(); }}>关于本工具</MenuItem>
          </>
        )}
      </Menu>

      <input ref={fileRef} type="file" accept=".json,.smflow.json,application/json" className="hidden"
        onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ''; }} aria-hidden />
    </header>
  );
}

/* ---------------- 底栏 ---------------- */

export function StatusBar() {
  const app = useApp();
  const { states, transitions } = app.sel;
  const total = app.doc.transitions.length;
  const hidden = app.doc.transitions.filter((t) => !t.enabled).length;
  const selText = states.length || transitions.length
    ? `已选中 ${states.length} 状态 / ${transitions.length} 转移`
    : '双击空白处新建状态 · 拖节点圆点连线';

  return (
    <footer className="h-[30px] flex-none flex items-center gap-4 px-3.5 text-[11.5px]"
      style={{ background: 'var(--panel)', borderTop: '1px solid var(--border)', color: 'var(--muted)' }}>
      <span className="font-display font-semibold" style={{ color: 'var(--text)' }}>
        {app.doc.states.length} 个状态 · {total} 条转移
        {hidden > 0 && <span style={{ color: 'var(--warn)' }}>（{hidden} 条隐藏）</span>}
      </span>
      <span className="flex-1 text-center truncate" style={{ color: states.length || transitions.length ? 'var(--accent)' : undefined }}>
        {selText}
      </span>
      <span className="flex items-center gap-1.5">
        <span key={app.savedAt} className="w-[7px] h-[7px] rounded-full save-pulse" style={{ background: 'var(--accent)' }} />
        工程自动保存在本地浏览器中
        {app.savedAt > 0 && (
          <span className="font-code" style={{ color: 'var(--faint)' }}>
            {new Date(app.savedAt).toLocaleTimeString('zh-CN', { hour12: false })}
          </span>
        )}
      </span>
    </footer>
  );
}

/* ---------------- 弹窗外壳 ---------------- */

function ModalShell({ title, onClose, children, width }: {
  title: string; onClose: () => void; children: ReactNode; width: number;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center anim-fade"
      style={{ background: 'rgba(10,14,20,0.5)', backdropFilter: 'blur(2px)' }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="anim-modal rounded-[14px] overflow-hidden flex flex-col max-h-[86vh]"
        style={{ width, background: 'var(--panel-2)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-pop)' }}>
        <div className="h-[46px] flex-none flex items-center px-4"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--panel)' }}>
          <span className="font-display font-bold text-[14px]">{title}</span>
          <button className="icon-btn ml-auto" onClick={onClose} aria-label="关闭" title="关闭 (Esc)">
            {sv('M6 6l12 12M18 6L6 18')}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------------- 导出弹窗 ---------------- */

export function ExportModal() {
  const app = useApp();
  const [opts, setOpts] = useState<ExportOpts>({
    format: 'png', scale: 2, bg: 'white', margin: 32, showLabels: true,
  });
  const set = (patch: Partial<ExportOpts>) => setOpts((o) => ({ ...o, ...patch }));

  const svg = useMemo(() => buildSvg(app.doc, opts), [app.doc, opts]);
  const filename = opts.format === 'svg'
    ? `${sanitizeFilename(app.doc.name)}.svg`
    : `${sanitizeFilename(app.doc.name)}@${opts.scale}x.png`;

  return (
    <ModalShell title="导出图片" onClose={() => app.setModal(null)} width={780}>
      <div className="flex flex-1 min-h-0">
        {/* 选项 */}
        <div className="w-[252px] flex-none overflow-y-auto p-4" style={{ borderRight: '1px solid var(--border)' }}>
          <div className="field-label">格式</div>
          <div className="seg mb-3">
            <button className={`seg-btn ${opts.format === 'png' ? 'on' : ''}`} onClick={() => set({ format: 'png' })}>PNG 位图</button>
            <button className={`seg-btn ${opts.format === 'svg' ? 'on' : ''}`} onClick={() => set({ format: 'svg' })}>SVG 矢量</button>
          </div>

          {opts.format === 'png' && (
            <>
              <div className="field-label">倍率（越高越清晰）</div>
              <div className="seg mb-3">
                {([1, 2, 3, 4] as const).map((s) => (
                  <button key={s} className={`seg-btn ${opts.scale === s ? 'on' : ''}`} onClick={() => set({ scale: s })}>{s}×</button>
                ))}
              </div>
            </>
          )}

          <div className="field-label">背景</div>
          <div className="seg mb-3">
            {([['white', '白色'], ['transparent', '透明'], ['theme', '跟随主题']] as const).map(([k, label]) => (
              <button key={k} className={`seg-btn ${opts.bg === k ? 'on' : ''}`} onClick={() => set({ bg: k })}>{label}</button>
            ))}
          </div>

          <div className="field-label">边距</div>
          <div className="seg mb-3">
            {([[0, '紧凑'], [32, '适中'], [72, '宽松']] as const).map(([k, label]) => (
              <button key={k} className={`seg-btn ${opts.margin === k ? 'on' : ''}`} onClick={() => set({ margin: k })}>{label}</button>
            ))}
          </div>

          <div className="rounded-[9px] px-2.5 mb-3" style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between py-[8px]">
              <span className="text-[12.5px] font-medium">转移标签</span>
              <button className={`switch ${opts.showLabels ? 'on' : ''}`} role="switch" aria-checked={opts.showLabels}
                aria-label="转移标签" onClick={() => set({ showLabels: !opts.showLabels })} />
            </div>
          </div>

          <div className="text-[11px] font-code mb-3 px-2 py-1.5 rounded-[7px] truncate"
            style={{ background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--muted)' }}
            title={filename}>
            {filename}
          </div>

          <button className="btn btn-accent w-full justify-center !h-[34px]"
            onClick={async () => {
              try {
                if (opts.format === 'svg') downloadSvg(app.doc, opts);
                else await downloadPng(app.doc, opts);
                app.toast(`已导出 ${filename}`);
              } catch {
                app.toast('导出失败，请重试', 'err');
              }
            }}>
            {Ic.download} 下载
          </button>
          <button className="btn w-full justify-center !h-[34px] mt-1.5"
            onClick={async () => {
              try { await copyPngToClipboard(app.doc); app.toast('已复制 2× 白底 PNG 到剪贴板'); }
              catch { app.toast('复制失败，请改用下载', 'err'); }
            }}>
            {Ic.copy} 复制到剪贴板（2× 白底）
          </button>
        </div>

        {/* 实时预览 */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="text-[11px] px-4 pt-2.5 pb-1.5 flex-none" style={{ color: 'var(--faint)' }}>
            实时预览 · 与画布所见一致
          </div>
          <div className={`flex-1 m-3 mt-1 rounded-[10px] overflow-auto grid place-items-center p-4 ${opts.bg === 'transparent' ? 'checker' : ''}`}
            style={{
              border: '1px solid var(--border)',
              background: opts.bg === 'transparent' ? undefined : opts.bg === 'white' ? '#fff' : 'var(--canvas-bg)',
            }}>
            <div className="[&_svg]:max-w-full [&_svg]:h-auto max-w-full anim-fade" key={svg.length}
              dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

/* ---------------- 帮助弹窗 ---------------- */

export function HelpModal() {
  const app = useApp();
  const tab = app.helpTab;
  const TabBtn = ({ k, label }: { k: string; label: string }) => (
    <button className={`panel-tab !h-[38px] ${tab === k ? 'on' : ''}`} onClick={() => app.setHelpTab(k)}>{label}</button>
  );
  return (
    <ModalShell title="帮助" onClose={() => app.setModal(null)} width={640}>
      <div className="flex gap-1 px-3 pt-2" style={{ borderBottom: '1px solid var(--border)' }}>
        <TabBtn k="keys" label="快捷键速查" />
        <TabBtn k="syntax" label="标签语法说明" />
        <TabBtn k="about" label="关于本工具" />
      </div>
      <div className="p-5 overflow-y-auto anim-fade" key={tab}>
        {tab === 'keys' && (
          <table className="w-full text-[12.5px]">
            <tbody>
              {([
                ['双击画布空白处', '新建状态（自动命名 StateN）'],
                ['双击结点', '行内重命名（回车确认 / Esc 取消）'],
                ['拖拽结点边缘圆点', '创建转移（拖到目标结点上松开）'],
                ['Shift + 拖拽空白', '框选多个状态'],
                ['Shift + 点击', '加选 / 减选'],
                ['Delete / Backspace', '删除选中的状态或转移'],
                ['Ctrl/⌘ + Z', '撤销'],
                ['Ctrl/⌘ + Shift + Z 或 Ctrl + Y', '重做'],
                ['Ctrl/⌘ + S', '保存工程文件（.smflow.json）'],
                ['F', '适应视图'],
                ['L', '按最近布局设置重新排布'],
                ['滚轮', '缩放画布（0.15× – 2.5×）'],
                ['拖拽空白 / 小地图点击', '平移画布 / 快速定位'],
              ] as [string, string][]).map(([k, v]) => (
                <tr key={k} style={{ borderBottom: '1px dashed var(--border)' }}>
                  <td className="py-[9px] pr-3 whitespace-nowrap"><kbd>{k}</kbd></td>
                  <td className="py-[9px]" style={{ color: 'var(--muted)' }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'syntax' && (
          <div className="text-[12.5px] leading-[1.8]">
            <p style={{ color: 'var(--muted)' }}>转移标签采用 Stateflow 风格四段语法：</p>
            <pre className="font-code text-[12px] my-3 px-3.5 py-3 rounded-[10px] overflow-x-auto"
              style={{ background: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--accent)' }}>
              event[condition]&#123;condition_action&#125;/transition_action
            </pre>
            <table className="w-full">
              <tbody>
                {([
                  ['event', '触发事件', 'TICK、CMD_START'],
                  ['[condition]', '守卫条件（方括号）', '[cnt >= 30]'],
                  ['{condition_action}', '条件为真时动作（花括号）', '{cnt = 0;}'],
                  ['/transition_action', '转移动作（斜杠后全部）', '/next()'],
                ] as [string, string, string][]).map(([k, v, ex]) => (
                  <tr key={k} style={{ borderBottom: '1px dashed var(--border)' }}>
                    <td className="py-[8px] pr-2 font-code font-semibold whitespace-nowrap" style={{ color: 'var(--text)' }}>{k}</td>
                    <td className="py-[8px] pr-3" style={{ color: 'var(--muted)' }}>{v}</td>
                    <td className="py-[8px] font-code text-[11.5px] whitespace-nowrap" style={{ color: 'var(--accent)' }}>{ex}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="mt-3 space-y-1.5" style={{ color: 'var(--muted)' }}>
              <li>· 四段<b style={{ color: 'var(--text)' }}>顺序任意</b>，但括号必须配对（支持嵌套匹配）；<kbd>/</kbd> 之后剩余文本全部视为转移动作。</li>
              <li>· 空标签 = 无条件、无动作的<b style={{ color: 'var(--text)' }}>默认转移</b>（如初始结点指向初始状态）。</li>
              <li>· 编辑时四段独立存储；画布与导出按 <span className="font-code">event[cond]&#123;act&#125;/ta</span> 顺序规范化拼接，标签分两行显示。</li>
              <li>· 标签按纯文本处理，不做表达式语义校验。</li>
            </ul>
          </div>
        )}
        {tab === 'about' && (
          <div className="text-center py-2">
            <svg width="52" height="52" viewBox="0 0 32 32" className="mx-auto mb-3" aria-hidden>
              <rect x="1.5" y="11" width="12" height="12" rx="3.5" fill="var(--accent)" />
              <rect x="18.5" y="3" width="12" height="9" rx="3" fill="none" stroke="var(--faint)" strokeWidth="2" />
              <rect x="18.5" y="20" width="12" height="9" rx="3" fill="none" stroke="var(--faint)" strokeWidth="2" />
              <path d="M14 15 L18 8 M14 19 L18 24" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <div className="font-display font-bold text-[19px]">StateFlow Studio</div>
            <div className="text-[12px] mt-1" style={{ color: 'var(--muted)' }}>
              面向嵌入式 / 航空电子 / 状态建模场景的桌面级状态机图设计器
            </div>
            <div className="mt-3 inline-block text-[11px] font-display px-2.5 py-1 rounded-full"
              style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              v1.0 · 工程文件 version 1
            </div>
            <ul className="text-[12px] mt-4 space-y-1.5 text-left max-w-[380px] mx-auto" style={{ color: 'var(--muted)' }}>
              <li>· 以 Stateflow 风格转移标签为核心输入，画布与表格双向同步。</li>
              <li>· 纯前端单机离线运行：无账号、无网络请求、无遥测。</li>
              <li>· 工程每 500ms 自动保存到本地浏览器；可另存为 <span className="font-code">.smflow.json</span> 文件携带。</li>
              <li>· 导出自包含 SVG / 多倍率 PNG，与画布所见一致。</li>
            </ul>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

/* ---------------- Toast ---------------- */

export function Toasts() {
  const app = useApp();
  return (
    <div className="fixed bottom-[46px] left-1/2 -translate-x-1/2 z-[99] flex flex-col items-center gap-2 pointer-events-none">
      {app.toasts.map((t) => (
        <div key={t.id}
          className="px-4 py-2.5 rounded-[10px] text-[12.5px] font-medium flex items-center gap-2 shadow-lg"
          style={{
            animation: 'toast-in 0.22s cubic-bezier(0.2,0.9,0.3,1.15)',
            background: 'var(--panel-2)',
            border: `1px solid ${t.type === 'err' ? 'var(--danger)' : t.type === 'ok' ? 'var(--accent)' : 'var(--border)'}`,
            color: 'var(--text)',
            boxShadow: 'var(--shadow-pop)',
          }}>
          <span style={{ color: t.type === 'err' ? 'var(--danger)' : t.type === 'ok' ? 'var(--accent)' : 'var(--muted)' }}>
            {t.type === 'err'
              ? sv('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM12 7v6M12 16.5v.1')
              : t.type === 'ok'
                ? sv('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM8 12.5l2.8 2.8L16.5 9.5')
                : sv('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM12 11v6M12 7v.1')}
          </span>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
