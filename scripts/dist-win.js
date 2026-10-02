const { spawnSync } = require("child_process");
const path = require("path");

// electron-builder's node-module collector shells out through powershell.exe
const ps = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0";
const sys = "C:\\Windows\\System32";
process.env.Path = [ps, sys, process.env.Path || ""].join(path.delimiter);

const result = spawnSync(
  "npx",
  ["electron-builder", "--win", "--x64"],
  { stdio: "inherit", shell: true, env: process.env }
);

process.exit(result.status ?? 1);
