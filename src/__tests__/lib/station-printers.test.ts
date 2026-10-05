import {beforeEach,describe,it,expect} from "vitest";
import {loadStationPrinter,saveStationPrinter,clearStationPrinter} from "@/lib/printer/station-printers";
beforeEach(()=>localStorage.clear());
describe("local station printer scope",()=>{
  it("separates branches and stations and preserves device serial",()=>{
    saveStationPrinter("branch-a","bar",{vendorId:1,productId:2,name:"Bar",manufacturer:"Test",serialNumber:"A"});
    expect(loadStationPrinter("branch-a","bar")?.serialNumber).toBe("A");
    expect(loadStationPrinter("branch-b","bar")).toBeNull();
    expect(loadStationPrinter("branch-a","kitchen")).toBeNull();
    clearStationPrinter("branch-b","bar");
    expect(loadStationPrinter("branch-a","bar")).not.toBeNull();
    clearStationPrinter("branch-a","bar");
    expect(loadStationPrinter("branch-a","bar")).toBeNull();
  });
  it("ignores malformed stored configuration",()=>{
    localStorage.setItem("onebiz_station_printer:a:b",'{"vendorId":"bad"}');
    expect(loadStationPrinter("a","b")).toBeNull();
  });
});
