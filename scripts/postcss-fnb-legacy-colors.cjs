const postcss = require("postcss");
const { transform } = require("lightningcss");

const scope = 'body[data-fnb-legacy-colors="true"]';
const colorProperty = /^(?:color|background-color|border(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?-color|outline-color|fill|stroke|caret-color|text-decoration-color|accent-color)$/;
const modernColor = /(?:oklch|oklab|color-mix|lab|lch|color)\(/;
const legacyColorCondition = 'not ((color: oklch(1 0 0)) and (color: color-mix(in oklab, black, transparent)))';

function resolve(value, palette) {
  for (let index = 0; index < 12 && value.includes("var("); index++) {
    const previous = value;
    value = value.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (full, name, fallback) => palette.get(name) ?? fallback ?? full);
    if (value === previous) break;
  }
  return value;
}

// Use Tailwind's installed color compiler; no runtime library or browser mutation.
function rgbValue(value) {
  const css = transform({ filename: "fnb-color.css", code: Buffer.from(`.color{color:${value}}`), targets: { chrome: 101 << 16 }, minify: true }).code.toString();
  const rule = postcss.parse(css).first;
  // Lightning CSS emits a compatible RGB first, followed by optional wide-gamut colors.
  return rule.nodes.find(node => node.type === "decl" && node.prop === "color")?.value;
}

function buildLegacyColorFallback(root) {
  const light = new Map();
  const dark = new Map();
  root.walkRules(rule => {
    if (![":root", ":root, :host", ".dark"].includes(rule.selector)) return;
    rule.each(node => {
      if (node.type !== "decl" || !node.prop.startsWith("--")) return;
      if (rule.selector === ".dark") dark.set(node.prop, node.value);
      else light.set(node.prop, node.value);
    });
  });
  const darkPalette = new Map([...light, ...dark]);
  const fallback = postcss.atRule({ name: "supports", params: legacyColorCondition });
  for (const [palette, prefix] of [[light, scope], [darkPalette, `.dark ${scope}`]]) {
    const tokens = postcss.rule({ selector: prefix });
    for (const [name, value] of palette) {
      const resolved = resolve(value, palette);
      if (!modernColor.test(resolved) || resolved.includes("var(")) continue;
      // Custom properties must contain ONLY the old color, not the modern value.
      const rgb = rgbValue(resolved);
      if (rgb) tokens.append(postcss.decl({ prop: name, value: rgb }));
    }
    fallback.append(tokens);
    function copy(container, parent, insideRule = false) {
      for (const node of container.nodes ?? []) {
        if (node.type === "decl") {
          if (!colorProperty.test(node.prop) || !modernColor.test(resolve(node.value, palette))) continue;
          // Static currentColor mixes use the readable theme foreground on old engines.
          const value = resolve(node.value, palette).replace(/currentcolor/gi, resolve(palette.get("--foreground") ?? "#111827", palette));
          if (value.includes("var(")) continue;
          const rgb = rgbValue(value);
          if (rgb) parent.append(node.clone({ value: rgb }));
        } else if (node.type === "rule") {
          if ([":root", ":root, :host", ".dark"].includes(node.selector)) continue;
          const selector = insideRule ? node.selector : postcss.list.comma(node.selector).map(part => `${prefix} ${part}`).join(", ");
          const clone = node.clone({ selector, nodes: [] });
          copy(node, clone, true);
          if (clone.nodes.length) parent.append(clone);
        } else if (node.type === "atrule") {
          if (["layer"].includes(node.name) || (node.name === "supports" && /color-mix|oklch|oklab/.test(node.params))) {
            copy(node, parent, insideRule);
          } else if (["media", "supports", "container"].includes(node.name)) {
            const clone = node.clone({ nodes: [] });
            copy(node, clone, insideRule);
            if (clone.nodes.length) parent.append(clone);
          }
        }
      }
    }
    copy(root, fallback);
  }
  // Flatten nested selectors for Chrome 101/109; keep only generated color rules.
  const compiled = transform({ filename: "fnb-legacy-colors.css", code: Buffer.from(fallback.toString()), targets: { chrome: 101 << 16 }, minify: true }).code.toString();
  return postcss.parse(compiled).nodes;
}

function fnbLegacyColors() {
  return {
    postcssPlugin: "onebiz-fnb-legacy-colors",
    OnceExit(root) {
      // Only globals.css owns the palette. CSS modules and other sheets are untouched.
      if (!root.source?.input.file?.replaceAll("\\", "/").endsWith("/src/app/globals.css")) return;
      root.append(buildLegacyColorFallback(root));
    },
  };
}
fnbLegacyColors.postcss = true;

module.exports = fnbLegacyColors;
module.exports.buildLegacyColorFallback = buildLegacyColorFallback;
module.exports.legacyColorCondition = legacyColorCondition;


