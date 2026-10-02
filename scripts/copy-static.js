const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

function copyStatic(outDir, { entryScript = "renderer.js", includeIcon = true } = {}) {
  const vendorDir = path.join(outDir, "vendor");
  const texOut = path.join(outDir, "textures", "sand");

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(vendorDir, { recursive: true });
  fs.mkdirSync(texOut, { recursive: true });

  let html = fs.readFileSync(path.join(root, "src", "index.html"), "utf8");
  html = html.replace(
    /src="\.\/renderer\.js"/,
    `src="./${entryScript}"`
  );
  fs.writeFileSync(path.join(outDir, "index.html"), html);

  fs.copyFileSync(
    path.join(root, "src", "styles.css"),
    path.join(outDir, "styles.css")
  );

  if (includeIcon) {
    const icon = path.join(root, "assets", "kabaragoya.png");
    if (fs.existsSync(icon))
      fs.copyFileSync(icon, path.join(outDir, "kabaragoya.png"));
  }

  const uplotJs = path.join(root, "node_modules", "uplot", "dist", "uPlot.iife.min.js");
  const uplotCss = path.join(root, "node_modules", "uplot", "dist", "uPlot.min.css");
  fs.copyFileSync(uplotJs, path.join(vendorDir, "uPlot.iife.min.js"));
  fs.copyFileSync(uplotCss, path.join(vendorDir, "uPlot.min.css"));

  const sandSrc = path.join(root, "assets", "textures", "sand");
  for (const name of ["sand_diff.jpg", "sand_nor.jpg", "sand_rough.jpg"]) {
    const src = path.join(sandSrc, name);
    if (fs.existsSync(src))
      fs.copyFileSync(src, path.join(texOut, name));
  }
}

module.exports = { copyStatic };

if (require.main === module) {
  copyStatic(path.join(root, "dist", "renderer"), { entryScript: "renderer.js" });
}
