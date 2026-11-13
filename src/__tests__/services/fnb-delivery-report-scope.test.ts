import {beforeEach,describe,expect,it,vi} from "vitest";
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock("@/lib/services/supabase/base",()=>({
  getClient:()=>({rpc}),getCurrentTenantId:vi.fn(),
  handleError:(error:{message:string})=>{throw new Error(error.message);},
}));
import {getDeliveryStaffPerformance,getOrdersByDeliveryStaff} from "@/lib/services/supabase/fnb-analytics";

beforeEach(()=>rpc.mockReset());
describe("F&B delivery report scope",()=>{
  it("maps only branch-scoped staff aggregates",async()=>{
    rpc.mockResolvedValue({data:[{staff_id:"s1",staff_name:"An",total_orders:"2",total_revenue:"400",
      total_delivery_fee:"15",avg_delivery_seconds:"600",completed_count:"1"}],error:null});
    expect(await getDeliveryStaffPerformance("branch",{from:"2026-10-07",to:"2026-10-07"})).toEqual([{
      staffId:"s1",staffName:"An",totalOrders:2,totalRevenue:400,totalDeliveryFee:15,avgDeliverySeconds:600,completedCount:1,
    }]);
    expect(rpc).toHaveBeenCalledWith("staff_fnb_delivery_summary",{
      p_branch_id:"branch",p_from:"2026-10-06T17:00:00.000Z",p_to:"2026-10-07T17:00:00.000Z",
    });
  });
  it("pages delivery details and propagates scope to every request",async()=>{
    const row={kitchen_order_id:"k",order_number:"K",invoice_id:null,invoice_code:null,customer_name:"Khách lẻ",
      total:"0",delivery_fee:"5",delivery_tier:null,assigned_at:null,completed_at:null,duration_seconds:null,created_at:"2026-10-07T08:00:00Z"};
    rpc.mockResolvedValueOnce({data:Array.from({length:500},()=>row),error:null})
      .mockResolvedValueOnce({data:[row],error:null});
    const result=await getOrdersByDeliveryStaff("staff","branch");
    expect(result).toHaveLength(501);
    expect(result[0]).toMatchObject({orderNumber:"K",deliveryFee:5,durationSeconds:null});
    expect(rpc).toHaveBeenNthCalledWith(2,"staff_fnb_delivery_detail_page",{
      p_staff_id:"staff",p_branch_id:"branch",p_from:null,p_to:null,p_offset:500,p_limit:500,
    });
  });
  it("does not turn permission errors into empty data",async()=>{
    rpc.mockResolvedValue({data:null,error:{message:"FNB_REPORT_DETAIL_PERMISSION_REQUIRED"}});
    await expect(getOrdersByDeliveryStaff("staff","branch")).rejects.toThrow("FNB_REPORT_DETAIL_PERMISSION_REQUIRED");
  });
});
