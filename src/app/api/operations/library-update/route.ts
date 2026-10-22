import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isOperationsSameOrigin } from "@/lib/operations/same-origin";
import { libraryUpdateSchema } from "@/lib/operations/library-update";

export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
const failure=(error:string,status=400)=>NextResponse.json({error},{status,headers});
export async function POST(request:NextRequest) {
  if(!isOperationsSameOrigin(request))return failure("Nguồn yêu cầu không hợp lệ.",403);
  const text=await request.text();
  if(text.length>12000)return failure("Nội dung quá lớn.",413);
  let body:unknown;
  try{body=JSON.parse(text);}catch{return failure("Nội dung không hợp lệ.");}
  const parsed=libraryUpdateSchema.safeParse(body);
  if(!parsed.success)return failure("Chọn chi nhánh, ngày áp dụng và lý do hợp lệ. Chưa ghi dữ liệu.");
  const client=await createServerSupabaseClient();
  const user=await client.auth.getUser();
  if(user.error||!user.data.user)return failure("Vui lòng đăng nhập lại OneBiz.",401);
  const command=parsed.data;
  const rpc=client as unknown as {rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{message:string;code?:string}|null}>};
  const result=command.action==="preview"
    ? await rpc.rpc("ops_library_update_preview",{p_library:command.id,p_version:command.version,p_branches:command.branchIds,p_effective:command.effectiveFrom})
    : await rpc.rpc("ops_library_update_execute",{p_payload:{id:command.id,version:command.version,branchIds:command.branchIds,effectiveFrom:command.effectiveFrom,token:command.token,reason:command.reason},p_request_id:command.requestId});
  if(result.error){
    const error=result.error;
    if(["PGRST202","42883","42703"].includes(error.code??""))return failure("Chức năng cập nhật bộ chung đang chờ kích hoạt. Nội dung và dữ liệu chi nhánh được giữ nguyên.",503);
    if(error.message.includes("OPS_FORBIDDEN"))return failure("Bạn chưa có quyền cập nhật tại một chi nhánh đã chọn.",403);
    if(error.message.includes("OPS_LIBRARY_BRANCH_OVERRIDE"))return failure("Có công việc đã được chỉnh riêng tại chi nhánh. Không ghi đè; kiểm tra lại các mục được đánh dấu.",409);
    if(error.message.includes("OPS_LIBRARY_UPDATE_PENDING"))return failure("Chi nhánh có bản cập nhật đang chờ ngày hiệu lực. Chưa áp dụng thêm bản khác.",409);
    if(error.message.includes("OPS_LIBRARY_UPDATE_NOT_NEEDED"))return failure("Chi nhánh đã dùng phiên bản này hoặc không có thay đổi nội dung cần cập nhật.",409);
    if(error.message.includes("STALE"))return failure("Nội dung hoặc kết quả tại chi nhánh vừa thay đổi. Xem trước lại trước khi xác nhận.",409);
    return failure("Chưa cập nhật. Kiểm tra ngày hiệu lực từ ngày mai, quyền của quản lý và cấu hình công việc. Không có phần nào được ghi.");
  }
  return NextResponse.json({result:result.data},{headers});
}
