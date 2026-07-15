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
const dropCheck = readFileSync(
  resolve("supabase/migrations/00194_mkt_tasks_drop_content_check.sql"),
  "utf8",
);
const core = readFileSync(resolve("supabase/migrations/00168_mkt_hub_core.sql"), "utf8");

/**
 * Luật "duyệt/đăng phải gắn nội dung" nằm ở BA tầng. Bỏ sót 1 tầng là kẹt lại
 * ở bước sau: 00193 gỡ 2 tầng → NỘP được nhưng bấm DUYỆT thì chết vì CHECK cấp
 * bảng ("violates check constraint mkt_tasks_check"). Bộ test này khoá cả ba.
 */
describe("Ba tầng ràng buộc — phải gỡ đủ, không sót tầng nào", () => {
  it("tầng 3 (CHECK cấp bảng mkt_tasks_check) đã được gỡ", () => {
    // 00168 tạo bảng kèm check này → sinh task 'publish' không nội dung sẽ bị đá.
    expect(core).toContain(
      "check (task_type not in ('review', 'publish') or content_item_id is not null)",
    );
    expect(dropCheck).toContain(
      "alter table public.mkt_tasks drop constraint if exists mkt_tasks_check",
    );
  });

  it("nhưng FK content_item_id vẫn còn — không cho gắn id rác", () => {
    expect(core).toContain("content_item_id uuid references public.mkt_content_items(id)");
    expect(dropCheck).not.toContain("mkt_tasks_content_item_id_fkey");
  });
});

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
