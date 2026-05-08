const { spawn } = require("node:child_process");
const path = require("node:path");

const command = process.platform === "win32" ? "electron-vite.cmd" : "electron-vite";
const bin = path.join(__dirname, "..", "node_modules", ".bin", command);
const env = { ...process.env };

delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(bin, process.argv.slice(2), {
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
