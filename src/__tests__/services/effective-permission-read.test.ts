import {beforeEach,describe,expect,it,vi} from "vitest";
const api=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock("@/lib/services/supabase/base",()=>({getClient:()=>api,getCurrentTenantId:vi.fn(),handleError:vi.fn()}));
import {getUserEffectivePermissions} from "@/lib/services/supabase/permission-overrides";
beforeEach(()=>vi.clearAllMocks());
describe("effective permission read outcomes",()=>{
 it("preserves explicit grants",async()=>{
  api.rpc.mockResolvedValue({data:[{permission_code:"pos_fnb.send_kitchen"}],error:null});
  expect(await getUserEffectivePermissions("user")).toEqual(["pos_fnb.send_kitchen"]);
 });
 it("keeps a successful empty response distinct from a failed read",async()=>{
  api.rpc.mockResolvedValue({data:[],error:null});expect(await getUserEffectivePermissions("user")).toEqual([]);
 });
 it("throws for a failed read rather than returning a false empty grant list",async()=>{
  api.rpc.mockResolvedValue({data:null,error:{message:"network failure"}});
  await expect(getUserEffectivePermissions("user")).rejects.toThrow("Không tải được quyền");
 });
 it.each([null,{},[{permission_code:42}],[null]])("rejects malformed data %j",async data=>{
  api.rpc.mockResolvedValue({data,error:null});await expect(getUserEffectivePermissions("user")).rejects.toThrow();
 });
});
