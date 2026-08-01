import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pwaHead = readFileSync("src/components/shared/pwa-head.tsx", "utf8");
const managerWorker = readFileSync("public/sw-manager.js", "utf8");

describe("PWA cache safety", () => {
  it("unregisters service workers and clears OneBiz caches on localhost", () => {
    expect(pwaHead).toContain('window.location.hostname === "localhost"');
    expect(pwaHead).toContain('window.location.hostname === "127.0.0.1"');
    expect(pwaHead).toContain("registration.unregister()");
    expect(pwaHead).toContain('key.startsWith("onebiz-")');
  });

  it("uses a new manager cache and never intercepts local development", () => {
    expect(managerWorker).toContain('onebiz-manager-v4');
    expect(managerWorker).not.toContain('onebiz-manager-v3');
    expect(managerWorker).toContain('url.hostname === "localhost"');
    expect(managerWorker).toContain('url.hostname === "127.0.0.1"');
  });
});
