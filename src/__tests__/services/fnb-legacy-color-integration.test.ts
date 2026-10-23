// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const legacy = require("../../../scripts/postcss-fnb-legacy-colors.cjs");
let baseline: string;
let result: string;

function semantic(node: {toJSON: () => unknown}) {
  function clean(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["raws", "source", "inputs"].includes(key)).map(([key, item]) => [key, clean(item)]));
    return value;
  }
  return clean(node.toJSON());
}

beforeAll(async () => {
  const from = path.resolve("src/app/globals.css");
  const compiled = await postcss([tailwind({base: process.cwd()})]).process(readFileSync(from, "utf8"), {from});
  baseline = compiled.css;
  result = (await postcss([legacy()]).process(baseline, {from})).css;
}, 30000);

describe("real application CSS color fallback", () => {
  it("keeps every original rule/declaration unchanged, adds a single support gate", () => {
    const root = postcss.parse(result);
    expect(root.last.name).toBe("supports");
    expect(root.last.params).toContain("not (");
    root.last.remove();
    expect(semantic(root)).toEqual(semantic(postcss.parse(baseline)));
  });
  it("contains only RGB colors/alpha in legacy declarations, preserves states, scopes every rule", () => {
    const gate = postcss.parse(result).last;
    gate.walkRules((rule: {selector: string}) => expect(rule.selector).toContain("body[data-fnb-legacy-colors=true]"));
    gate.walkDecls((decl: {prop: string; value: string}) => {
      expect(decl.value).not.toMatch(/(?:oklch|oklab|color-mix|lab|lch|var)\(/);
      if (!decl.prop.startsWith("--")) expect(decl.prop).toMatch(/color|fill|stroke/);
    });
    expect(gate.toString()).toContain(":hover");
    expect(gate.toString()).toContain(".dark body");
  });
  it("corrects selected category/cart/order-type backgrounds to 10% and cart header to 2.5%", () => {
    const gate = postcss.parse(result).last;
    const declarations: Record<string, string[]> = {};
    gate.walkRules((rule: {selector: string; walkDecls: (fn: (d: {prop: string; value: string}) => void) => void}) => {
      rule.walkDecls(decl => {
        if (decl.prop === "background-color") (declarations[rule.selector] ??= []).push(decl.value);
      });
    });
    const selected = Object.entries(declarations).filter(([selector]) => selector.endsWith(" .bg-primary\\/10"));
    expect(selected.length).toBe(2);
    selected.forEach(([, values]) => expect(values.at(-1)).toMatch(/^#[0-9a-f]{6}1a$/i));
    const header = Object.entries(declarations).filter(([selector]) => selector.includes(" .bg-primary\\/\\[0\\.025\\]"));
    expect(header.length).toBe(2);
    header.forEach(([, values]) => expect(values.at(-1)).toMatch(/^#[0-9a-f]{6}06$/i));
  });
  it("ignores unrelated CSS files", async () => {
    const css = ".example { color: oklch(1 0 0); }";
    const processed = await postcss([legacy()]).process(css, {from: path.resolve("src/other.css")});
    expect(processed.css).toBe(css);
  });
});
