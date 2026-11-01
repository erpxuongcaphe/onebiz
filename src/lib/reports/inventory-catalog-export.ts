import type { BranchStockRow } from "@/lib/services/supabase/branch-stock";

export function inventoryCatalogExport(rows: BranchStockRow[], canViewCost: boolean) {
  const columns = [
    { header: "Mã hàng", key: "productCode", width: 18 },
    { header: "Tên hàng", key: "productName", width: 34 },
    { header: "Quy cách", key: "variantName", width: 20 },
    { header: "Mã chi nhánh", key: "branchCode", width: 18 },
    { header: "Chi nhánh", key: "branchName", width: 30 },
    { header: "ĐVT", key: "unit", width: 12 },
    { header: "Tồn kho", key: "quantity", width: 16, precision: 4 },
    { header: "Đặt trước", key: "reserved", width: 16, precision: 4 },
    { header: "Khả dụng", key: "available", width: 16, precision: 4 },
    ...(canViewCost ? [
      { header: "Đơn giá vốn tồn", key: "costPrice", width: 20, precision: 4 },
      { header: "Giá trị tồn", key: "stockValue", width: 20, precision: 4 },
      { header: "Trạng thái định giá", key: "costStatus", width: 26 },
    ] : []),
  ];
  const data = rows.map(row => ({
    productCode: row.productCode, productName: row.productName, variantName: row.variantName ?? "",
    branchCode: row.branchCode ?? "", branchName: row.branchName, unit: row.unit ?? "",
    quantity: row.quantity, reserved: row.reserved, available: row.available,
    ...(canViewCost ? {
      costPrice: row.costPrice != null && Number.isFinite(row.costPrice) ? row.costPrice : null,
      stockValue: row.valuationComplete !== false && Number.isFinite(row.stockValue) ? row.stockValue : null,
      costStatus: row.valuationComplete === false ? "Chưa đủ dữ liệu" : "",
    } : {}),
  }));
  return { columns, data };
}
