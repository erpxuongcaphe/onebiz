import { waitForPrint } from "./print-wait";

export interface PrintCloneState {
  documentElement: HTMLElement;
  clonedReferenceElement?: HTMLElement;
  scrolledElements: [Element, number, number][];
  options: { onclone?: (doc: Document, element: HTMLElement) => void | Promise<void> };
}

/** iOS can omit iframe load or keep readyState interactive after document.write.
 * Wait for the actual cloned target instead. Only used by the separate iOS renderer.
 * html2canvas 1.4.1 upstream issue: niklasvh/html2canvas#2864.
 */
export async function mountIosPrintClone(state: PrintCloneState, owner: Document, size: { width: number; height: number }): Promise<HTMLIFrameElement> {
  const frame = owner.createElement("iframe");
  frame.className = "html2canvas-container";
  frame.setAttribute("data-html2canvas-ignore", "true");
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.style.cssText = "visibility:hidden;position:fixed;left:-10000px;top:0;border:0";
  frame.width = String(size.width); frame.height = String(size.height);
  owner.body.appendChild(frame);
  try {
    const doc = frame.contentDocument;
    const target = state.clonedReferenceElement;
    if (!doc || !target) throw new Error("Không tạo được khung ảnh in trên iOS.");
    doc.open(); doc.write("<!doctype html><html></html>"); doc.close();
    doc.replaceChild(doc.adoptNode(state.documentElement), doc.documentElement);
    await new Promise<void>((resolve, reject) => {
      const poll = setInterval(() => {
        if (doc.body?.contains(target) && ["interactive", "complete"].includes(doc.readyState)) {
          clearInterval(poll); clearTimeout(timeout); resolve();
        }
      }, 25);
      const timeout = setTimeout(() => { clearInterval(poll); reject(new Error("Khung ảnh in iOS chưa sẵn sàng. Chưa gửi phiếu.")); }, 5000);
    });
    state.scrolledElements.forEach(([element, x, y]) => { element.scrollLeft = x; element.scrollTop = y; });
    frame.contentWindow?.scrollTo(0, 0);
    // Trigger layout before checking font readiness in a document.write frame.
    void target.getBoundingClientRect();
    if (doc.fonts && doc.fonts.status !== "loaded") await waitForPrint(doc.fonts.ready, "Phông chữ ảnh in iOS chưa sẵn sàng. Chưa gửi phiếu.", 5000);
    await waitForPrint(Promise.all(Array.from(doc.images).map(img => img.decode())), "Ảnh logo/QR iOS chưa sẵn sàng. Chưa gửi phiếu.", 5000);
    await state.options.onclone?.(doc, target);
    return frame;
  } catch (error) { frame.remove(); throw error; }
}
