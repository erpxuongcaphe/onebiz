"use client";

import * as React from "react";
import { Dialog as Primitive } from "@base-ui/react/dialog";
import { useMergedRefs } from "@base-ui/utils/useMergedRefs";
import { Button } from "@/components/ui/button";
import { useUnsavedWork } from "@/lib/hooks/use-unsaved-work";

function snapshot(element: HTMLElement | null): string {
  if (!element) return "[]";
  return JSON.stringify(Array.from(element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement>(
    "input,textarea,select,[contenteditable=true],[role=combobox],[aria-checked],[aria-pressed]",
  )).map(control => {
    if (control instanceof HTMLInputElement) {
      if (["button", "submit", "reset"].includes(control.type)) return null;
      return [control.name, control.id, control.type, control.value, control.checked,
        control.files ? Array.from(control.files).map(f => [f.name, f.size, f.lastModified]) : null];
    }
    if (control instanceof HTMLSelectElement) return [control.name, control.id,
      control.multiple ? Array.from(control.selectedOptions, option => option.value) : control.value];
    if (control instanceof HTMLTextAreaElement) return [control.name, control.id, control.value];
    return [control.getAttribute("role"), control.getAttribute("aria-checked"), control.getAttribute("aria-pressed"), control.textContent];
  }).filter(Boolean));
}

interface EditGuard {
  register: (element: HTMLDivElement | null) => void;
  beforeInteraction: () => void;
  changed: () => void;
  captureClick: (event: React.MouseEvent<HTMLElement>) => void;
}
const EditGuardContext = React.createContext<EditGuard | null>(null);
export const useDialogEditGuard = () => React.useContext(EditGuardContext);

export function GuardedDialogRoot({ open, defaultOpen, onOpenChange, children,
  protectUnsavedChanges = true, hasUnsavedChanges = false, ...props }: Primitive.Root.Props & { protectUnsavedChanges?: boolean; hasUnsavedChanges?: boolean }) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false);
  const [pending, setPending] = React.useState<(() => void) | null>(null);
  const isOpen = open ?? internalOpen;
  const popup = React.useRef<HTMLDivElement | null>(null);
  const baseline = React.useRef("[]");
  const touched = React.useRef(false);
  const approved = React.useRef(false);
  const continueButton = React.useRef<HTMLButtonElement | null>(null);

  const register = React.useCallback((element: HTMLDivElement | null) => {
    popup.current = element;
    if (element) { baseline.current = snapshot(element); touched.current = false; }
    else { baseline.current = "[]"; touched.current = false; }
  }, []);
  const beforeInteraction = React.useCallback(() => {
    if (!touched.current) { baseline.current = snapshot(popup.current); touched.current = true; }
  }, []);
  const changed = React.useCallback(() => { touched.current = true; }, []);
  const dirty = React.useCallback(() => protectUnsavedChanges && !!popup.current?.isConnected && (hasUnsavedChanges || (touched.current && snapshot(popup.current) !== baseline.current)), [protectUnsavedChanges, hasUnsavedChanges]);
  useUnsavedWork(() => isOpen && dirty());
  const requestClose = React.useCallback((finish: () => void) => {
    if (approved.current || !dirty()) { finish(); return; }
    setPending(() => finish);
  }, [dirty]);

  const captureClick = React.useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (approved.current || !(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLElement>("button,[role=button],a[href]");
    if (!button || !popup.current?.contains(button)) return;
    const label = button.getAttribute("aria-label") ?? Array.from(button.childNodes)
      .filter(node => !(node instanceof Element && (node.getAttribute("aria-hidden") === "true" || node.classList.contains("material-symbols-outlined"))))
      .map(node => node.textContent).join(" ").trim();
    const isClose = button.matches("[data-slot=dialog-close],[data-slot=sheet-close],[data-dialog-close]") || /^(đóng|hủy|huỷ|hủy bỏ|huỷ bỏ|cancel|close|quay lại)$/i.test(label);
    // Links are handled once by the application leave guard, before React.
    if (!isClose || !dirty()) return;
    event.preventDefault(); event.stopPropagation();
    requestClose(() => button.click());
  }, [dirty, requestClose]);

  React.useEffect(() => {
    if (!isOpen) { touched.current = false; setPending(null); return; }
  }, [isOpen, dirty]);
  React.useLayoutEffect(() => {
    if (!pending) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation(); setPending(null);
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [pending]);

  const finishDiscard = () => {
    if (!pending) return;
    approved.current = true;
    setPending(null);
    try { pending(); } finally { queueMicrotask(() => { approved.current = false; }); }
  };

  return <EditGuardContext.Provider value={{ register, beforeInteraction, changed, captureClick }}>
    <Primitive.Root {...props} open={isOpen} disablePointerDismissal onOpenChange={(next, details) => {
      if (!next && details.reason === "outside-press") { details.cancel(); return; }
      if (!next && dirty() && !approved.current) {
        details.cancel();
        requestClose(() => { setInternalOpen(false); onOpenChange?.(false, details); });
        return;
      }
      setInternalOpen(next); onOpenChange?.(next, details);
    }}>{children}</Primitive.Root>
    <Primitive.Root open={!!pending} disablePointerDismissal onOpenChange={next => { if (!next) setPending(null); }}>
      <Primitive.Portal>
        <Primitive.Backdrop className="fixed inset-0 z-[70] bg-black/40" />
        <Primitive.Popup initialFocus={continueButton} className="fixed left-1/2 top-1/2 z-[70] grid max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border bg-popover p-5 text-sm text-popover-foreground shadow-xl">
          <Primitive.Title className="text-base font-semibold">Có nội dung chưa lưu</Primitive.Title>
          <Primitive.Description>Nội dung đang nhập sẽ mất nếu đóng. Tiếp tục chỉnh sửa để hoàn tất thao tác, hoặc xác nhận bỏ thay đổi.</Primitive.Description>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={finishDiscard} className="text-status-error">Bỏ thay đổi và đóng</Button>
            <Button ref={continueButton} onClick={() => setPending(null)}>Tiếp tục chỉnh sửa</Button>
          </div>
        </Primitive.Popup>
      </Primitive.Portal>
    </Primitive.Root>
  </EditGuardContext.Provider>;
}

export function useGuardedPopupProps(ref: React.Ref<HTMLDivElement> | undefined) {
  const guard = useDialogEditGuard();
  const register = guard?.register;
  const popupRef = useMergedRefs(register, ref);
  return { ref: popupRef, onPointerDownCapture: guard?.beforeInteraction, onKeyDownCapture: guard?.beforeInteraction,
    onChangeCapture: guard?.changed, onInputCapture: guard?.changed, onClickCapture: guard?.captureClick };
}
