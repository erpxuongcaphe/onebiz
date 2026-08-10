import type { QueryParams, QueryResult, SalesOrder } from "@/lib/types";
import {
  getOrders,
  getSalesOrderListSummary,
  type SalesOrderListSummary,
  type SalesOrderListSummaryParams,
} from "./orders";

export type PhamViDonDatHang =
  | { mode: "all"; duocDemChiNhanhKhac: false }
  | { mode: "branch"; branchId: string; duocDemChiNhanhKhac: boolean }
  | { mode: "none"; duocDemChiNhanhKhac: false };

/** Chốt một phạm vi duy nhất cho bảng, chỉ số và truy vấn gợi ý chi nhánh. */
export function phamViDonDatHang(opts: {
  activeBranchId?: string;
  viewAllBranches: boolean;
  duocXemToanChuoi: boolean;
}): PhamViDonDatHang {
  if (opts.viewAllBranches && opts.duocXemToanChuoi) {
    return { mode: "all", duocDemChiNhanhKhac: false };
  }
  if (opts.activeBranchId) {
    return {
      mode: "branch",
      branchId: opts.activeBranchId,
      duocDemChiNhanhKhac: opts.duocXemToanChuoi,
    };
  }
  return { mode: "none", duocDemChiNhanhKhac: false };
}

export async function getOrdersTheoPhamVi(
  phamVi: PhamViDonDatHang,
  params: Omit<QueryParams, "branchId">,
): Promise<QueryResult<SalesOrder>> {
  if (phamVi.mode === "none") return { data: [], total: 0 };
  return getOrders({
    ...params,
    branchId: phamVi.mode === "branch" ? phamVi.branchId : undefined,
  });
}

export async function demDonDatHangChiNhanhKhac(
  phamVi: PhamViDonDatHang,
  params: Omit<QueryParams, "branchId" | "page" | "pageSize">,
): Promise<number> {
  if (!phamVi.duocDemChiNhanhKhac) return 0;
  const ketQua = await getOrders({
    ...params,
    page: 0,
    pageSize: 1,
    branchId: undefined,
  });
  return ketQua.total;
}

export async function getChiSoDonDatHangTheoPhamVi(
  phamVi: PhamViDonDatHang,
  params: Omit<SalesOrderListSummaryParams, "branchId">,
): Promise<SalesOrderListSummary | null> {
  if (phamVi.mode === "none") return null;
  return getSalesOrderListSummary({
    ...params,
    branchId: phamVi.mode === "branch" ? phamVi.branchId : undefined,
  });
}
