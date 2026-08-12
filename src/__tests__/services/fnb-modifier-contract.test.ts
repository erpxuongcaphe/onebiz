import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * PR 1 — HẬU KIỂM HỢP ĐỒNG TUỲ CHỌN MÓN (nghiên cứu chuẩn hoá 08/08).
 *
 * Kiểm 4 điểm P0.2–P0.5 bằng test HÀNH VI (giả lập Supabase), không dùng dữ
 * liệu production. Nguyên tắc CEO: chỉ sửa sau khi test chứng minh lỗi.
 *
 * Hợp đồng máy chủ để đối chiếu (migration 00121 + RPC gửi bếp):
 *   • rule hiệu lực = coalesce(link.rule_override, group.rule)
 *   • thứ tự       = sort_order của LIÊN KẾT (product/category), không phải
 *                    sort_order của bản thân nhóm
 *   • channel      = chỉ nhận 'fnb' hoặc 'all'
 */

// ── Giả lập tầng Supabase: ghi lại mọi truy vấn để soi hợp đồng ──
interface BanGhi {
  bang: string;
  filters: Record<string, unknown>;
  orders: Array<{ cot: string; asc: boolean }>;
}
const nhatKy: BanGhi[] = [];
let duLieu: Record<string, unknown[]> = {};

function taoBuilder(bang: string) {
  const ban: BanGhi = { bang, filters: {}, orders: [] };
  nhatKy.push(ban);
  const builder: Record<string, unknown> = {};
  const chuoi = (ten: string) => (cot: string, gt?: unknown) => {
    if (ten === "order") {
      ban.orders.push({
        cot,
        asc: (gt as { ascending?: boolean })?.ascending !== false,
      });
    } else {
      ban.filters[`${ten}:${cot}`] = gt;
    }
    return builder;
  };
  for (const m of ["select", "eq", "in", "order", "limit", "is", "or"]) {
    builder[m] = m === "select" ? () => builder : chuoi(m);
  }
  // Kết quả: mọi hàng của bảng, đã lọc theo `in:id` nếu có
  (builder as { then: unknown }).then = (resolve: (v: unknown) => void) => {
    let rows = (duLieu[bang] ?? []) as Array<Record<string, unknown>>;
    // Áp MỌI bộ lọc eq/in trên đúng cột — bản đầu chỉ xử lý `in:id` nên
    // `.in("channel", …)` bị bỏ qua, làm test báo đỏ oan (lỗi ở giả lập,
    // không phải ở mã). Giữ tổng quát để không dính lại bẫy này.
    for (const [k, v] of Object.entries(ban.filters)) {
      if (k.startsWith("eq:")) {
        const cot = k.slice(3);
        rows = rows.filter((r) => r[cot] === v);
      } else if (k.startsWith("in:")) {
        const cot = k.slice(3);
        const ds = v as unknown[];
        rows = rows.filter((r) => ds.includes(r[cot]));
      }
    }
    return Promise.resolve(resolve({ data: rows, error: null }));
  };
  return builder;
}

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: (bang: string) => taoBuilder(bang) }),
  handleError: (e: unknown) => {
    throw e;
  },
  getCurrentTenantId: async () => "tenant-1",
}));

const { getEffectiveModifierGroupsForProduct } = await import(
  "@/lib/services/supabase/modifier-groups"
);

const NHOM = (id: string, name: string, rule: string, sort: number, channel = "fnb") => ({
  id,
  tenant_id: "tenant-1",
  name,
  rule,
  channel,
  sort_order: sort,
  min_select: 0,
  max_select: null,
  is_active: true,
  created_at: "",
  updated_at: "",
});

beforeEach(() => {
  nhatKy.length = 0;
  duLieu = {};
});

describe("P0.2 — rule_override cấp món phải được áp vào kết quả", () => {
  it("link đặt rule_override='single_required' → nhóm trả về PHẢI bắt buộc", async () => {
    duLieu = {
      product_modifier_groups: [
        {
          id: "l1",
          product_id: "sp1",
          modifier_group_id: "g-duong",
          rule_override: "single_required",
          sort_order: 0,
        },
      ],
      modifier_groups: [NHOM("g-duong", "Mức đường", "single", 2)],
    };
    const kq = await getEffectiveModifierGroupsForProduct("sp1", null);
    expect(kq).toHaveLength(1);
    // Máy chủ dùng coalesce(rule_override, group.rule) = 'single_required'.
    // Nếu client trả 'single' thì POS cho bỏ qua còn máy chủ CHẶN gửi bếp.
    expect(kq[0].rule).toBe("single_required");
  });

  it("không có override → giữ nguyên rule gốc của nhóm", async () => {
    duLieu = {
      product_modifier_groups: [
        {
          id: "l1",
          product_id: "sp1",
          modifier_group_id: "g-duong",
          rule_override: null,
          sort_order: 0,
        },
      ],
      modifier_groups: [NHOM("g-duong", "Mức đường", "single", 2)],
    };
    const kq = await getEffectiveModifierGroupsForProduct("sp1", null);
    expect(kq[0].rule).toBe("single");
  });
});

describe("P0.3 — thứ tự phải theo sort_order của LIÊN KẾT", () => {
  it("cấp món: link đảo thứ tự → POS phải theo link, không theo nhóm", async () => {
    duLieu = {
      product_modifier_groups: [
        { id: "l1", product_id: "sp1", modifier_group_id: "g-b", rule_override: null, sort_order: 0 },
        { id: "l2", product_id: "sp1", modifier_group_id: "g-a", rule_override: null, sort_order: 1 },
      ],
      // sort_order của NHÓM ngược lại với ý người quản lý đặt ở liên kết
      modifier_groups: [NHOM("g-a", "Nhóm A", "single", 1), NHOM("g-b", "Nhóm B", "single", 9)],
    };
    const kq = await getEffectiveModifierGroupsForProduct("sp1", null);
    expect(kq.map((g) => g.id)).toEqual(["g-b", "g-a"]);
    expect(kq.map((g) => g.sortOrder)).toEqual([0, 1]);
  });

  it("cấp nhóm hàng: cũng theo sort_order của liên kết category", async () => {
    duLieu = {
      product_modifier_groups: [],
      category_modifier_groups: [
        { id: "c1", category_id: "cat1", modifier_group_id: "g-b", sort_order: 0 },
        { id: "c2", category_id: "cat1", modifier_group_id: "g-a", sort_order: 1 },
      ],
      modifier_groups: [NHOM("g-a", "Nhóm A", "single", 1), NHOM("g-b", "Nhóm B", "single", 9)],
    };
    const kq = await getEffectiveModifierGroupsForProduct("sp1", "cat1");
    expect(kq.map((g) => g.id)).toEqual(["g-b", "g-a"]);
    expect(kq.map((g) => g.sortOrder)).toEqual([0, 1]);
  });
});

describe("P0.4 — client phải lọc channel giống máy chủ (fnb | all)", () => {
  it("nhóm channel='retail' bị gán nhầm → KHÔNG được hiện trên POS FnB", async () => {
    duLieu = {
      product_modifier_groups: [
        { id: "l1", product_id: "sp1", modifier_group_id: "g-retail", rule_override: null, sort_order: 0 },
        { id: "l2", product_id: "sp1", modifier_group_id: "g-fnb", rule_override: null, sort_order: 1 },
      ],
      modifier_groups: [
        NHOM("g-retail", "Nhóm Retail", "single", 1, "retail"),
        NHOM("g-fnb", "Mức đường", "single", 2, "fnb"),
      ],
    };
    const kq = await getEffectiveModifierGroupsForProduct("sp1", null);
    // Máy chủ chỉ nhận fnb|all → hiện nhóm retail là bẫy: nhân viên chọn xong
    // mới bị từ chối lúc gửi bếp.
    expect(kq.map((g) => g.id)).toEqual(["g-fnb"]);
  });

  it("nhóm channel='all' vẫn được hiện", async () => {
    duLieu = {
      product_modifier_groups: [
        { id: "l1", product_id: "sp1", modifier_group_id: "g-all", rule_override: null, sort_order: 0 },
      ],
      modifier_groups: [NHOM("g-all", "Ghi chú chung", "single", 1, "all")],
    };
    const kq = await getEffectiveModifierGroupsForProduct("sp1", null);
    expect(kq.map((g) => g.id)).toEqual(["g-all"]);
  });
});

/**
 * P0.5 — phiếu bếp IN GIẤY phải có Đường/Đá như màn hình KDS.
 * Soi mã nguồn từng lời gọi in (đã loại chú thích) — test hành vi đầy đủ cần
 * dựng cả luồng in trình duyệt, không đáng cho vòng này.
 */
function docNguon(duongDan: string): string {
  // Chuẩn hoá CRLF → LF: máy Windows lấy mã về dạng CRLF còn CI Linux dùng LF.
  // Không chuẩn hoá thì mọi mẫu tìm theo "\n" cho kết quả khác nhau hai nơi —
  // đã dính đúng bẫy này một lần (xanh ở máy, đỏ trên CI).
  return readFileSync(duongDan, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trim().startsWith("//"))
    .join("\n");
}

/**
 * Cắt TRỌN một lời gọi hàm (cân bằng ngoặc) kể từ `tuViTri`.
 * Cân bằng ngoặc thay vì dò chuỗi mốc — hai hàm in có chữ ký khác nhau
 * (một hàm nhận mảng items rồi options, một hàm nhận một đối tượng).
 */
function khoiLoiGoi(src: string, tenHam: string, tuViTri = 0): string {
  const i = src.indexOf(tenHam, tuViTri);
  if (i < 0) throw new Error(`khong thay ${tenHam}`);
  const batDau = src.indexOf("(", i);
  let sau = 0;
  for (let k = batDau; k < src.length; k++) {
    if (src[k] === "(") sau++;
    else if (src[k] === ")" && --sau === 0) return src.slice(batDau, k + 1);
  }
  throw new Error(`loi goi ${tenHam} khong dong ngoac`);
}

describe("P0.5 — phiếu bếp in giấy phải kèm modifier (Đường/Đá)", () => {
  const pos = docNguon("src/app/pos/fnb/page.tsx");
  const kds = docNguon("src/app/pos/fnb/kds/page.tsx");

  it("mẫu in ĐÃ hỗ trợ modifierLabels — vấn đề nằm ở nơi GỌI", () => {
    const mau = readFileSync("src/lib/print-fnb.ts", "utf8");
    expect(mau).toContain("modifierLabels");
  });

  it("MỌI lời gọi printKitchenTicketsByStation đều truyền modifierLabels", () => {
    const viTri: number[] = [];
    let i = pos.indexOf("printKitchenTicketsByStation(");
    while (i >= 0) {
      viTri.push(i);
      i = pos.indexOf("printKitchenTicketsByStation(", i + 1);
    }
    expect(viTri.length).toBeGreaterThanOrEqual(2);
    for (const v of viTri) {
      expect(
        khoiLoiGoi(pos, "printKitchenTicketsByStation(", v),
        "một lời gọi in phiếu bếp thiếu modifierLabels → bếp nhận phiếu giấy không có Đường/Đá",
      ).toContain("modifierLabels");
    }
  });

  it("KDS in lại phiếu cũng truyền modifierLabels", () => {
    expect(khoiLoiGoi(kds, "printKitchenTicketV2(")).toContain("modifierLabels");
  });
});
