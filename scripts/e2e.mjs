// End-to-end test: server + Electron host (under Xvfb) + browser viewer (Chrome via Playwright).
// Requires Linux with Xvfb, xdotool, xev and xclip, plus a Chrome/Chromium binary (CHROME_PATH).
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const PORT = 47841;
const DISPLAY = ":97";
const CHROME = process.env.CHROME_PATH ?? ["/usr/local/bin/google-chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => fs.existsSync(p));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "remotedesk-e2e-"));
const children = [];
const results = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hostEnv = { ...process.env, DISPLAY, HOME: path.join(tmp, "home"), RD_E2E: "1", ELECTRON_ENABLE_LOGGING: process.env.E2E_DEBUG ? "1" : "", RD_E2E_CONSENT_FILE: path.join(tmp, "consent"), RD_SERVER_URL: `http://localhost:${PORT}` };
fs.mkdirSync(path.join(hostEnv.HOME, "Downloads"), { recursive: true });
fs.writeFileSync(hostEnv.RD_E2E_CONSENT_FILE, "allow");

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  child.log = "";
  child.stdout.on("data", (d) => (child.log += d));
  child.stderr.on("data", (d) => (child.log += d));
  children.push(child);
  return child;
}

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`  FAIL  ${name}\n        ${err instanceof Error ? err.message : err}`);
  }
}

async function waitFor(fn, timeoutMs, what) {
  const start = Date.now();
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {
      /* retry */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await sleep(150);
  }
}

const x = (...args) => execFileSync(args[0], args.slice(1), { env: { ...process.env, DISPLAY }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const pointer = () => {
  const m = x("xdotool", "getmouselocation").match(/x:(\d+) y:(\d+)/);
  return { x: Number(m[1]), y: Number(m[2]) };
};

async function connectViewer(page, id, password) {
  await page.goto(`http://localhost:${PORT}/`);
  await page.locator("#device-id").fill(id);
  await page.locator("#device-password").fill(password);
  await page.getByRole("button", { name: "Connect" }).click();
}

try {
  console.log("Starting services…");
  run("Xvfb", [DISPLAY, "-screen", "0", "1280x800x24"]);
  await sleep(1000);
  run("node", [path.join(root, "packages/server/dist/index.mjs")], { env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(tmp, "data"), VIEWER_DIR: path.join(root, "packages/viewer/dist"), LOG_LEVEL: "warn", CONSENT_TIMEOUT_MS: "4000" } });
  await waitFor(async () => (await fetch(`http://localhost:${PORT}/api/health`)).ok, 10_000, "server");

  const electron = require(path.join(root, "node_modules/electron"));
  const host = run(electron, [path.join(root, "packages/desktop"), "--no-sandbox", "--disable-gpu", `--user-data-dir=${path.join(tmp, "host")}`], { env: hostEnv });
  const configFile = path.join(tmp, "host/config.json");
  const config = await waitFor(() => {
    const c = JSON.parse(fs.readFileSync(configFile, "utf8"));
    return c.deviceId ? c : null;
  }, 20_000, "host registration");
  await waitFor(async () => (await (await fetch(`http://localhost:${PORT}/api/health`)).json()).hosts === 1, 10_000, "host online");
  console.log(`Host online as ${config.deviceId}`);

  const xev = run("xev", ["-geometry", "400x300+0+0"], { env: { ...process.env, DISPLAY } });
  await sleep(800);
  const xevWindow = x("xdotool", "search", "--name", "Event Tester").trim().split("\n")[0];
  x("xdotool", "windowfocus", xevWindow);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--use-fake-ui-for-media-stream"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("  [page error]", e.message));
  if (process.env.E2E_DEBUG) page.on("console", (m) => console.log("  [page]", m.text()));

  console.log("Authentication and consent");
  await check("wrong password is rejected", async () => {
    await connectViewer(page, config.deviceId, "definitely-wrong");
    await page.getByRole("alert").filter({ hasText: "Incorrect password" }).waitFor({ timeout: 8000 });
  });

  await check("unknown device ID reports offline", async () => {
    await connectViewer(page, "999999999", "whatever1");
    await page.getByRole("alert").filter({ hasText: "offline" }).waitFor({ timeout: 8000 });
  });

  await check("denied consent is reported to the viewer", async () => {
    fs.writeFileSync(hostEnv.RD_E2E_CONSENT_FILE, "deny");
    await connectViewer(page, config.deviceId, config.password);
    await page.getByRole("alert").filter({ hasText: "declined" }).waitFor({ timeout: 10_000 });
  });

  await check("consent timeout is reported to the viewer", async () => {
    // Simulate a host that never answers by using a second, silent host registration.
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    await new Promise((r) => (ws.onopen = r));
    ws.send(JSON.stringify({ type: "host-register", password: "silenthost1" }));
    const reg = await new Promise((r) => (ws.onmessage = (e) => r(JSON.parse(e.data))));
    await connectViewer(page, reg.deviceId, "silenthost1");
    await page.getByRole("alert").filter({ hasText: "in time" }).waitFor({ timeout: 12_000 });
    ws.close();
  });

  console.log("Remote session");
  fs.writeFileSync(hostEnv.RD_E2E_CONSENT_FILE, "allow");
  await connectViewer(page, config.deviceId, config.password);

  await check("video stream arrives from the host", async () => {
    await waitFor(() => page.evaluate(() => {
      const v = document.querySelector("video");
      return v && v.videoWidth > 0 && !v.paused;
    }), 20_000, "video playback");
    const size = await page.evaluate(() => ({ w: document.querySelector("video").videoWidth, h: document.querySelector("video").videoHeight }));
    if (size.w < 640) throw new Error(`unexpected video size ${size.w}x${size.h}`);
    await page.screenshot({ path: path.join(root, ".e2e/viewer-session.png") });
  });

  const rect = await page.evaluate(() => {
    const v = document.querySelector("video");
    const b = v.getBoundingClientRect();
    const scale = Math.min(b.width / v.videoWidth, b.height / v.videoHeight);
    const w = v.videoWidth * scale;
    const h = v.videoHeight * scale;
    return { left: b.left + (b.width - w) / 2, top: b.top + (b.height - h) / 2, w, h, vw: v.videoWidth, vh: v.videoHeight };
  }).catch(() => null);
  const toPage = (hx, hy) => ({ x: rect.left + (hx / (rect.vw - 1)) * rect.w, y: rect.top + (hy / (rect.vh - 1)) * rect.h });

  await check("mouse movement controls the host pointer", async () => {
    for (const [hx, hy] of [[900, 500], [200, 120], [640, 700]]) {
      const p = toPage(hx, hy);
      await page.mouse.move(p.x, p.y, { steps: 3 });
      await waitFor(() => {
        const got = pointer();
        return Math.abs(got.x - hx) <= 6 && Math.abs(got.y - hy) <= 6;
      }, 4000, `pointer near ${hx},${hy} (got ${JSON.stringify(pointer())})`);
    }
  });

  await check("clicks, scrolling and typing reach the host", async () => {
    const p = toPage(150, 150);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.mouse.click(p.x, p.y);
    await page.mouse.click(p.x, p.y, { button: "right" });
    await page.mouse.wheel(0, 200);
    await sleep(300);
    await page.keyboard.type("q");
    await page.keyboard.press("Enter");
    await sleep(800);
    const log = xev.log;
    if (!/ButtonPress[\s\S]*?button 1,/.test(log)) throw new Error("no left click seen by host app");
    if (!/ButtonPress[\s\S]*?button 3,/.test(log)) throw new Error("no right click seen by host app");
    if (!/button 5,/.test(log)) throw new Error("no scroll seen by host app");
    if (!/KeyPress[\s\S]*?keysym 0x71, q/.test(log)) throw new Error(`typed key was not received by host app; xev tail:\n${log.split("\n").filter((l) => /Key|Focus|Enter|Leave/.test(l)).slice(-12).join("\n")}`);
  });

  await check("clipboard is shared in both directions", async () => {
    await page.evaluate(() => navigator.clipboard.writeText("hello from viewer"));
    await page.getByRole("button", { name: "Clipboard and files" }).click();
    await page.getByRole("menuitem", { name: "Send my clipboard" }).click();
    await waitFor(() => x("xclip", "-o", "-selection", "clipboard").trim() === "hello from viewer", 5000, "host clipboard");
    execFileSync("sh", ["-c", "printf 'from the host' | xclip -i -selection clipboard"], { env: { ...process.env, DISPLAY }, stdio: "ignore" });
    await page.getByRole("button", { name: "Clipboard and files" }).click();
    await page.getByRole("menuitem", { name: "Get remote clipboard" }).click();
    await waitFor(async () => (await page.evaluate(() => navigator.clipboard.readText())) === "from the host", 6000, "viewer clipboard");
  });

  await check("files can be sent to the host", async () => {
    const payload = Buffer.alloc(300_000, "abc123");
    const file = path.join(tmp, "sample-upload.bin");
    fs.writeFileSync(file, payload);
    await page.locator('input[type="file"]').setInputFiles(file);
    const saved = path.join(hostEnv.HOME, "Downloads/RemoteDesk/sample-upload.bin");
    await waitFor(() => fs.existsSync(saved) && fs.statSync(saved).size === payload.length, 10_000, "saved file").catch(async (e) => { const toast = await page.locator("[data-sonner-toast]").allInnerTexts(); throw new Error(`${e.message}; toasts: ${JSON.stringify(toast)}; host log: ${host.log.split("\n").filter((l) => !/bus.cc|object_proxy/.test(l)).slice(-1).join(" | ")}; found: ${execFileSync("find", [tmp, "-name", "sample-upload*"], { encoding: "utf8" }).trim().split("\n").join(",")}`); });
    if (!fs.readFileSync(saved).equals(payload)) throw new Error("file content mismatch");
  });

  await check("a second viewer is refused while a session is active", async () => {
    const other = await context.newPage();
    await connectViewer(other, config.deviceId, config.password);
    await other.getByRole("alert").filter({ hasText: "already has a remote session" }).waitFor({ timeout: 8000 });
    await other.close();
  });

  await check("disconnect ends the session on both sides", async () => {
    await page.getByRole("button", { name: "Disconnect" }).click();
    await page.getByRole("button", { name: "Connect" }).waitFor({ timeout: 8000 });
    await waitFor(async () => (await (await fetch(`http://localhost:${PORT}/api/health`)).json()).sessions === 0, 5000, "server session cleanup");
  });

  await check("host can end the session from its always-visible banner", async () => {
    await connectViewer(page, config.deviceId, config.password);
    await waitFor(() => page.evaluate(() => document.querySelector("video")?.videoWidth > 0), 20_000, "second session video");
    await sleep(1500);
    // The banner is 460x46 centered at the top of the 1280px wide host screen; Disconnect sits at its right edge.
    x("xdotool", "mousemove", "810", "31", "click", "1");
    await page.getByRole("alert").or(page.getByText("The remote device ended the session.")).first().waitFor({ timeout: 8000 });
  });

  await browser.close();
  void host;
} catch (err) {
  console.error("E2E aborted:", err);
  results.push({ name: "e2e harness", ok: false });
} finally {
  for (const c of children.reverse()) c.kill("SIGKILL");
  fs.rmSync(tmp, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
