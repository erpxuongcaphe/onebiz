/**
 * 08/08/2026 — GIAI ĐOẠN 2 TOPPING (CEO chốt): topping của popup POS FnB là
 * SKU BÁN THEO PHẦN (mã `SKU-TPP-…`, đơn vị Phần, giá bán = giá MỘT PHẦN,
 * công thức BOM quy ra gram NVL). KHÔNG còn lấy thẳng nguyên vật liệu
 * `NVL-TOP%` — mô hình cũ hiện giá nguyên túi/hộp (+155.000đ một lần bấm)
 * và trừ kho không qua công thức.
 *
 * MỘT topping "hợp lệ" phải đủ (điều kiện CEO chốt 07–08/08):
 *   tenant + product_type='sku' + channel='fnb' + is_active
 *   + CÓ BOM ÁP DỤNG ĐƯỢC CHO ĐÚNG CHI NHÁNH ĐANG CHỌN
 *   + giá bán > 0 (tự vệ: 14 mã SKU-TPP khởi tạo 0đ — có BOM mà quên giá
 *     sẽ thành topping miễn phí nếu không chặn).
 *
 * "BOM áp dụng được cho chi nhánh" nhân đúng logic máy chủ
 * `get_active_bom_for_branch` (00147), phần không-variant:
 *   • SP có `bom_code`  → tra bom theo CODE: ưu tiên bản riêng chi nhánh,
 *     không có thì rơi về bản global (branch_id null). Có bom_code mà không
 *     tra ra bản nào → coi như KHÔNG có công thức (mã mồ côi, máy chủ cũng
 *     trả null — không rơi tiếp xuống product_id).
 *   • SP không có bom_code → tra bom theo PRODUCT_ID: riêng chi nhánh
 *     trước, rồi global.
 * KHÔNG được "thấy BOM ở một chi nhánh bất kỳ là cho hiện toàn hệ thống".
 *
 * Giá vẫn do máy chủ quyết khi thanh toán — danh sách này chỉ để HIỂN THỊ.
 */

import { getClient } from "./base";

export interface ToppingPhan {
  id: string;
  name: string;
  /** Giá MỘT PHẦN (không phải giá nguyên túi/hộp NVL). */
  price: number;
}

/** Tiền tố mã của SKU topping bán theo phần — CEO đặt tên đợt 07/08. */
export const TIEN_TO_SKU_TOPPING = "SKU-TPP";

/**
 * PHIÊN BẢN NGUỒN TOPPING trong cache offline (CEO yêu cầu 08/08).
 *
 * Cache đời cũ chứa NVL-TOP giá nguyên túi/hộp; bản build mới PHẢI coi cache
 * đó là vô hiệu ngay — kể cả đang offline, thà không hiện topping còn hơn
 * hiện topping nguyên liệu cũ. Đổi mô hình nguồn lần nữa thì TĂNG SỐ này.
 */
export const PHIEN_BAN_NGUON_TOPPING = "sku-tpp-v2";

/**
 * Phạm vi hiệu lực của cache topping = phiên bản nguồn + chi nhánh.
 * BOM áp dụng theo chi nhánh → cache của quán này không được dùng cho quán
 * khác.
 */
export function phamViCacheTopping(branchId: string | null | undefined): string {
  return `${PHIEN_BAN_NGUON_TOPPING}:${branchId || "khong-chi-nhanh"}`;
}

/**
 * Cache topping đã lưu còn dùng được không. Cache đời NVL-TOP không hề ghi
 * phạm vi (undefined) → luôn false.
 */
export function toppingsCacheConHieuLuc(
  phamViDaLuu: unknown,
  branchId: string | null | undefined,
): boolean {
  return phamViDaLuu === phamViCacheTopping(branchId);
}

/** Một dòng bom tối thiểu để xét "áp dụng được cho chi nhánh". */
export interface DongBom {
  product_id: string | null;
  code: string | null;
  branch_id: string | null;
}

/**
 * Lọc thuần: giữ SKU topping có BOM áp dụng đúng chi nhánh VÀ giá > 0.
 * Tách riêng để test hành vi không cần giả lập Supabase.
 */
export function locToppingHopLe(
  products: Array<{
    id: string;
    name: string;
    sell_price: number | null;
    bom_code?: string | null;
  }>,
  dongBom: readonly DongBom[],
  branchId: string | null | undefined,
): ToppingPhan[] {
  // Mất mạng nửa chừng / chưa chọn chi nhánh → chỉ BOM global mới áp dụng.
  const apDung = (b: DongBom) =>
    b.branch_id === null || (!!branchId && b.branch_id === branchId);

  const coBomApDung = (p: { id: string; bom_code?: string | null }): boolean => {
    if (p.bom_code) {
      // Có bom_code → CHỈ tra theo code (mồ côi = không công thức, y máy chủ)
      return dongBom.some((b) => b.code === p.bom_code && apDung(b));
    }
    return dongBom.some((b) => b.product_id === p.id && apDung(b));
  };

  return products
    .filter((p) => coBomApDung(p) && (p.sell_price ?? 0) > 0)
    .map((p) => ({ id: p.id, name: p.name, price: p.sell_price as number }));
}

/**
 * Tải danh sách topping hợp lệ cho popup POS FnB TẠI MỘT CHI NHÁNH.
 *
 * Hai truy vấn tuần tự (products → bom) thay vì join PostgREST: FK giữa
 * products và bom là quan hệ hai chiều (products.bom_code lẫn
 * bom.product_id) nên embed dễ dính nhập nhằng; hai câu SELECT thẳng thì
 * đọc được ngay là đang hỏi gì.
 *
 * LƯU Ý: hàm async trả DATA, không trả query builder — builder là thenable,
 * trả nó ra khỏi hàm async là câu query bị bắn non (bẫy đã ghi memory).
 * `.or()` chỉ dùng với SELECT — cấm với UPDATE/DELETE (mìn PostgREST 20/07).
 */
export async function getToppingPhanHopLe(
  tenantId: string,
  branchId: string | null | undefined,
): Promise<ToppingPhan[]> {
  const supabase = getClient();

  const { data: prodsRaw, error: prodErr } = await supabase
    .from("products")
    .select("id, name, sell_price, bom_code")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("product_type", "sku")
    .eq("channel", "fnb")
    .ilike("code", `${TIEN_TO_SKU_TOPPING}%`)
    .order("name")
    .limit(500);
  if (prodErr) throw prodErr;
  // Types Supabase sinh sẵn chưa có products.bom_code (00105) / bom.branch_id
  // — cột THẬT trên prod, đã đối chiếu db-schema.json. Ép kiểu như products.ts.
  const prods = (prodsRaw ?? []) as unknown as Array<{
    id: string;
    name: string;
    sell_price: number | null;
    bom_code: string | null;
  }>;

  const ids = prods.map((p) => p.id);
  const codes = prods
    .map((p) => p.bom_code)
    .filter((c): c is string => !!c);
  if (ids.length === 0) return [];

  // Chỉ kéo bom CÓ THỂ áp dụng: đúng chi nhánh này hoặc global. Hai .or trên
  // cùng builder AND với nhau: (match SP) AND (match chi nhánh).
  let q = supabase
    .from("bom")
    .select("product_id, code, branch_id")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .or(
      codes.length > 0
        ? `product_id.in.(${ids.join(",")}),code.in.(${codes.map((c) => `"${c}"`).join(",")})`
        : `product_id.in.(${ids.join(",")})`,
    );
  q = branchId
    ? q.or(`branch_id.eq.${branchId},branch_id.is.null`)
    : q.is("branch_id", null);
  const { data: boms, error: bomErr } = await q;
  if (bomErr) throw bomErr;

  return locToppingHopLe(prods, (boms ?? []) as unknown as DongBom[], branchId);
}
