import { build } from "esbuild";
import { rmSync, mkdirSync } from "fs";

// Clean and recreate dist/
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

// Build with config
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/musicbox-player.js",
  banner: {
    js: "#!/usr/bin/env node",
  },
  sourcemap: true,
  minify: false, // Keep readable for debugging
  logLevel: "info",
});

console.log("✅ Bundle created: dist/musicbox-player.js");
