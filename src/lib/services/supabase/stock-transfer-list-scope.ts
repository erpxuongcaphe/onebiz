import {
  getStockTransfers,
  type StockTransfer,
} from "./transfers";
import type { QueryParams, QueryResult } from "@/lib/types";

export type PhamViChuyenKho =
  | { mode: "all"; duocDemChiNhanhKhac: false }
  | { mode: "branch"; branchId: string; duocDemChiNhanhKhac: boolean }
  | { mode: "none"; duocDemChiNhanhKhac: false };

/** Chot mot pham vi dung chung cho bang, xuat file va goi y chi nhanh. */
export function phamViChuyenKho(opts: {
  activeBranchId?: string;
  viewAllBranches: boolean;
  duocXemToanChuoi: boolean;
}): PhamViChuyenKho {
  if (opts.duocXemToanChuoi && (opts.viewAllBranches || !opts.activeBranchId)) {
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

export async function getStockTransfersTheoPhamVi(
  phamVi: PhamViChuyenKho,
  params: Omit<QueryParams, "branchId">,
): Promise<QueryResult<StockTransfer>> {
  if (phamVi.mode === "none") return { data: [], total: 0 };
  return getStockTransfers({
    ...params,
    branchId: phamVi.mode === "branch" ? phamVi.branchId : undefined,
  });
}

export async function demChuyenKhoChiNhanhKhac(
  phamVi: PhamViChuyenKho,
  params: Omit<QueryParams, "branchId" | "page" | "pageSize">,
): Promise<number> {
  if (!phamVi.duocDemChiNhanhKhac) return 0;
  const result = await getStockTransfers({
    ...params,
    page: 0,
    pageSize: 1,
    branchId: undefined,
  });
  return result.total;
}
