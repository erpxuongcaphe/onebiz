import path from "node:path";

const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    // Turbopack loads PostCSS from .next/build; resolve local plugins from the project.
    [path.resolve(process.cwd(), "scripts/postcss-fnb-legacy-colors.cjs")]: {},
  },
};

export default config;
