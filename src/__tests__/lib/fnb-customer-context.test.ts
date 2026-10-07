import { describe, expect, it } from "vitest";
import { customerContextFromOrder, needsCustomerSelection } from "@/lib/fnb-customer-context";
import type { KitchenOrder, FnbTabSnapshot } from "@/lib/types/fnb";
describe("shared order customer context", () => {
  it("preserves an explicitly selected walk-in customer on another device", () => {
    expect(customerContextFromOrder({customerSelected:true,customerId:null,customerName:"Khách lẻ"} as KitchenOrder)).toEqual({customerId:undefined,customerName:"Khách lẻ",customerConfirmationRequired:false});
  });
  it("restores the same customer ID and snapshot name", () => {
    expect(customerContextFromOrder({customerSelected:true,customerId:"customer-1",customerName:"Lan"} as KitchenOrder)).toEqual({customerId:"customer-1",customerName:"Lan",customerConfirmationRequired:false});
  });
  it("does not turn a legacy unknown guest into a confirmed walk-in", () => {
    expect(customerContextFromOrder({} as KitchenOrder).customerConfirmationRequired).toBe(true);
    expect(needsCustomerSelection({customerName:"Khách lẻ"} as FnbTabSnapshot)).toBe(true);
    expect(needsCustomerSelection({customerConfirmationRequired:false} as FnbTabSnapshot)).toBe(false);
  });
});
