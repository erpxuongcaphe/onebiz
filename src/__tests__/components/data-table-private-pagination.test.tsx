import {render,screen} from "@testing-library/react";
import {describe,it,expect} from "vitest";
import {DataTablePagination} from "@/components/shared/data-table/pagination";
describe("private aggregate pagination",()=>{
 it("keeps navigation without revealing record or page totals",()=>{
  render(<DataTablePagination pageIndex={0} pageSize={20} pageCount={7} total={135} hideAggregateCounts/>);
  expect(screen.getByText("Trang 1")).toBeInTheDocument();expect(screen.queryByText(/135 bản ghi/)).toBeNull();
  expect(screen.queryByRole("button",{name:"Trang cuối"})).toBeNull();expect(screen.getByRole("button",{name:"Trang sau"})).toBeEnabled();
 });
 it("retains existing totals by default on other pages",()=>{
  render(<DataTablePagination pageIndex={0} pageSize={20} pageCount={7} total={135}/>);
  expect(screen.getByText(/135 bản ghi/)).toBeInTheDocument();expect(screen.getByText("1 / 7")).toBeInTheDocument();
 });
});
