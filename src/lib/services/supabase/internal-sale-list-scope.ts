import {
  getInternalSales,
  type InternalSaleListRow,
  type InternalSalesListParams,
} from "./internal-sales";

export type PhamViBanNoiBo =
  | { mode: "all"; duocDemChiNhanhKhac: false }
  | { mode: "branch"; branchId: string; duocDemChiNhanhKhac: boolean }
  | { mode: "none"; duocDemChiNhanhKhac: false };

/** Chốt một phạm vi dùng chung cho bảng, xuất file và gợi ý chi nhánh. */
export function phamViBanNoiBo(opts: {
  activeBranchId?: string;
  viewAllBranches: boolean;
  duocXemToanChuoi: boolean;
}): PhamViBanNoiBo {
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

export async function getInternalSalesTheoPhamVi(
  phamVi: PhamViBanNoiBo,
  params: Omit<InternalSalesListParams, "branchId">,
): Promise<{ data: InternalSaleListRow[]; total: number }> {
  if (phamVi.mode === "none") return { data: [], total: 0 };
  return getInternalSales({
    ...params,
    branchId: phamVi.mode === "branch" ? phamVi.branchId : undefined,
  });
}

export async function demBanNoiBoChiNhanhKhac(
  phamVi: PhamViBanNoiBo,
  params: Omit<InternalSalesListParams, "branchId" | "page" | "pageSize">,
): Promise<number> {
  if (!phamVi.duocDemChiNhanhKhac) return 0;
  const result = await getInternalSales({
    ...params,
    page: 1,
    pageSize: 1,
    branchId: undefined,
  });
  return result.total;
}
