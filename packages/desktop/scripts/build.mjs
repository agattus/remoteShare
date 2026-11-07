import { build } from "esbuild";

await build({
  entryPoints: { main: "src/main.ts", preload: "src/preload.ts", "banner-preload": "src/bannerPreload.ts" },
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron", "@nut-tree-fork/nut-js"],
  sourcemap: false,
  logLevel: "info",
});
