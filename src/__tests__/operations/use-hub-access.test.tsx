import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { useHubAccess } from "@/lib/operations/use-hub-access";

const auth = vi.hoisted(() => ({
  current: { authUser: { id: "a" } as { id: string } | null, user: { id: "a" }, hasPermission: () => true, isLoading: false },
}));
vi.mock("@/lib/contexts", () => ({ useAuth: () => auth.current }));

function Menu({ name }: { name: string }) {
  const allowed = useHubAccess();
  return <div data-testid={name}>{allowed ? "allowed" : "hidden"}</div>;
}

function response(allowed: boolean, status = 200) {
  return { ok: status === 200, json: async () => ({ allowed }) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  auth.current = { authUser: { id: "a" }, user: { id: "a" }, hasPermission: () => true, isLoading: false };
});

describe("Hub access request sharing", () => {
  it("shares a pending request and rechecks when a new consumer mounts after it settles", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    const fetch = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(response(true));
    vi.stubGlobal("fetch", fetch);

    const view = render(<><Menu name="sidebar" /><Menu name="header" /><Menu name="mobile" /></>);
    expect(fetch).toHaveBeenCalledTimes(1);
    view.rerender(<><Menu name="sidebar" /><Menu name="header" /></>);
    await act(async () => { pending.resolve(response(true)); });
    expect(screen.getByTestId("sidebar").textContent).toBe("allowed");
    expect(screen.getByTestId("header").textContent).toBe("allowed");

    await act(async () => { view.rerender(<><Menu name="sidebar" /><Menu name="header" /><Menu name="switcher" /></>); });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("ignores a result from an old session even when the account ID matches", async () => {
    const old = deferred<ReturnType<typeof response>>();
    const current = deferred<ReturnType<typeof response>>();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    vi.stubGlobal("fetch", fetch);
    const view = render(<Menu name="nav" />);

    auth.current = { ...auth.current, authUser: { id: "a" } };
    view.rerender(<Menu name="nav" />);
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => { old.resolve(response(true)); });
    expect(screen.getByTestId("nav").textContent).toBe("hidden");

    await act(async () => { current.resolve(response(true, 403)); });
    expect(screen.getByTestId("nav").textContent).toBe("hidden");
    auth.current = { ...auth.current, authUser: null };
    view.rerender(<Menu name="nav" />);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the link hidden on network failure and allows a subsequent request", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(response(true));
    vi.stubGlobal("fetch", fetch);
    const view = render(<><Menu name="nav" /><Menu name="sidebar" /></>);
    await act(async () => {});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("nav").textContent).toBe("hidden");
    await act(async () => { view.rerender(<><Menu name="nav" /><Menu name="sidebar" /><Menu name="mobile" /></>); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("mobile").textContent).toBe("allowed");
  });
});
