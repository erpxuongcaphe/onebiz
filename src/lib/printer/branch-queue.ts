import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaperWidth } from "./escpos";
import { CONNECTION_PROBE } from "../../../public/print-point/destination.mjs";

export interface PrintRoute { key: string; label: string; printer: string; paper: PaperWidth }
export interface PrintPoint { id: string; name: string; enabled: boolean; connected?: boolean; detected_printers?: string[]; routes: PrintRoute[]; last_seen_at: string | null }
export interface BranchPrintJob { id: string; label: string; route_label: string; status: "queued" | "sending" | "handed_off" | "failed" | "unknown" | "cancelled"; created_at: string; actor_name: string; message: string | null }

// New RPCs are typed here until the generated production schema is refreshed.
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (createClient() as SupabaseClient).rpc(name, args);
  if (error) throw new Error(error.code === "PGRST202" ? "Hệ thống chưa cập nhật chức năng điểm in chi nhánh. Hãy dùng phương thức in hiện có trong lúc chờ cập nhật." : error.message);
  return data as T;
}
export const getBranchPrintState = (branchId: string) => rpc<{ point: PrintPoint | null; jobs: BranchPrintJob[] }>("fnb_print_state_v1", { p_branch: branchId });
export const savePrintPoint = (branchId: string, name: string, routes: PrintRoute[], enabled: boolean) => rpc<PrintPoint>("fnb_print_manage_v1", { p_branch: branchId, p_action: "save", p_data: { name, routes, enabled } });
export const rotatePrintPointToken = (branchId: string) => rpc<{ id: string; token: string }>("fnb_print_manage_v1", { p_branch: branchId, p_action: "rotate", p_data: {} });
export const resolvePrintJob = (branchId: string, id: string, action: "retry" | "cancel") => rpc("fnb_print_manage_v1", { p_branch: branchId, p_action: action, p_data: { id } });

export function bytesToBase64(bytes: Uint8Array): string {
  let encoded = "";
  for (let start = 0; start < bytes.length; start += 16384) encoded += String.fromCharCode(...bytes.subarray(start, start + 16384));
  return btoa(encoded);
}

export async function checkBranchPrinter(branchId: string, route: PrintRoute) {
  return rpc("fnb_print_enqueue_v1", { p_branch: branchId, p_id: crypto.randomUUID(), p_route: route.key, p_label: `KIỂM TRA KẾT NỐI ${route.label}`.slice(0,80), p_paper: route.paper, p_bytes: bytesToBase64(new Uint8Array(CONNECTION_PROBE)) });
}

export async function enqueueBranchPrint(args: { branchId: string; routeKey: string; label: string; html: string; paper: string; buildHtml?: (paper: PaperWidth) => string; jobId: string }): Promise<{ id: string; route_label: string }> {
  const state = await getBranchPrintState(args.branchId);
  if (!state.point?.enabled) throw new Error("Chi nhánh chưa bật điểm in. Nhờ quản lý vào Cài đặt → In ấn để thiết lập.");
  const route = state.point.routes.find(r => r.key === args.routeKey);
  if (!route?.printer) throw new Error("Chưa gán máy cho nơi nhận này. Nhờ quản lý kiểm tra tuyến in; hệ thống không chuyển sang máy khác.");
  const { rasterPrintBytes } = await import("./raster-print");
  if (!args.buildHtml && route.paper !== args.paper) throw new Error("Khổ giấy mẫu khác máy đích. Nhờ quản lý chọn cùng khổ giấy trước khi gửi.");
  const bytes = await rasterPrintBytes(args.buildHtml?.(route.paper) ?? args.html, route.paper);
  return rpc("fnb_print_enqueue_v1", { p_branch: args.branchId, p_id: args.jobId, p_route: args.routeKey, p_label: args.label, p_paper: route.paper, p_bytes: bytesToBase64(bytes) });
}
