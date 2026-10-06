import { getClient, getCurrentTenantId } from "./base";
import type { InitialStockImportRow } from "@/lib/excel/schemas";
import { formatDateInputValue } from "@/lib/format";

export type OpeningPurpose = "migration" | "new_branch" | "start_tracking" | "opening_cost";
export const openingPurposeLabels: Record<OpeningPurpose, string> = {
  migration: "Chuyển từ phần mềm khác", new_branch: "Chi nhánh mới",
  start_tracking: "Bắt đầu quản lý kho", opening_cost: "Bổ sung giá vốn ban đầu",
};
export interface OpeningPreviewRow {
  productId: string; productCode: string; productName: string; unit: string;
  branchId: string; branchCode: string; quantityBefore: number; quantity: number;
  costPrice: number; costBefore: number | null; delta: number; value: number;
  latestMovement: string | null; latestCost: string | null; costTracked: boolean; fnb: boolean;
  lotNumber: string | null; expiryDate: string | null;
  note?: string | null;
}
export interface OpeningBatch {
  id: string; branch_id: string; created_by: string; created_at: string; source_at: string;
  purpose: OpeningPurpose; reason: string; file_name: string | null;
  total_value: number; rows: OpeningPreviewRow[];
}
export interface OpeningStockCandidate {id:string;code:string;name:string;unit:string}
export async function searchOpeningStockCandidates(branchId:string,search:string):Promise<OpeningStockCandidate[]> {
  const tenantId=await getCurrentTenantId();
  const client=getClient();
  const {data:branch,error:branchError}=await client.from("branches").select("cascade_mode").eq("tenant_id",tenantId).eq("id",branchId).single();
  if(branchError) throw new Error("Không đọc được chi nhánh. Kiểm tra kết nối rồi thử lại.");
  const term=search.replace(/[(),%_\\]/g," ").trim();
  if(!term) return [];
  const groups=["or(inventory_role.is.null,inventory_role.neq.fnb_menu_item)","or(product_type.neq.sku,channel.is.null,channel.neq.fnb)",
    // Generated database types predate cascade_mode; the production column is verified by migration tests.
    ...((branch as unknown as {cascade_mode:string}).cascade_mode==="production"?["or(has_bom.is.null,has_bom.is.false)"]:[]),`or(code.ilike.%${term}%,name.ilike.%${term}%)`];
  const {data,error}=await client.from("products").select("id,code,name,unit").eq("tenant_id",tenantId).eq("is_active",true).or(`and(${groups.join(",")})`).order("name").limit(20);
  if(error) throw new Error("Không tìm được danh mục. Kiểm tra kết nối rồi thử lại.");
  return data??[];
}
const messages: Record<string,string> = {
  OPENING_PERMISSION_DENIED: "Anh/chị chưa có quyền điều chỉnh tồn kho.",
  OPENING_BRANCH_DENIED: "Mã chi nhánh chưa đúng hoặc tài khoản chưa có quyền tại chi nhánh này.",
  OPENING_ONE_BRANCH_REQUIRED: "Mỗi lần nhập chỉ dùng một chi nhánh. Hãy tách file theo chi nhánh.",
  OPENING_ROWS_REQUIRED: "File chưa có dữ liệu.", OPENING_ROWS_LIMIT: "Mỗi đợt nhập từ 1 đến 1.000 mã hàng.",
  OPENING_PRODUCT_NOT_FOUND: "Mã hàng chưa tồn tại trong Onebiz",
  OPENING_DUPLICATE_PRODUCT: "Mã hàng bị lặp trong file",
  OPENING_STOCK_COMPONENT_REQUIRED: "Mã này không giữ tồn tại chi nhánh. Hãy nhập mã thành phần công thức",
  OPENING_UNIT_MISMATCH: "Đơn vị chưa khớp. Hãy quy đổi số lượng và đơn giá về đơn vị tồn Onebiz",
  OPENING_NUMBER_INVALID: "Số lượng/giá vốn chưa hợp lệ (lượng tối đa 4, giá tối đa 6 chữ số thập phân)",
  OPENING_RESERVED_STOCK: "Hàng đang có lượng giữ chỗ. Hãy đối soát đơn đang xử lý trước",
  OPENING_USE_STOCKTAKE: "Mã đã có tồn hoặc phát sinh vận hành. Muốn đổi số lượng hãy dùng Kiểm kho; bổ sung giá vốn thì giữ nguyên lượng đang có",
  OPENING_COST_ALREADY_TRACKED: "Mã đã có lịch sử giá vốn. Không ghi đè đầu kỳ; hãy đối soát giá vốn/kiểm kê",
  OPENING_SHARED_COST_CONFLICT: "Giá vốn dùng chung khác file và chi nhánh khác đang có hàng. Cần đối soát trước khi đổi giá",
  OPENING_PREVIEW_CHANGED: "Tồn hoặc giá vốn đã thay đổi sau khi xem trước. Xem trước lại dữ liệu để cập nhật; chưa ghi dữ liệu.",
  OPENING_REPLAY_CONFLICT: "Mã đợt nhập đã được dùng cho dữ liệu khác. Đóng rồi mở lại để tạo đợt mới.",
  OPENING_CONTEXT_REQUIRED: "Cần chọn mục đích, thời điểm chốt hợp lệ và lý do (tối đa 500 ký tự).",
  INVENTORY_LOCKED: "Quản lý đã chốt khóa tồn đầu kỳ của hệ thống. Cần mở khóa tại trang Tồn kho trước khi nhập.",
  OPENING_LOT_MISMATCH: "Sổ lô còn hàng nhưng tồn bằng 0. Hãy đối soát sổ lô trước để không nhập trùng",
  OPENING_WORKFLOW_REQUIRED: "Luồng nhập tồn cũ đã được thay bằng bước xem trước. Tải lại trang Tồn kho rồi chọn Nhập tồn kho đầu kỳ.",
};
export function openingError(message: string): Error {
  const code = Object.keys(messages).find(key => message.includes(key));
  if (code) return new Error(messages[code] + (message.includes(": ") ? `: ${message.split(": ").slice(1).join(": ")}` : ""));
  if (/deadlock|lock timeout|serialization/i.test(message)) return new Error("Có giao dịch kho đang xử lý. Chưa ghi đợt nhập này; hãy kiểm tra lịch sử rồi thử lại.");
  return new Error(message);
}
export async function previewOpeningStock(rows: InitialStockImportRow[]): Promise<OpeningPreviewRow[]> {
  const {data,error} = await (getClient().rpc as any)("preview_inventory_opening_00442",{p_rows:packOpeningRows(rows)});
  if (error) throw openingError(error.message);
  return data;
}
export async function commitOpeningStock(input: {
  id: string; rows: InitialStockImportRow[]; preview: OpeningPreviewRow[];
  purpose: OpeningPurpose; sourceAt: string; reason: string; fileName: string;
}) {
  const {data,error} = await (getClient().rpc as any)("commit_inventory_opening_00442", {
    p_batch_id:input.id,p_rows:packOpeningRows(input.rows),p_preview:input.preview,p_purpose:input.purpose,
    p_source_at:input.sourceAt,p_reason:input.reason,p_file_name:input.fileName,
  });
  if(error) throw openingError(error.message);
  return data as {id:string;count:number;totalValue:number;replayed:boolean};
}
export function packOpeningRows(rows:InitialStockImportRow[]) {
  return rows.map(row=>({...row,expiryDate:row.expiryDate?formatDateInputValue(row.expiryDate):undefined}));
}
export async function listOpeningBatches(branchId?: string,batchId?:string): Promise<OpeningBatch[]> {
  let query=(getClient() as any).from("inventory_opening_batches")
    .select("id,branch_id,created_by,created_at,source_at,purpose,reason,file_name,total_value,rows")
    .order("created_at",{ascending:false}).limit(30);
  if(branchId) query=query.eq("branch_id",branchId);
  if(batchId) query=query.eq("id",batchId);
  const {data,error}=await query;
  if(error) throw openingError(error.message);
  return data??[];
}
