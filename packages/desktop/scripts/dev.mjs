import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
await import("./build.mjs");

const electronPath = require("electron");
const args = ["."];
if (process.platform === "linux" && process.getuid?.() === 0) args.push("--no-sandbox");

const child = spawn(electronPath, args, {
  stdio: "inherit",
  env: { ...process.env, VIEWER_URL: process.env.VIEWER_URL ?? "http://localhost:47832" },
});
child.on("exit", (code) => process.exit(code ?? 0));
