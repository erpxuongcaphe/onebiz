import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "src");

function listSourceFiles(folder: string): string[] {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

describe("notifications do not expose a browser-side create helper", () => {
  it("keeps notification creation in server-only routes and cron jobs", () => {
    const clientService = path.join(root, "lib/services/supabase/notifications.ts");
    const facade = path.join(root, "lib/services/supabase/index.ts");

    expect(fs.readFileSync(clientService, "utf8")).not.toMatch(/\bcreateNotification\b/);
    expect(fs.readFileSync(facade, "utf8")).not.toMatch(/\bcreateNotification\b/);

    const browserCallers = listSourceFiles(root)
      .filter((file) => !file.includes(`${path.sep}api${path.sep}`))
      .filter((file) => fs.readFileSync(file, "utf8").includes(".from(\"notifications\").insert"));

    expect(browserCallers).toEqual([]);
  });
});
