import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const planControls = readFileSync(resolve("src/components/mkt/plan-controls.tsx"), "utf8");
const splitDialog = readFileSync(resolve("src/components/mkt/split-dialog.tsx"), "utf8");
const planningPage = readFileSync(resolve("src/app/mkt/planning/page.tsx"), "utf8");
const readModels = readFileSync(resolve("src/lib/mkt/read-models.ts"), "utf8");
const fix = readFileSync(
  resolve("supabase/migrations/00193_mkt_publish_content_optional.sql"),
  "utf8",
);

/**
 * Bối cảnh (CEO 15/07): không nộp được kế hoạch vì bắt buộc "công đoạn
 * duyệt/đăng cần gắn nội dung" — nhưng ô sổ xuống RỖNG, vì lúc lập kế hoạch
 * nội dung chưa tồn tại (chính kế hoạch mới đẻ ra nó). CEO hỏi lại: "ép buộc
 * như vậy có phù hợp không?" → Không. Đảo luật: chỉ siết KHI CÓ gắn nội dung.
 */
describe("Gắn nội dung là TUỲ CHỌN — chỉ siết khi có gắn (00193)", () => {
  it("Đăng KHÔNG gắn nội dung → vẫn bắt đầu / hoàn tất được (không kẹt)", () => {
    // Rào cũ: 'publish' + content null => INVALID_STATE (không bấm Bắt đầu được).
    expect(fix).not.toContain("if v_task.content_item_id is null then raise exception 'INVALID_STATE'");
    // Rào mới: chỉ chạy khi CÓ gắn nội dung.
    expect(fix).toContain("v_task.task_type = 'publish' and v_task.content_item_id is not null");
  });

  it("nhưng CÓ gắn nội dung thì vẫn giữ rào an toàn: chưa duyệt không được đăng", () => {
    expect(fix).toContain("CONTENT_NOT_APPROVED");
    expect(fix).toContain("function public.mkt_start_task");
    expect(fix).toContain("function public.mkt_mark_task_done");
  });

  it("bỏ ràng buộc chặn nộp kế hoạch", () => {
    expect(fix).toContain("function public.mkt_submit_plan");
    expect(fix).not.toContain("(duyệt/đăng) cần gắn nội dung");
    // Các ràng buộc CÒN LẠI vẫn phải giữ (tên/người làm/hạn/vòng lặp)
    expect(fix).toContain("chưa có người làm");
    expect(fix).toContain("chưa có hạn");
    expect(fix).toContain("phụ thuộc vòng lặp");
  });

  it("giao diện lập kế hoạch: ô nội dung tuỳ chọn, không viền đỏ, không chặn nộp", () => {
    expect(planControls).toContain("— Gắn nội dung (tuỳ chọn) —");
    expect(planControls).toContain("— Chưa có nội dung nào —");
    expect(planControls).not.toContain("Chọn nội dung (bắt buộc)");
    expect(planControls).not.toContain("Công đoạn Duyệt/Đăng phải gắn nội dung");
  });

  it("màn Chia Task Ngay cũng bỏ ép cho nhất quán", () => {
    expect(splitDialog).toContain("suggestContent");
    expect(splitDialog).toContain("không bắt buộc");
    expect(splitDialog).not.toContain("Công đoạn Duyệt/Đăng cần gắn nội dung — tạo nhanh ở khối bên dưới");
  });

  it("vẫn GỬI contentItemId khi người dùng có chọn (để rào an toàn hoạt động)", () => {
    expect(planControls).toContain("contentItemId: r.contentItemId || undefined");
    expect(readModels).toContain("export async function getContentOptions");
    expect(planningPage).toContain("getContentOptions(supabase, campaignIds)");
  });
});
