const { spawn } = require("node:child_process");
const path = require("node:path");

const bin = process.platform === "win32"
  ? process.execPath
  : path.join(__dirname, "..", "node_modules", ".bin", "electron-vite");
const cli = path.join(__dirname, "..", "node_modules", "electron-vite", "bin", "electron-vite.js");
const env = { ...process.env };
const args = process.platform === "win32" ? [cli, ...process.argv.slice(2)] : process.argv.slice(2);

delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(bin, args, {
  cwd: path.join(__dirname, ".."),
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
