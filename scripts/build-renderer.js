const esbuild = require("esbuild");
const path = require("path");

const root = path.join(__dirname, "..");

esbuild
  .build({
    entryPoints: [path.join(root, "src", "renderer.ts")],
    bundle: true,
    outfile: path.join(root, "dist", "renderer", "renderer.js"),
    format: "esm",
    platform: "browser",
    target: ["chrome120"],
    sourcemap: true,
    external: [],
    loader: { ".ts": "ts" }
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
