import { describe, it, expect } from "vitest";
import { isOperationsSameOrigin } from "@/lib/operations/same-origin";
import { operationsModuleLink } from "@/lib/operations/module-link";
function request(origin: string | null, host: string | null) {
  return {
    headers: new Headers({
      ...(origin ? { origin } : {}),
      ...(host ? { host } : {}),
    }),
    nextUrl: { origin: "http://localhost:3044", protocol: "http:" },
  };
}
describe("Hub browser-facing origin", () => {
  it("accepts the exact local browser origin despite Next normalization", () =>
    expect(
      isOperationsSameOrigin(
        request("http://127.0.0.1:3044", "127.0.0.1:3044"),
      ),
    ).toBe(true));
  it.each([
    "https://evil.example",
    "http://127.0.0.1:3045",
    "http://127.0.0.1:3044/path",
    "null",
    null,
  ])("rejects %s", (origin) =>
    expect(isOperationsSameOrigin(request(origin, "127.0.0.1:3044"))).toBe(
      false,
    ),
  );
  it("rejects a malformed host", () =>
    expect(
      isOperationsSameOrigin(
        request("http://localhost:3044", "localhost:3044,evil.example"),
      ),
    ).toBe(false));
});
describe("Hub/MKT navigation", () => {
  it("keeps local cross-module links local", () =>
    expect(
      operationsModuleLink("mkt", "task=123", "hub.localhost:3044", "http:"),
    ).toBe("http://mkthub.localhost:3044/tasks?task=123"));
  it("does not send Hub links to the MKT-only root", () =>
    expect(
      operationsModuleLink("hub", "view=todo", "mkthub.onebiz.com.vn"),
    ).toBe("https://hub.onebiz.com.vn/?view=todo"));
  it("keeps ERP routes unchanged", () =>
    expect(operationsModuleLink("mkt", "task=123", "onebiz.com.vn")).toBe(
      "/mkt/tasks?task=123",
    ));
});
