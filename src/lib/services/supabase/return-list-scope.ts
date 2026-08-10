import type { QueryParams, QueryResult, ReturnOrder } from "@/lib/types";
import { getReturns } from "./returns";

export type PhamViTraHang =
  | { mode: "all"; duocDemChiNhanhKhac: false }
  | { mode: "branch"; branchId: string; duocDemChiNhanhKhac: boolean }
  | { mode: "none"; duocDemChiNhanhKhac: false };

/** Chốt một phạm vi dùng chung cho danh sách, xuất file và gợi ý chi nhánh. */
export function phamViTraHang(opts: {
  activeBranchId?: string;
  viewAllBranches: boolean;
  duocXemToanChuoi: boolean;
}): PhamViTraHang {
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

export async function getReturnsTheoPhamVi(
  phamVi: PhamViTraHang,
  params: Omit<QueryParams, "branchId">,
): Promise<QueryResult<ReturnOrder>> {
  if (phamVi.mode === "none") return { data: [], total: 0 };
  return getReturns({
    ...params,
    branchId: phamVi.mode === "branch" ? phamVi.branchId : undefined,
  });
}

export async function demTraHangChiNhanhKhac(
  phamVi: PhamViTraHang,
  params: Omit<QueryParams, "branchId" | "page" | "pageSize">,
): Promise<number> {
  if (!phamVi.duocDemChiNhanhKhac) return 0;
  const ketQua = await getReturns({
    ...params,
    page: 0,
    pageSize: 1,
    branchId: undefined,
  });
  return ketQua.total;
}
