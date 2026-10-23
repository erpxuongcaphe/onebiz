import {render,screen} from "@testing-library/react";
import {describe,it,expect} from "vitest";
import {InvoiceItemName} from "@/components/shared/invoice-item-name";
describe("compact invoice item note",()=>{
 it("renders the full note under the item name with readable compact text",()=>{
  const note="Ít đá\nĐể riêng – "+"Ghi chú dài ".repeat(20);
  render(<InvoiceItemName name="Cà phê" note={note}/>);
  expect(screen.getByText("Cà phê")).toBeInTheDocument();
  const p=screen.getByText(/Ghi chú: Ít đá/);expect(p.textContent).toBe("Ghi chú: "+note);
  expect(p).toHaveClass("text-[13px]","text-foreground","break-words","whitespace-pre-wrap");expect(p.className).not.toMatch(/line-clamp|truncate/);
 });
 it("does not add an empty note row or interpret markup",()=>{
  const v=render(<InvoiceItemName name="Trà" note="   "/>);expect(v.container.querySelector("p")).toBeNull();
  v.rerender(<InvoiceItemName name="Trà" note={'<script>alert(1)</script>'}/>);expect(v.container.querySelector("script")).toBeNull();expect(screen.getByText(/<script>/)).toBeInTheDocument();
 });
});
