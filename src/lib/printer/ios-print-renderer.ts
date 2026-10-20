// Use the modular entry only on iOS. Desktop keeps the existing bundled entry;
// its private DocumentCloner is a different constructor and is never patched.
import html2canvas from "html2canvas/dist/lib/index";
import { DocumentCloner } from "html2canvas/dist/lib/dom/document-cloner";
import { mountIosPrintClone, type PrintCloneState } from "./ios-print-clone";

DocumentCloner.prototype.toIFrame = function (owner, size) {
  return mountIosPrintClone(this as unknown as PrintCloneState, owner, size);
};

export default html2canvas;
