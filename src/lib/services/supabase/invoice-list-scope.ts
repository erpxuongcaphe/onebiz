/**
 * Phạm vi chi nhánh của màn Hoá đơn — MỘT CỬA cho mọi truy vấn.
 *
 * Vì sao tách hẳn khỏi `invoices.ts`: chốt chặn phải nằm ở nơi *gọi* truy vấn,
 * và phải test được bằng cách đếm lời gọi `getInvoices` thật, không phải chỉ
 * kiểm giá trị trả về của một hàm thuần.
 *
 * ⚠️ Đây là chốt chặn PHÍA GIAO DIỆN. Nó ngăn màn hình bắn truy vấn sai phạm
 * vi, KHÔNG phải bảo mật tuyệt đối: RLS trên `invoices` hiện chủ yếu theo
 * tenant (đo 08/08: `relrowsecurity = false`, 3 policy nằm im). Siết quyền
 * chi nhánh ở máy chủ là ĐỢT RIÊNG, cần preflight + UAT, không gộp vào đây.
 */

import {
  getInvoices,
  getInvoiceListSummary,
  type InvoiceListSummary,
  type InvoiceListSummaryParams,
} from "./invoices";
import type { Invoice, QueryParams, QueryResult } from "@/lib/types";

/**
 * Ba trạng thái tách bạch. Trước đây dùng chung `undefined` cho cả "toàn
 * chuỗi" lẫn "chưa có chi nhánh" — hai ý nghĩa TRÁI NGƯỢC về quyền, nên
 * người chưa được gán chi nhánh vô tình chạy truy vấn toàn tenant.
 */
export type PhamViChiNhanh =
  /** Xem toàn chuỗi — CHỈ khi vừa bật cờ vừa có quyền. */
  | { mode: "all"; duocDemChiNhanhKhac: false }
  /** Theo đúng một chi nhánh. Mọi truy vấn phải kèm mã này. */
  | { mode: "branch"; branchId: string; duocDemChiNhanhKhac: boolean }
  /** Chưa có chi nhánh và chưa chủ động xem toàn chuỗi → KHÔNG truy vấn. */
  | { mode: "none"; duocDemChiNhanhKhac: false };

export function phamViChiNhanhHoaDon(opts: {
  activeBranchId?: string;
  viewAllBranches: boolean;
  duocXemToanChuoi: boolean;
}): PhamViChiNhanh {
  if (opts.viewAllBranches && opts.duocXemToanChuoi) {
    return { mode: "all", duocDemChiNhanhKhac: false };
  }
  if (opts.activeBranchId) {
    return {
      mode: "branch",
      branchId: opts.activeBranchId,
      // Chỉ người xem được toàn chuỗi mới được đếm ở chi nhánh khác — đó
      // cũng là một lời gọi getInvoices không kèm chi nhánh.
      duocDemChiNhanhKhac: opts.duocXemToanChuoi,
    };
  }
  return { mode: "none", duocDemChiNhanhKhac: false };
}

/**
 * Cửa duy nhất để màn Hoá đơn lấy danh sách. Ở `mode: "none"` thì KHÔNG gọi
 * `getInvoices` — trả rỗng và đợi người dùng chọn chi nhánh.
 */
export async function getInvoicesTheoPhamVi(
  phamVi: PhamViChiNhanh,
  params: Omit<QueryParams, "branchId">,
): Promise<QueryResult<Invoice>> {
  if (phamVi.mode === "none") return { data: [], total: 0 };
  return getInvoices({
    ...params,
    branchId: phamVi.mode === "branch" ? phamVi.branchId : undefined,
  });
}

/**
 * Đếm hoá đơn ở chi nhánh khác (gợi ý khi bảng trống). Truy vấn này CỐ Ý bỏ
 * chi nhánh nên phải khoá chặt: chỉ chạy ở `mode: "branch"` và người gọi có
 * quyền xem toàn chuỗi.
 */
export async function demHoaDonChiNhanhKhac(
  phamVi: PhamViChiNhanh,
  params: Omit<QueryParams, "branchId" | "page" | "pageSize">,
): Promise<number> {
  if (!phamVi.duocDemChiNhanhKhac) return 0;
  const kq = await getInvoices({ ...params, page: 0, pageSize: 1, branchId: undefined });
  return kq.total;
}

/**
 * Chỉ số theo phạm vi. `mode: "none"` → KHÔNG gọi RPC, trả null để giao diện
 * hiện gạch ngang và đợi chọn chi nhánh.
 */
export async function getChiSoTheoPhamVi(
  phamVi: PhamViChiNhanh,
  params: Omit<InvoiceListSummaryParams, "branchId">,
): Promise<InvoiceListSummary | null> {
  if (phamVi.mode === "none") return null;
  return getInvoiceListSummary({
    ...params,
    branchId: phamVi.mode === "branch" ? phamVi.branchId : undefined,
  });
}
