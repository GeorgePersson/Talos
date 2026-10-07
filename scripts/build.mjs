import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/main.ts", "src/preload.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  sourcemap: true,
});
await build({
  entryPoints: ["src/renderer.ts"],
  outdir: "dist",
  bundle: true,
  platform: "browser",
  target: "chrome144",
  sourcemap: true,
});
await Promise.all(
  ["index.html", "styles.css", "qa-styles.css", "compact.css"].map((file) =>
    copyFile(`src/${file}`, `dist/${file}`),
  ),
);
await copyFile("assets/icon.png", "dist/icon.png");
