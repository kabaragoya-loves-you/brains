const { spawnSync } = require("child_process");
const path = require("path");

function shouldPackageWin() {
  if (process.env.CF_PAGES || process.env.CI)
    return false;
  if (process.env.BRAINS_SKIP_EXE === "1")
    return false;
  if (process.platform !== "win32")
    return false;
  return true;
}

function packageWin() {
  if (!shouldPackageWin()) {
    console.log("Skipping Windows exe packaging (CI/non-Windows/BRAINS_SKIP_EXE).");
    return;
  }

  console.log("Rebuilding Windows x64 executable…");
  const build = spawnSync("npm", ["run", "build"], {
    stdio: "inherit",
    shell: true,
    env: process.env
  });
  if (build.status)
    process.exit(build.status);

  const dist = spawnSync("node", [path.join(__dirname, "dist-win.js")], {
    stdio: "inherit",
    shell: true,
    env: process.env
  });
  process.exit(dist.status ?? 1);
}

module.exports = { shouldPackageWin, packageWin };

if (require.main === module)
  packageWin();
