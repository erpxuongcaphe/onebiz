import { getMeta, setMeta } from "./db";
import {
  sendToKitchen,
  type SendToKitchenInput,
  type SendToKitchenResult,
} from "@/lib/services/supabase/fnb-checkout";

interface KitchenRequest {
  payload: string;
  result?: SendToKitchenResult;
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
