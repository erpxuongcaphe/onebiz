import {describe,it,expect} from "vitest";
import {choiceKey,parseFnbChoiceFilter,matchesFnbChoiceFilter,FNB_MISSING,FNB_EMPTY} from "@/lib/utils/fnb-invoice-choice-filter";
const groups=(temp:string)=>[{groupName:"Đá/Nóng",options:[{label:temp}]},{groupName:"Mức ngọt",options:[{label:"80%"}]},{groupName:"Thêm kem",options:[]}];
describe("FNB same-line choices",()=>{
 it("matches recorded size/temperature/sweetness/other together, never combines different items",()=>{
 const filter={size:"Size L",groups:{[choiceKey("Đá/Nóng")]:"Nóng",[choiceKey("Mức ngọt")]:"80%"}};
 expect(matchesFnbChoiceFilter("Trà (Size L)",null,groups("Nóng"),filter)).toBe(true);
 expect(matchesFnbChoiceFilter("Trà (Size L)",null,groups("Đá"),filter)).toBe(false);
 expect(matchesFnbChoiceFilter("Trà (Size M)",null,groups("Nóng"),filter)).toBe(false);
 });
 it("distinguishes missing, empty group and explicit label",()=>{
 const key=choiceKey("Thêm kem");expect(matchesFnbChoiceFilter("Trà",null,groups("Đá"),{groups:{[key]:FNB_EMPTY}})).toBe(true);
 expect(matchesFnbChoiceFilter("Trà",null,groups("Đá"),{groups:{[key]:FNB_MISSING}})).toBe(false);
 expect(matchesFnbChoiceFilter("Trà",null,null,{size:FNB_MISSING,groups:{[key]:FNB_MISSING}})).toBe(true);
 });
 it("rejects malformed filters rather than silently dropping them",()=>{
 expect(()=>parseFnbChoiceFilter('{')).toThrow();expect(()=>parseFnbChoiceFilter({groups:{'evil->id':"x"}})).toThrow();expect(parseFnbChoiceFilter('{}')).toEqual({});
 expect(choiceKey("Đá/Nóng")).toBe("g_c490c3a12f4ec3b36e67");
 });
});
