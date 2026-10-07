import { describe, expect, it, vi, beforeEach } from "vitest";
import { encodeRaster } from "@/lib/printer/raster-print";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), raster: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/printer/raster-print", async importOriginal => ({ ...await importOriginal<object>(), rasterPrintBytes: mocks.raster }));
import { enqueueBranchPrint } from "@/lib/printer/branch-queue";
// Standalone agent is also distributed as browser-downloadable JS.
import { validateRaster, applyCutSetting } from "../../../public/print-point/agent.mjs";
beforeEach(() => { vi.clearAllMocks(); });
describe("branch print dispatch", () => {
  it("renders using the physical route paper and retains one request ID", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { point: { enabled: true, routes: [{ key: "station", printer: "Bar", paper: "58mm" }] } } }).mockResolvedValueOnce({ data: { id: "job" } });
    mocks.raster.mockResolvedValue(new Uint8Array([1,2]));
    const build = vi.fn(() => "58mm receipt");
    await enqueueBranchPrint({ branchId: "b", routeKey: "station", label: "Món gọi thêm", html: "80mm receipt", paper: "80mm", buildHtml: build, jobId: "job" });
    expect(build).toHaveBeenCalledWith("58mm"); expect(mocks.raster).toHaveBeenCalledWith("58mm receipt", "58mm");
    expect(mocks.rpc).toHaveBeenLastCalledWith("fnb_print_enqueue_v1", expect.objectContaining({ p_id: "job", p_route: "station", p_paper: "58mm" }));
  });
  it("does not redirect missing station to the shared kitchen", async () => {
    mocks.rpc.mockResolvedValue({ data: { point: { enabled: true, routes: [{ key: "kitchen", printer: "Bếp", paper: "80mm" }] } } });
    await expect(enqueueBranchPrint({ branchId: "b", routeKey: "missing", label: "Test", html: "x", paper: "80mm", jobId: "j" })).rejects.toThrow("Chưa gán máy");
    expect(mocks.raster).not.toHaveBeenCalled();
  });
  it("rejects paper mismatch when no layout builder exists", async () => {
    mocks.rpc.mockResolvedValue({ data: { point: { enabled: true, routes: [{ key: "cashier", printer: "Quầy", paper: "58mm" }] } } });
    await expect(enqueueBranchPrint({ branchId: "b", routeKey: "cashier", label: "Test", html: "x", paper: "80mm", jobId: "j" })).rejects.toThrow("Khổ giấy");
  });
});
describe("print point raster safety", () => {
  it("disables only the trailing cutter command and retains feed and raster", () => {
    const bytes = encodeRaster(576,1,new Uint8ClampedArray(576*4).fill(255));
    expect(applyCutSetting(bytes)).toBe(bytes);
    expect(applyCutSetting(bytes, false)).toEqual(bytes.subarray(0, bytes.length - 3));
    expect(() => applyCutSetting(new Uint8Array([1,2,3]),false)).toThrow();
  });
  it.each([384,576])("accepts renderer output with %i dots", width => {
    const rgba = new Uint8ClampedArray(width * 300 * 4).fill(255);
    expect(() => validateRaster(encodeRaster(width,300,rgba), width === 384 ? "58mm" : "80mm")).not.toThrow();
  });
  it("rejects injected drawer commands, truncated data and wrong paper width", () => {
    const bytes = encodeRaster(384,1,new Uint8ClampedArray(384*4).fill(255));
    expect(() => validateRaster(new Uint8Array([...bytes,27,112,0,10,10]),"58mm")).toThrow();
    expect(() => validateRaster(bytes.subarray(0,bytes.length-1),"58mm")).toThrow();
    expect(() => validateRaster(bytes,"80mm")).toThrow();
  });
});
