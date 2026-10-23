// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const postcss = require("postcss");
const { buildLegacyColorFallback } = require("../../../scripts/postcss-fnb-legacy-colors.cjs");

const sample = `@layer theme { :root, :host { --color-white: #fff; } }
:root { --primary: oklch(.43 .19 263); --foreground: oklch(.175 .015 260); }
.dark { --primary: oklch(.7 .18 263); }
@layer utilities {
.bg-primary\\/10 { background-color: var(--primary); @supports (color: color-mix(in lab, red, red)) { background-color: color-mix(in oklab, var(--primary) 10%, transparent); } }
.text-primary { color: var(--primary); }
.hover\\:bg-primary\\/10 { &:hover { @media (hover: hover) { background-color: color-mix(in oklab, var(--primary) 10%, transparent); } } }
.flex { display:flex; height:100dvh; }
}`;

describe("F&B legacy color compiler", () => {
  it("adds only capability-gated, route-scoped color fallbacks without mutating original CSS", () => {
    const root = postcss.parse(sample);
    const before = root.toString();
    const nodes = buildLegacyColorFallback(root);
    expect(root.toString()).toBe(before);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe("supports");
    expect(nodes[0].params).toContain("not (");
    const css = nodes[0].toString();
    expect(css).toMatch(/body\[data-fnb-legacy-colors="?true"?\]/);
    expect(css).toContain(".dark body");
    expect(css).not.toMatch(/display:|height:|transform:|translate:/);
    expect(css).not.toContain("var(");
    nodes[0].walkDecls((decl: {value: string}) => expect(decl.value).not.toMatch(/(?:oklch|oklab|color-mix|lab|lch)\(/));
  });
  it("retains alpha instead of Tailwind opaque fallback and preserves hover/media state", () => {
    const css = buildLegacyColorFallback(postcss.parse(sample))[0].toString();
    expect(css).toMatch(/background-color:(?:#[0-9a-f]{8}|rgba\([^)]*,\s*\.1\))/i);
    expect(css).toContain(":hover");
    expect(css).toMatch(/@media\s*\(hover:hover\)/);
    expect(css).not.toContain("@supports (color: color-mix");
  });
  it("supplies RGB custom property values so old Chrome does not inherit unsupported colors", () => {
    const nodes = buildLegacyColorFallback(postcss.parse(sample));
    let count = 0;
    nodes[0].walkDecls((decl: {prop: string; value: string}) => {
      if (decl.prop.startsWith("--")) {
        count++;
        expect(decl.value).toMatch(/^#|^rgba?\(/);
      }
    });
    expect(count).toBeGreaterThan(0);
  });
});


