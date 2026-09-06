/* ============================================================
 * command —— Command 模式 + 历史栈（可撤销/重做）
 *
 * 红线 C10：所有模型修改必须经 Command。
 * MergeableCommand：连续拖拽的 MoveNode 合并为一条 Undo（merge 吞并）。
 * 历史栈单一，覆盖 Domain + Layout。
 * ============================================================ */

export interface Command<T> {
  label: string;
  execute(state: T): T;
  undo(state: T): T;
  /** 若可与下一条合并返回合并后的命令，否则返回 null */
  merge?(next: Command<T>): Command<T> | null;
}

export interface History<T> {
  present: T;
  past: Command<T>[];
  future: Command<T>[];
}

export function createHistory<T>(initial: T): History<T> {
  return { present: initial, past: [], future: [] };
}

const MAX_HISTORY = 100;

export function execute<T>(h: History<T>, cmd: Command<T>): History<T> {
  const next = cmd.execute(h.present);
  // 尝试与栈顶合并（拖拽连续移动）
  const top = h.past[h.past.length - 1];
  if (top && top.merge) {
    const merged = top.merge(cmd);
    if (merged) {
      return { present: next, past: [...h.past.slice(0, -1), merged], future: [] };
    }
  }
  return { present: next, past: [...h.past.slice(-(MAX_HISTORY - 1)), cmd], future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  const cmd = h.past[h.past.length - 1];
  const prev = cmd.undo(h.present);
  return { present: prev, past: h.past.slice(0, -1), future: [cmd, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  const cmd = h.future[0];
  const next = cmd.execute(h.present);
  return { present: next, past: [...h.past, cmd], future: h.future.slice(1) };
}

/* ---------------- 常用命令工厂 ---------------- */

/** 通用"替换整个状态"命令（带可选合并键，用于拖拽批处理） */
export function replaceCmd<T>(
  label: string, before: T, after: T, mergeKey?: string,
): Command<T> {
  const cmd: Command<T> & { key?: string } = {
    label,
    execute: () => after,
    undo: () => before,
  };
  if (mergeKey) {
    cmd.key = mergeKey;
    cmd.merge = (next) => {
      const n = next as Command<T> & { key?: string };
      if (n.key === mergeKey) {
        // 合并：保留最初 before，吞并最新 after
        return replaceCmd(label, before, (next.execute as () => T)(), mergeKey);
      }
      return null;
    };
  }
  return cmd;
}

/** BatchCommand：多条命令打包为一个 Undo 单元（对齐/分布/自动布局用） */
export function batchCmd<T>(label: string, cmds: Command<T>[]): Command<T> {
  return {
    label,
    execute: (s) => cmds.reduce((acc, c) => c.execute(acc), s),
    undo: (s) => [...cmds].reverse().reduce((acc, c) => c.undo(acc), s),
  };
}
