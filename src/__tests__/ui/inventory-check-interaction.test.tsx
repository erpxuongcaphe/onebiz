import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({uom:vi.fn(),rpc:vi.fn(),toast:vi.fn(),branch:{id:'branch',branchType:'store'},branches:[{id:'branch',branchType:'store'}]}));
vi.mock('@/lib/contexts',()=>({useAuth:()=>({activeBranchId:'branch',currentBranch:m.branch,branches:m.branches}),useToast:()=>({toast:m.toast})}));
vi.mock('@/lib/services/supabase/uom',()=>({getUOMConversions:m.uom,getUOMConversionsByProductIds:async()=>new Map()}));
vi.mock('@/lib/services/supabase/document-copy',()=>({loadDocumentCopy:vi.fn()}));
vi.mock('@/lib/services/supabase/base',()=>({getCurrentContext:async()=>({tenantId:'tenant',branchId:'branch'}),getClient:()=>({rpc:m.rpc,from:(table:string)=>{const result={data:table==='products_scoped'?[{id:'rich',code:'SKU-SST-017',name:'Rich lùn',unit:'Hộp',cost_price:10}]:[{quantity:3.1314}],error:null};const q={select:()=>q,eq:()=>q,is:()=>q,or:()=>q,limit:async()=>result,then:(resolve:(r:unknown)=>unknown)=>Promise.resolve(result).then(resolve)};return q;}})}));
import {CreateInventoryCheckDialog} from '@/components/shared/dialogs/create-inventory-check-dialog';
beforeEach(()=>vi.clearAllMocks());afterEach(cleanup);
describe('inventory count input stability',()=>{
 it('coalesces rapid clicks during stock/UOM loading and never appends duplicate keys',async()=>{
  let finish!:(rows:[])=>void;m.uom.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  render(<CreateInventoryCheckDialog open onOpenChange={vi.fn()}/>);
  fireEvent.change(screen.getByPlaceholderText('Tìm theo mã, tên hoặc barcode'),{target:{value:'Rich'}});
  const add=await screen.findByRole('button',{name:/Rich lùn.*SKU-SST-017/});
  act(()=>{fireEvent.click(add);fireEvent.click(add);fireEvent.click(add);});
  await waitFor(()=>expect(m.uom).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button',{name:'Hoàn thành kiểm kho'})).toBeDisabled();
  await act(async()=>finish([]));
  expect(screen.getAllByRole('button',{name:'Bỏ Rich lùn'})).toHaveLength(1);
  const input=screen.getByRole('textbox',{name:'Tồn thực tế Rich lùn'});fireEvent.change(input,{target:{value:'2.5'}});
  expect(input).toHaveValue('2.5');expect(screen.getAllByRole('textbox',{name:'Tồn thực tế Rich lùn'})).toHaveLength(1);expect(m.rpc).not.toHaveBeenCalled();
 });
 it('ignores an add response belonging to a closed form session',async()=>{
  let finish!:(rows:[])=>void;m.uom.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  const v=render(<CreateInventoryCheckDialog open onOpenChange={vi.fn()}/>);
  fireEvent.change(screen.getByPlaceholderText('Tìm theo mã, tên hoặc barcode'),{target:{value:'Rich'}});
  fireEvent.click(await screen.findByRole('button',{name:/Rich lùn.*SKU-SST-017/}));await waitFor(()=>expect(m.uom).toHaveBeenCalledTimes(1));
  v.rerender(<CreateInventoryCheckDialog open={false} onOpenChange={vi.fn()}/>);await act(async()=>finish([]));
  v.rerender(<CreateInventoryCheckDialog open onOpenChange={vi.fn()}/>);
  expect(screen.queryByRole('button',{name:'Bỏ Rich lùn'})).not.toBeInTheDocument();expect(m.rpc).not.toHaveBeenCalled();
 });
});
