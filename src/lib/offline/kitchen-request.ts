import { getMeta, setMeta } from "./db";
import {
  addItemsToExistingOrder,
  sendToKitchen,
  type SendToKitchenInput,
  type SendToKitchenResult,
} from "@/lib/services/supabase/fnb-checkout";

interface KitchenRequest {
  payload: string;
  result?: SendToKitchenResult;
}

export interface KitchenSupplementIdentity {
  tenantId: string;
  branchId: string;
  createdBy: string;
  tabId: string;
  lineIds: string[];
}

interface KitchenSupplementRequest {
  payload: string;
  lineIds: string[];
  batchId: string;
  confirmed: boolean;
}

export async function sendRecoverableKitchenSupplement(
  orderId: string,
  items: SendToKitchenInput["items"],
  identity: KitchenSupplementIdentity,
  isOnline: boolean,
): Promise<boolean> {
  const key = `fnb-kitchen-supplement:${identity.tenantId}:${identity.branchId}:${identity.tabId}:${orderId}`;
  const payload = JSON.stringify({ orderId, items, identity });
  const saved = await getMeta<KitchenSupplementRequest | null>(key);
  const sameLines = saved && JSON.stringify(saved.lineIds) === JSON.stringify(identity.lineIds);
  if (saved && saved.payload !== payload && (!saved.confirmed || sameLines)) {
    throw new Error("Món bổ sung đã thay đổi sau lần gửi chưa được xác nhận. Kiểm tra đơn bếp trước khi gửi tiếp.");
  }
  if (saved?.confirmed && saved.payload === payload) return true;
  if (!isOnline) {
    if (saved && !saved.confirmed) {
      throw new Error("Chưa xác nhận lần gửi bổ sung trước. Kết nối mạng rồi thử lại với các món hiện tại.");
    }
    return false;
  }

  const pending = saved && !saved.confirmed;
  const batchId = pending ? saved.batchId : (
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
  const request = { payload, lineIds: identity.lineIds, batchId, confirmed: false };
  await setMeta(key, request satisfies KitchenSupplementRequest);
  try {
    await addItemsToExistingOrder(orderId, items, { batchId });
    await setMeta(key, { ...request, confirmed: true } satisfies KitchenSupplementRequest);
    return true;
  } catch (error) {
    if (!pending && error instanceof Error && "kitchenRequestRejected" in error && error.kitchenRequestRejected === true) {
      await setMeta(key, null);
      throw error;
    }
    throw new Error("Chưa xác nhận được món bổ sung. Giữ nguyên các món và thử lại khi có mạng để không gửi trùng.", { cause: error });
  }
}

export async function sendRecoverableKitchenRequest(
  input: SendToKitchenInput,
  isOnline: boolean,
): Promise<SendToKitchenResult | null> {
  if (!input.idempotencyKey) return null;
  const key = `fnb-kitchen-request:${input.tenantId}:${input.branchId}:${input.idempotencyKey}`;
  const payload = JSON.stringify(input);
  const saved = await getMeta<KitchenRequest | null>(key);
  if (saved && saved.payload !== payload) {
    throw new Error("Giỏ đã thay đổi sau lần gửi bếp chưa được xác nhận. Kiểm tra đơn bếp trước khi gửi thêm món.");
  }
  if (saved?.result) return saved.result;
  if (!isOnline) {
    if (saved) {
      throw new Error("Chưa xác nhận lần gửi bếp trước. Kết nối mạng rồi thử lại với giỏ hiện tại; không tạo đơn thay thế.");
    }
    return null;
  }

  // Persist before transport: a reload must not turn an uncertain send into a new order.
  await setMeta(key, { payload } satisfies KitchenRequest);
  try {
    const result = await sendToKitchen(input);
    await setMeta(key, { payload, result } satisfies KitchenRequest);
    return result;
  } catch (error) {
    if (!saved && error instanceof Error && "kitchenRequestRejected" in error && error.kitchenRequestRejected === true) {
      await setMeta(key, null);
      throw error;
    }
    throw new Error("Chưa xác nhận được gửi bếp. Giữ nguyên giỏ và thử lại khi có mạng để kiểm tra đúng đơn, không gửi thành đơn mới.", { cause: error });
  }
}
