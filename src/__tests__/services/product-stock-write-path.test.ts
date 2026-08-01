import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const service = readFileSync(
  join(process.cwd(), "src/lib/services/supabase/products.ts"),
  "utf8",
);

describe("product stock write path", () => {
  it("always creates a catalog item with zero stock", () => {
    const createSection = service.slice(
      service.indexOf("export async function createProduct"),
      service.indexOf("export async function updateProduct"),
    );
    expect(createSection).toMatch(/stock:\s*0/);
    expect(createSection).not.toContain("product.stock ?? 0");
  });

  it("does not let catalog edits update the stock snapshot", () => {
    const updateSection = service.slice(
      service.indexOf("export async function updateProduct"),
      service.indexOf("export async function deleteProduct"),
    );
    expect(updateSection).not.toMatch(/payload\.stock\s*=/);
  });
});
