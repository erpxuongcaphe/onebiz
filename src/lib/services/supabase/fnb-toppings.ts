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
 * CỜ CHUYỂN ĐỔI CƠ CHẾ TOPPING (CEO 08/08) — hai cơ chế KHÔNG được cùng
 * hiện trên popup:
 *
 *   TẮT (mặc định) — bảo toàn hệ thống hiện tại: popup KHÔNG hiện khu
 *     topping SKU (kể cả khi đã có mã hợp lệ), MỌI nhóm tuỳ chọn giữ nguyên.
 *   BẬT — chạy mô hình mới: hiện khu topping SKU bán theo phần, và ẩn ĐÚNG
 *     nhóm Topping legacy (xem `laNhomToppingLegacy`).
 *
 * Bật bằng biến môi trường Vercel `NEXT_PUBLIC_FNB_TOPPING_SKU=1` +
 * redeploy — có vết, đảo lại được ngay, không cần sửa mã. Nằm trong
 * checklist "Cấu hình trước khi vận hành F&B".
 */
export const CHE_DO_TOPPING_SKU =
  process.env.NEXT_PUBLIC_FNB_TOPPING_SKU === "1";

/**
 * PR 0 (nghiên cứu chuẩn hoá 08/08, mục P0.1) — ĐỊNH DANH NHÓM TOPPING LEGACY.
 *
 * Bản trước lọc `rule === "multi"`: SAI về nguyên tắc. "Chọn nhiều" là một
 * QUY TẮC CHỌN, không phải loại nghiệp vụ. Mai thêm nhóm Syrup, Thêm shot,
 * Sốt chấm — cũng chọn-nhiều — sẽ bị ẩn oan, nhân viên không bán được.
 *
 * Chưa có cột `group_type` (PR 3 mới thêm), nên tạm nhận diện bằng hai lớp,
 * theo thứ tự ưu tiên:
 *
 *  1. DANH SÁCH ID cấu hình qua `NEXT_PUBLIC_FNB_TOPPING_LEGACY_GROUP_IDS`
 *     (phân tách bằng dấu phẩy). UUID là thứ ổn định nhất đang có: đổi tên
 *     nhóm, đổi rule, đổi thứ tự đều không ảnh hưởng. Khi đã khai danh sách
 *     thì CHỈ những ID đó bị ẩn — tuyệt đối không suy đoán thêm.
 *
 *  2. Không khai danh sách → suy theo CẤU TRÚC, không theo tên: nhóm vừa
 *     `multi` VỪA có ít nhất một lựa chọn LIÊN KẾT SẢN PHẨM
 *     (`linkedProductId`). Liên kết sản phẩm chính là cơ chế "bán thêm có
 *     giá + trừ kho" mà khu topping SKU thay thế. Nhóm Đường/Đá/Syrup chỉ
 *     có `scaleFactor`, không liên kết sản phẩm → không bao giờ bị ẩn.
 *
 * KHÔNG dò theo TÊN hiển thị ("Topping"): tên đổi được, dịch được.
 */
export const ID_NHOM_TOPPING_LEGACY: readonly string[] = (
  process.env.NEXT_PUBLIC_FNB_TOPPING_LEGACY_GROUP_IDS ?? ""
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Hình dạng tối thiểu để xét — khớp cả ModifierGroup lẫn fixture test. */
export interface NhomDeXet {
  id: string;
  rule: string;
}
export interface LuaChonDeXet {
  linkedProductId?: string | null;
  isActive?: boolean;
}

export function laNhomToppingLegacy(
  group: NhomDeXet,
  options: readonly LuaChonDeXet[],
  idCauHinh: readonly string[] = ID_NHOM_TOPPING_LEGACY,
): boolean {
  // Lớp 1 — danh sách ID tường minh thì chỉ tin danh sách.
  if (idCauHinh.length > 0) return idCauHinh.includes(group.id);
  // Lớp 2 — suy theo cấu trúc, KHÔNG theo tên.
  if (group.rule !== "multi") return false;
  return options.some((o) => o.isActive !== false && !!o.linkedProductId);
}

/**
 * Lọc nhóm tuỳ chọn theo cơ chế topping đang chạy. Tách lõi thuần
 * (`apDungCheDoTopping`) để test được cả hai trạng thái cờ.
 *
 * Cần `optionsByGroup` vì nhận diện legacy dựa vào lựa chọn có liên kết sản
 * phẩm — thiếu nó thì lại phải đoán theo rule/tên như bản cũ.
 */
export function apDungCheDoTopping<T extends NhomDeXet>(
  groups: T[],
  optionsByGroup: ReadonlyMap<string, readonly LuaChonDeXet[]>,
  cheDoSku: boolean,
  idCauHinh: readonly string[] = ID_NHOM_TOPPING_LEGACY,
): T[] {
  if (!cheDoSku) return groups;
  return groups.filter(
    (g) => !laNhomToppingLegacy(g, optionsByGroup.get(g.id) ?? [], idCauHinh),
  );
}

export function locNhomTheoCheDoTopping<T extends NhomDeXet>(
  groups: T[],
  optionsByGroup: ReadonlyMap<string, readonly LuaChonDeXet[]>,
): T[] {
  return apDungCheDoTopping(groups, optionsByGroup, CHE_DO_TOPPING_SKU);
}

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
