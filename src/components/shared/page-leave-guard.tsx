"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Dialog as Primitive } from "@base-ui/react/dialog";
import { Button } from "@/components/ui/button";
import { hasUnsavedWork, useUnsavedWork } from "@/lib/hooks/use-unsaved-work";
import { createFormEditTracker } from "@/lib/utils/form-edit-tracker";

interface HistoryNavigation extends EventTarget {
  currentEntry?: { key: string };
  traverseTo: (key: string) => { finished: Promise<unknown> };
}
interface HistoryNavigateEvent extends Event {
  navigationType: string;
  destination: { key: string; sameDocument: boolean };
}

export function PageLeaveGuard() {
  const [pending, setPending] = useState<(() => void | Promise<unknown>) | null>(null);
  const approved = useRef(false);
  const approvedKey = useRef<string | null>(null);
  const continueButton = useRef<HTMLButtonElement | null>(null);
  const [forms] = useState(createFormEditTracker);
  useUnsavedWork(() => !/^\/(dang-nhap|quen-mat-khau|dat-lai-mat-khau)(\/|$)/.test(location.pathname) && forms.dirty());
  useLayoutEffect(() => {
    if (!pending) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation(); setPending(null);
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [pending]);
  useEffect(() => {
    const requested = (event: Event) => {
      const finish = (event as CustomEvent<() => void | Promise<unknown>>).detail;
      if (typeof finish !== "function") return;
      event.preventDefault(); setPending(() => finish);
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!approved.current && hasUnsavedWork()) { event.preventDefault(); event.returnValue = ""; }
    };
    const click = (event: MouseEvent) => {
      if (approved.current || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const close = event.target.closest<HTMLElement>("[data-page-close]");
      if (close && hasUnsavedWork()) {
        event.preventDefault(); event.stopImmediatePropagation();
        setPending(() => () => {
          approved.current = true;
          try { close.click(); } finally { queueMicrotask(() => { approved.current = false; }); }
        });
        return;
      }
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const url = new URL(link.href, location.href);
      if (!["http:", "https:"].includes(url.protocol) || url.href === location.href || (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search)) return;
      if (!hasUnsavedWork()) return;
      event.preventDefault(); event.stopImmediatePropagation();
      setPending(() => () => {
        approved.current = true;
        try { link.click(); } finally { queueMicrotask(() => { approved.current = false; }); }
      });
    };
    const navigation = (window as Window & { navigation?: HistoryNavigation }).navigation;
    let blocked: { source: string; target: string; restoring: boolean } | null = null;
    const navigate = (event: Event) => {
      const move = event as HistoryNavigateEvent;
      if (move.navigationType !== "traverse") return;
      if (approved.current || approvedKey.current === move.destination.key || (blocked?.restoring && blocked.source === move.destination.key)) return;
      const source = blocked?.source ?? navigation?.currentEntry?.key;
      if (event.defaultPrevented || !move.destination.sameDocument || !source || !hasUnsavedWork()) return;
      blocked = { source, target: move.destination.key, restoring: false };
    };
    const popstate = (event: PopStateEvent) => {
      const key = navigation?.currentEntry?.key;
      if (approvedKey.current === key) { approvedKey.current = null; return; }
      if (!blocked || !key) return;
      // Keep the router from unmounting the editor. Restore the original entry
      // before asking; cancelling navigate itself can shift WebKit's cursor.
      event.stopImmediatePropagation();
      if (key === blocked.source) {
        const target = blocked.target;
        blocked = null;
        setPending(() => () => {
          approvedKey.current = target;
          return navigation?.traverseTo(target).finished.catch(() => { approvedKey.current = null; });
        });
      } else {
        blocked.restoring = true;
        void navigation?.traverseTo(blocked.source).finished.catch(() => { blocked = null; });
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("onebiz:request-page-leave", requested);
    document.addEventListener("focusin", forms.before, true);
    document.addEventListener("pointerdown", forms.before, true);
    document.addEventListener("keydown", forms.before, true);
    document.addEventListener("reset", forms.reset, true);
    document.addEventListener("click", click, true);
    navigation?.addEventListener("navigate", navigate);
    window.addEventListener("popstate", popstate, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("onebiz:request-page-leave", requested);
      document.removeEventListener("focusin", forms.before, true);
      document.removeEventListener("pointerdown", forms.before, true);
      document.removeEventListener("keydown", forms.before, true);
      document.removeEventListener("reset", forms.reset, true);
      forms.clear();
      document.removeEventListener("click", click, true);
      navigation?.removeEventListener("navigate", navigate);
      window.removeEventListener("popstate", popstate, true);
    };
  }, [forms]);
  return <Primitive.Root open={!!pending} disablePointerDismissal onOpenChange={open => { if (!open) setPending(null); }}>
    <Primitive.Portal>
      <Primitive.Backdrop className="fixed inset-0 z-[80] bg-black/40" />
      <Primitive.Popup initialFocus={continueButton} className="fixed left-1/2 top-1/2 z-[80] grid max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border bg-popover p-5 text-sm text-popover-foreground shadow-xl">
        <Primitive.Title className="text-base font-semibold">Có nội dung chưa lưu</Primitive.Title>
        <Primitive.Description>Nội dung đang nhập sẽ mất nếu rời trang. Tiếp tục chỉnh sửa để hoàn tất thao tác, hoặc xác nhận bỏ thay đổi và rời trang. Hệ thống không tự lưu.</Primitive.Description>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" className="text-status-error" onClick={async () => {
            const finish = pending; setPending(null); approved.current = true;
            try { await finish?.(); } finally { approved.current = false; }
          }}>Bỏ thay đổi và rời trang</Button>
          <Button ref={continueButton} onClick={() => setPending(null)}>Tiếp tục chỉnh sửa</Button>
        </div>
      </Primitive.Popup>
    </Primitive.Portal>
  </Primitive.Root>;
}
