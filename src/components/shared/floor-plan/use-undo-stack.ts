/**
 * Stack hoàn tác / làm lại.
 * Mỗi entry là snapshot toàn bộ layout của 1 zone.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface UndoEntry<T> {
  label: string;
  state: T;
}

export function useUndoStack<T>(
  current: T,
  apply: (state: T) => void,
  options?: { max?: number },
) {
  const max = options?.max ?? 20;
  const [stack, setStack] = useState<UndoEntry<T>[]>([]);
  const [cursor, setCursor] = useState(0);
  const ignoreNext = useRef(false);

  const push = useCallback(
    (label: string) => {
      if (ignoreNext.current) {
        ignoreNext.current = false;
        return;
      }
      setStack((prev) => {
        const truncated = prev.slice(0, cursor + 1);
        const next = [...truncated, { label, state: current }];
        if (next.length > max) next.shift();
        return next;
      });
      setCursor((c) => Math.min(c + 1, max - 1));
    },
    [current, cursor, max],
  );

  const undo = useCallback(() => {
    if (cursor <= 0) return;
    const prevEntry = stack[cursor - 1];
    if (!prevEntry) return;
    ignoreNext.current = true;
    apply(prevEntry.state);
    setCursor((c) => c - 1);
  }, [stack, cursor, apply]);

  const redo = useCallback(() => {
    if (cursor >= stack.length - 1) return;
    const nextEntry = stack[cursor + 1];
    if (!nextEntry) return;
    ignoreNext.current = true;
    apply(nextEntry.state);
    setCursor((c) => c + 1);
  }, [stack, cursor, apply]);

  // Phím tắt
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return {
    push,
    undo,
    redo,
    canUndo: cursor > 0,
    canRedo: cursor < stack.length - 1,
  };
}
