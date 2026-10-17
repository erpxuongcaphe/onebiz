import { describe, it, expect } from "vitest";
import { normalizeFnbMethods, availableFnbMethods } from "@/lib/fnb-payment-methods";
describe("FnB payment visibility", () => {
 it("preserves defaults only for missing config and validates an empty method set", () => {
   expect(availableFnbMethods(normalizeFnbMethods(null))).toEqual(["cash", "transfer", "card", "mixed"]);
   expect(() => normalizeFnbMethods({cash:false, transfer:false, card:false})).toThrow();
 });
 it("offers mixed only when two enabled methods can actually collect money", () => {
   expect(availableFnbMethods({cash:false,transfer:true,card:false})).toEqual(["transfer"]);
   expect(availableFnbMethods({cash:true,transfer:true,card:false})).toEqual(["cash","transfer","mixed"]);
 });
});
