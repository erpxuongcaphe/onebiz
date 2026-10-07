import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
const net = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("node:net", () => ({ createConnection: net.connect, default: { createConnection: net.connect } }));
import { parseDestination, networkDestination, withPrinterCut, CONNECTION_PROBE, isConnectionProbe } from "../../../public/print-point/destination.mjs";
import { sendNetworkPrint } from "../../../public/print-point/network.mjs";

describe("printer destination", () => {
  it("round trips cut preference on network and installed printers", () => {
    const usb = withPrinterCut("Xprinter Quầy / USB", false);
    expect(parseDestination(usb)).toEqual({ type: "windows", printer: "Xprinter Quầy / USB", cut: false });
    expect(withPrinterCut(usb,true)).toBe("Xprinter Quầy / USB");
    expect(withPrinterCut("tcp://192.168.10.222:9100",false)).toBe("tcp://192.168.10.222:9100?cut=0");
    expect(parseDestination("tcp://192.168.10.222:9100?cut=0")).toMatchObject({ type: "tcp", cut: false });
  });
  it("recognizes only the exact non-printing probe payload", () => {
    expect(isConnectionProbe(new Uint8Array(CONNECTION_PROBE))).toBe(true);
    expect(isConnectionProbe(new Uint8Array([...CONNECTION_PROBE, 27,112]))).toBe(false);
  });
  it("retains installed USB printer names", () => expect(parseDestination(" Xprinter USB ")).toEqual({ type: "windows", printer: "Xprinter USB" }));
  it("uses the supplied LAN port and defaults only when omitted", () => {
    expect(networkDestination("192.168.10.222")).toBe("tcp://192.168.10.222:9100");
    expect(parseDestination("tcp://10.1.2.3:9200")).toEqual({ type: "tcp", host: "10.1.2.3", port: 9200 });
  });
  it.each(["tcp://:9100", "tcp://192.168.10.222:0", "tcp://192.168.10.222:65536", "tcp://192.168.1.999:9100", "tcp://8.8.8.8:9100", "tcp://127.0.0.1:9100", "tcp://192.168.1.255:9100", "tcp://printer.example:9100", "tcp://192.168.1.2:9100/path", "https://192.168.1.2"])('rejects invalid or non-LAN target %s', value => expect(() => parseDestination(value)).toThrow());
});

describe("single network send", () => {
  let socket: EventEmitter & { destroy: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  beforeEach(() => { vi.useFakeTimers(); net.connect.mockReset(); socket = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn() }); net.connect.mockReturnValue(socket); });
  afterEach(() => vi.useRealTimers());
  it("sends bytes once to the configured printer and never promises paper", async () => {
    const bytes = Buffer.from([27,64]);
    socket.end.mockImplementation((_bytes: Buffer, done: () => void) => done());
    const pending = sendNetworkPrint("tcp://192.168.10.222:9100", bytes);
    socket.emit("connect");
    expect(await pending).toMatchObject({ status: "handed_off" });
    expect(net.connect).toHaveBeenCalledWith({ host: "192.168.10.222", port: 9100 });
    expect(socket.end).toHaveBeenCalledExactlyOnceWith(bytes, expect.any(Function));
    expect(socket.destroy).toHaveBeenCalledOnce();
  });
  it("reports failure before bytes and does not retry", async () => {
    const pending = sendNetworkPrint("tcp://192.168.10.222:9100", Buffer.from([1]));
    socket.emit("error", new Error("refused"));
    expect(await pending).toMatchObject({ status: "failed" });
    expect(socket.end).not.toHaveBeenCalled(); expect(net.connect).toHaveBeenCalledOnce();
  });
  it("checks the port without sending or cutting any paper", async () => {
    const pending = sendNetworkPrint("tcp://192.168.10.222:9100", null);
    socket.emit("connect");
    expect(await pending).toMatchObject({ status: "handed_off", message: expect.stringContaining("Chưa gửi dữ liệu in") });
    expect(socket.end).not.toHaveBeenCalled(); expect(socket.destroy).toHaveBeenCalledOnce();
  });
  it("requires paper inspection if the connection fails after send starts", async () => {
    const pending = sendNetworkPrint("tcp://192.168.10.222:9100", Buffer.from([1]));
    socket.emit("connect"); socket.emit("error", new Error("reset"));
    expect(await pending).toMatchObject({ status: "unknown" });
    expect(net.connect).toHaveBeenCalledOnce();
  });
  it("times out without resending and cleans up the socket", async () => {
    const pending = sendNetworkPrint("tcp://192.168.10.222:9100", Buffer.from([1]), 100);
    socket.emit("connect"); await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ status: "unknown" }); expect(socket.destroy).toHaveBeenCalledOnce();
  });
});
