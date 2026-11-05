import { getClient } from "./base";

export class FnbOrderNoteConflict extends Error {
  constructor(public readonly remoteNote: string, public readonly updatedAt: string) {
    super("Ghi chú đã được sửa trên máy khác. Đối chiếu hai bản trước khi lưu.");
  }
}

export async function saveFnbOrderNote(orderId: string, note: string, expectedNote: string): Promise<{ note: string; updatedAt: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    // The RPC only edits unpaid order notes; it locks and compares the note
    // itself so kitchen/customer updates do not cause unrelated conflicts.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (getClient().rpc as any)("fnb_save_order_note_v1", {
      p_order_id: orderId, p_note: note, p_expected_note: expectedNote,
    }).abortSignal(controller.signal);
    if (error) {
      if (error.message?.includes("ORDER_NOTE_NOT_UNPAID")) throw new Error("Đơn đã thanh toán, hủy hoặc gộp; ghi chú đang nhập vẫn được giữ trên máy.");
      if (error.code === "42501") throw new Error("Tài khoản chưa có quyền sửa ghi chú của đơn tại chi nhánh này.");
      if (error.code === "22023") throw new Error("Ghi chú quá dài. Rút ngắn rồi lưu lại.");
      throw new Error("Chưa lưu được ghi chú. Nội dung vẫn được giữ trên máy để thử lại.");
    }
    if (!data || typeof data.note !== "string" || typeof data.updated_at !== "string") throw new Error("Chưa xác nhận được ghi chú đã lưu. Nội dung vẫn được giữ để thử lại.");
    if (data.conflict === true) throw new FnbOrderNoteConflict(data.note, data.updated_at);
    if (data.note !== note) throw new Error("Máy chủ chưa xác nhận đúng nội dung ghi chú. Thử lưu lại.");
    return { note: data.note, updatedAt: data.updated_at };
  } finally { clearTimeout(timeout); }
}
