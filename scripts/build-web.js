const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");
const { copyStatic } = require("./copy-static");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "dist", "web");

async function build() {
  copyStatic(outDir, { entryScript: "app.js" });

  await esbuild.build({
    entryPoints: [path.join(root, "src", "web", "bootstrap.ts")],
    bundle: true,
    outfile: path.join(outDir, "app.js"),
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    sourcemap: true,
    loader: { ".ts": "ts" },
    // Neurosity SDK is large; keep names readable enough for debugging.
    logLevel: "info"
  });

  fs.writeFileSync(
    path.join(outDir, "_headers"),
    `/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
`
  );

  fs.writeFileSync(
    path.join(outDir, "_redirects"),
    `/*    /index.html   200
`
  );

  console.log(`Web build → ${outDir}`);

  if (process.argv.includes("--skip-exe"))
    return;

  const { packageWin } = require("./maybe-dist-win");
  packageWin();
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
