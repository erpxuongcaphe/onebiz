// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  upload: vi.fn(),
  sign: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    rpc: mocks.rpc,
    auth: { getUser: mocks.getUser },
    storage: {
      from: () => ({ upload: mocks.upload, createSignedUrl: mocks.sign }),
    },
  }),
}));
import { GET, POST } from "@/app/api/operations/evidence/route";
const entity = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
function request(
  file = new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    "anh.png",
    { type: "image/png" },
  ),
  origin = "http://localhost:3000",
) {
  const body = new FormData();
  body.set("file", file);
  body.set("entity", entity);
  body.set("kind", "run");
  return new NextRequest("http://localhost:3000/api/operations/evidence", {
    method: "POST",
    headers: { origin },
    body,
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "user" } },
    error: null,
  });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.rpc.mockImplementation(async (name: string) =>
    name === "ops_evidence_reserve"
      ? { data: { id, path: "tenant/file" }, error: null }
      : { data: { id, file_name: "anh.png" }, error: null },
  );
});
describe("Private evidence API", () => {
  it("rejects cross-origin uploads before accessing storage", async () => {
    expect(
      (await POST(request(undefined, "https://other.example"))).status,
    ).toBe(403);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("rejects a renamed HTML file", async () => {
    expect(
      (
        await POST(
          request(new File(["<html>"], "anh.png", { type: "image/png" })),
        )
      ).status,
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("checks permission before uploading", async () => {
    mocks.rpc.mockResolvedValue({
      error: { message: "OPS_FORBIDDEN" },
      data: null,
    });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("uploads without overwrite and confirms only after storage success", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.upload.mock.calls[0][2]).toEqual({
      contentType: "image/png",
      upsert: false,
    });
    expect(mocks.rpc.mock.calls.map((c) => c[0])).toEqual([
      "ops_evidence_reserve",
      "ops_evidence_finish",
    ]);
  });
  it("does not falsely confirm a failed upload", async () => {
    mocks.upload.mockResolvedValue({ error: { message: "offline" } });
    expect((await POST(request())).status).toBe(503);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not sign a file outside the visible entity", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(
      (
        await GET(
          new NextRequest(
            `http://localhost:3000/api/operations/evidence?entity=${entity}&id=${id}`,
          ),
        )
      ).status,
    ).toBe(404);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});
