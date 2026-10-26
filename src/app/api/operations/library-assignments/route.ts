import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isOperationsSameOrigin } from "@/lib/operations/same-origin";
import { libraryAssignmentsSchema } from "@/lib/operations/library-assignments";

export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
const failure=(error:string,status=400)=>NextResponse.json({error},{status,headers});
export async function POST(request:NextRequest) {
  if(!isOperationsSameOrigin(request))return failure("Nguồn yêu cầu không hợp lệ.",403);
  // Bound the stream, not only the caller-provided Content-Length.
  const reader=request.body?.getReader();if(!reader)return failure("Chưa có nội dung.");
  const decoder=new TextDecoder();let text="",size=0;
  while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>30000){await reader.cancel();return failure("Nội dung quá lớn.",413);}text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();
  let body:unknown;try{body=JSON.parse(text);}catch{return failure("Nội dung không hợp lệ.");}
  const parsed=libraryAssignmentsSchema.safeParse(body);
  if(!parsed.success)return failure("Chọn công việc, người và lý do hợp lệ. Chưa thay đổi phân công.");
  const client=await createServerSupabaseClient();const user=await client.auth.getUser();
  if(user.error||!user.data.user)return failure("Vui lòng đăng nhập lại OneBiz.",401);
  const rpc=client as unknown as {rpc:(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:{message:string;code?:string}|null}>};
  const command=parsed.data;
  const {action,...payload}=command;
  const result=action==="update"
    ? await rpc.rpc("ops_library_assignments_execute",{p_payload:payload,p_request_id:command.action==="update"?command.requestId:null})
    : await rpc.rpc("ops_library_assignments_preview",{p_payload:{...payload,mode:command.action==="read"?"read":command.mode}});
  if(result.error){const error=result.error;
    if(["PGRST202","42883"].includes(error.code??""))return failure("Chỉnh sửa phân công chi nhánh đang chờ kích hoạt. Phân công cũ được giữ nguyên.",503);
    if(error.message.includes("OPS_FORBIDDEN"))return failure("Bạn chưa có quyền chỉnh phân công tại chi nhánh này.",403);
    if(error.message.includes("STALE"))return failure("Phân công hoặc công việc vừa thay đổi. Xem trước lại trước khi lưu; chưa có thay đổi nào được ghi.",409);
    if(error.message.includes("OPS_ASSIGNMENT_EMPTY"))return failure("Có công việc sẽ không còn người phụ trách. Chọn người thay thế trước khi lưu.");
    if(error.message.includes("OPS_INVALID_ASSIGNEE"))return failure("Có người không còn đủ quyền quản lý tại chi nhánh. Kiểm tra lại người được chọn và người đang phụ trách.");
    if(error.message.includes("OPS_REQUEST_CONFLICT"))return failure("Yêu cầu đã dùng cho nội dung khác. Kiểm tra lại trước khi lưu.",409);
    return failure("Chưa đổi phân công. Kiểm tra công việc đang áp dụng và người phụ trách. Không có công việc nào được lưu một phần.");
  }
  return NextResponse.json({result:result.data},{headers});
}
