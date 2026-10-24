import {render,act} from "@testing-library/react";
import {describe,it,expect,vi,afterEach} from "vitest";
import {DataTable} from "@/components/shared/data-table";
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe("expanded management detail viewport",()=>{
 it("keeps detail within the visible scroller and updates on resize without changing table data",()=>{
  vi.stubGlobal("matchMedia",()=>({matches:true,addEventListener:()=>{},removeEventListener:()=>{}}));
  let width=740;const measure=vi.spyOn(HTMLElement.prototype,"clientWidth","get").mockImplementation(()=>width);
  let resize=()=>{};const disconnect=vi.fn();
  vi.stubGlobal("ResizeObserver",class {constructor(cb:()=>void){resize=cb;}observe(){}disconnect=disconnect;});
  const rows=[{id:"a",name:"Bill A",total:30000}];
  const view=render(<DataTable fitDetailToViewport columns={[{accessorKey:"name",header:"Mã",size:500},{accessorKey:"total",header:"Tiền",size:500}]} data={rows} total={1} expandedRow={0} renderDetail={()=> <p>Chi tiết món</p>}/>);
  const detail=view.container.querySelector('[data-slot="detail-viewport"]') as HTMLElement;
  expect(detail.style.width).toBe("738px");
  act(()=>{width=580;resize();});expect(detail.style.width).toBe("578px");
  act(()=>{width=0;resize();});expect(detail.style.width).toBe("");expect(rows[0].total).toBe(30000);
  view.unmount();expect(disconnect).toHaveBeenCalled();measure.mockRestore();
 });
});
