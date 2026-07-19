export const POS_STOCK_CHANNEL = "onebiz-pos-stock-v1";
export const POS_STOCK_EVENT = "onebiz:pos-stock-changed";

export interface PosStockChangedMessage {
  type: "stock-changed";
  branchId: string;
  sentAt: number;
}

export function notifyPosStockChanged(branchId: string): void {
  if (typeof window === "undefined" || !branchId) return;

  window.dispatchEvent(
    new CustomEvent(POS_STOCK_EVENT, { detail: { branchId } }),
  );

  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(POS_STOCK_CHANNEL);
  const message: PosStockChangedMessage = {
    type: "stock-changed",
    branchId,
    sentAt: Date.now(),
  };
  channel.postMessage(message);
  channel.close();
}
