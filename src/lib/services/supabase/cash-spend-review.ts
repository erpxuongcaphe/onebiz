import { createClient } from "@/lib/supabase/client";

export const SPEND_FILE_MAX = 2 * 1024 * 1024;
export type SpendDecision = "approved" | "rejected" | "withdrawn";
type Review = {
  id: string; status: "pending" | SpendDecision; evidence_ref: string | null; file_name: string | null;
  submitter: string; reviewer: string; payer: string; assigned: boolean; mine: boolean; current: boolean; effective: boolean;
  submitted_at: string; decided_at: string | null; decision_note: string | null; reviewed_amount: number;
};
export type SpendReviewDetail = {
  voucher: { code: string; amount: number; branch: string; completed: boolean };
  history: Review[];
  reviewers: { id: string; label: string }[];
};
export type SpendQueueItem = {
  id: string; cash_id: string; code: string; amount: number; transaction_date: string; branch_name: string;
};
async function rpc<T>(name: string, args: Record<string, string | boolean | null>, signal?: AbortSignal) {
  const client = createClient() as unknown as { rpc(n: string, a: typeof args): {
    abortSignal(s: AbortSignal): PromiseLike<Result<T>>;
  } & PromiseLike<Result<T>> };
  const request = client.rpc(name, args);
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error?.code === "42501") throw new Error("Bạn không có quyền xử lý hồ sơ này.");
  if (error?.code === "23505") throw new Error("Hồ sơ đã được gửi hoặc đã có quyết định. Vui lòng tải lại.");
  if (error?.code === "55000") throw new Error("Phiếu gốc đã thay đổi. Rút hoặc từ chối hồ sơ này rồi gửi lại với chứng từ đúng.");
  if (error?.code === "22023") throw new Error("Kiểm tra đơn vị thực chi, người duyệt, lý do hoặc chứng từ đính kèm.");
  if (error) throw new Error("Không thực hiện được thao tác. Vui lòng thử lại.");
  return data as T;
}
type Result<T> = { data: T | null; error: { code: string } | null };
export const readSpendReview = (cash: string, signal: AbortSignal) =>
  rpc<SpendReviewDetail>("cash_spend_review_read", { p_cash: cash }, signal);
export const readSpendQueue = (signal: AbortSignal) =>
  rpc<{ queue: SpendQueueItem[] }>("cash_spend_review_read", { p_cash: null }, signal);
export const decideSpendReview = (id: string, decision: SpendDecision, note: string, checked: boolean, signal: AbortSignal) =>
  rpc<void>("cash_spend_review_decide", { p_review: id, p_decision: decision, p_note: note || null, p_evidence_checked: checked }, signal);

export async function submitSpendReview(cash: string, payer: string, reviewer: string, ref: string, file: File, signal: AbortSignal) {
  if (!["application/pdf","image/jpeg","image/png"].includes(file.type) || file.size < 8 || file.size > SPEND_FILE_MAX) {
    throw new Error("Chọn PDF, JPG hoặc PNG, tối đa 2 MB.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return rpc<string>("cash_spend_review_submit", { p_cash: cash, p_payer: payer, p_reviewer: reviewer,
    p_evidence: ref.trim(), p_file_name: file.name, p_file_type: file.type, p_file: btoa(binary) }, signal);
}

export async function downloadSpendEvidence(id: string, signal: AbortSignal) {
  const file = await rpc<{name: string; content: string}>("cash_spend_review_file", { p_review: id }, signal);
  signal.throwIfAborted();
  const { saveAs } = await import("file-saver");
  signal.throwIfAborted();
  const bytes = Uint8Array.from(atob(file.content), c => c.charCodeAt(0));
  saveAs(new Blob([bytes], { type: "application/octet-stream" }), file.name);
}
