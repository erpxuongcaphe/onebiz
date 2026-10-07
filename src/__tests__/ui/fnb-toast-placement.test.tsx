import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
vi.mock("next/navigation",()=>({usePathname:()=>"/pos/fnb"}));
vi.mock("@/lib/hooks/use-fnb-subdomain",()=>({useFnbSubdomain:()=>({isFnb:false})}));
import { ToastProvider, useToast } from "@/lib/contexts/toast-context";
import { ToastContainer } from "@/components/shared/toast";
function Notify(){const {toast}=useToast();return <button onClick={()=>toast({title:"Đã gửi bếp",variant:"success"})}>Gửi thử giao diện</button>;}
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe("POS notifications never cover payment actions",()=>{
  it("renders in the reserved layout region rather than a floating overlay",async()=>{
    vi.spyOn(HTMLElement.prototype,"getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
    const view=render(<ToastProvider><div data-pos-toast-region data-testid="region"/><Notify/><ToastContainer/></ToastProvider>);
    fireEvent.click(screen.getByText("Gửi thử giao diện"));
    await waitFor(()=>expect(screen.getByTestId("region")).toHaveTextContent("Đã gửi bếp"));
    expect(screen.getByRole("status").parentElement).not.toHaveClass("fixed");
    view.rerender(<ToastProvider><div data-pos-toast-region data-testid="region"/><Notify/><div data-pos-toast-region data-testid="dialog-region"/><ToastContainer/></ToastProvider>);
    await waitFor(()=>expect(screen.getByTestId("dialog-region")).toHaveTextContent("Đã gửi bếp"));
    expect(screen.getByTestId("region")).toBeEmptyDOMElement();
  });
});
