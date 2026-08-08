/**
 * 08/08/2026 — GIAI ĐOẠN 2 TOPPING (CEO chốt): topping của popup POS FnB là
 * SKU BÁN THEO PHẦN (mã `SKU-TPP-…`, đơn vị Phần, giá bán = giá MỘT PHẦN,
 * công thức BOM quy ra gram NVL). KHÔNG còn lấy thẳng nguyên vật liệu
 * `NVL-TOP%` — mô hình cũ hiện giá nguyên túi/hộp (+155.000đ một lần bấm)
 * và trừ kho không qua công thức.
 *
 * MỘT topping "hợp lệ" phải đủ (đúng điều kiện CEO chốt 07/08):
 *   tenant + product_type='sku' + channel='fnb' + is_active + CÓ BOM đang bật.
 * Kèm một điều kiện tự vệ: giá bán > 0 — cả 14 mã SKU-TPP khởi tạo với giá
 * 0đ, thiếu chặn này thì mã cấu hình dở dang (có BOM, quên giá) sẽ thành
 * topping MIỄN PHÍ trên POS.
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
 * Lọc thuần: giữ SKU topping có BOM đang bật VÀ giá bán > 0.
 * Tách riêng để test hành vi không cần giả lập Supabase.
 */
export function locToppingHopLe(
  products: Array<{ id: string; name: string; sell_price: number | null }>,
  productIdsCoBom: ReadonlySet<string>,
): ToppingPhan[] {
  return products
    .filter((p) => productIdsCoBom.has(p.id) && (p.sell_price ?? 0) > 0)
    .map((p) => ({ id: p.id, name: p.name, price: p.sell_price as number }));
}

/**
 * Tải danh sách topping hợp lệ cho popup POS FnB.
 *
 * Hai truy vấn tuần tự (products → bom) thay vì join PostgREST: FK giữa
 * products và bom là quan hệ hai chiều (products.bom_code lẫn
 * bom.product_id) nên embed dễ dính nhập nhằng; hai câu SELECT thẳng thì
 * đọc được ngay là đang hỏi gì.
 *
 * LƯU Ý: đây là hàm async trả DATA, không trả query builder — builder là
 * thenable, trả nó ra khỏi hàm async là câu query bị bắn non (bẫy đã ghi
 * trong memory dự án).
 */
export async function getToppingPhanHopLe(
  tenantId: string,
): Promise<ToppingPhan[]> {
  const supabase = getClient();

  const { data: prods, error: prodErr } = await supabase
    .from("products")
    .select("id, name, sell_price")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("product_type", "sku")
    .eq("channel", "fnb")
    .ilike("code", `${TIEN_TO_SKU_TOPPING}%`)
    .order("name")
    .limit(500);
  if (prodErr) throw prodErr;

  const ids = (prods ?? []).map((p) => p.id);
  if (ids.length === 0) return [];

  // BOM có thể gắn theo chi nhánh (bom.branch_id) — với DANH SÁCH hiển thị,
  // có bất kỳ BOM đang bật nào là đủ; lúc trừ kho máy chủ tự chọn BOM đúng
  // chi nhánh (get_active_bom_for_branch).
  const { data: boms, error: bomErr } = await supabase
    .from("bom")
    .select("product_id")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .in("product_id", ids);
  if (bomErr) throw bomErr;

  const coBom = new Set(
    (boms ?? [])
      .map((b) => b.product_id as string | null)
      .filter((x): x is string => !!x),
  );
  return locToppingHopLe(prods ?? [], coBom);
}
