import {beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({from:vi.fn(),select:vi.fn(),eq:vi.fn(),is:vi.fn(),order:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/services/supabase/base',()=>({getClient:()=>({from:m.from,rpc:m.rpc}),getCurrentContext:async()=>({tenantId:'tenant'}),handleError:(e:{message:string})=>{throw new Error(e.message);}}));
import {getUnassignedFloorPlanTables} from '@/lib/services/supabase/floor-plan';
beforeEach(()=>{vi.clearAllMocks();const chain={select:m.select,eq:m.eq,is:m.is,order:m.order};m.from.mockReturnValue(chain);m.select.mockReturnValue(chain);m.eq.mockReturnValue(chain);m.is.mockReturnValue(chain);m.order.mockResolvedValue({data:[],error:null});});
describe('unassigned floor-plan table reader',()=>{
  it('requires a tenant, branch, active table and null visual zone without writing anything',async()=>{
    m.order.mockResolvedValue({data:[{id:'existing-id',zone_id:null,table_number:1,name:'ĐX 01',capacity:4,status:'occupied',position_x:15,position_y:20}],error:null});
    const rows=await getUnassignedFloorPlanTables('dong-xoai');
    expect(m.from).toHaveBeenCalledWith('restaurant_tables');
    expect(m.eq.mock.calls).toEqual([['tenant_id','tenant'],['branch_id','dong-xoai'],['is_active',true]]);
    expect(m.is).toHaveBeenCalledWith('zone_id',null);
    expect(rows).toMatchObject([{id:'existing-id',zoneId:null,name:'ĐX 01',status:'occupied',positionX:15,positionY:20,width:80,height:80}]);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('does not turn a read error into an empty result',async()=>{
    m.order.mockResolvedValue({data:null,error:{message:'No access'}});
    await expect(getUnassignedFloorPlanTables('dong-xoai')).rejects.toThrow('No access');
  });
  it('does not make a request without a branch',async()=>{
    await expect(getUnassignedFloorPlanTables('')).rejects.toThrow('Chọn chi nhánh');
    expect(m.from).not.toHaveBeenCalled();
  });
});
