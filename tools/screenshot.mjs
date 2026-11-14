// Screenshots of a page in headless Firefox over WebDriver BiDi: no npm
// dependencies, only Node >= 22 and Firefox. Development tool, not served to
// readers (not in sw.js PRECACHE).
//
//   W=1366 H=900 node tools/screenshot.mjs URL OUT [STEPS]
//
// Writes OUT-start.png after load, then for each [name, js] in STEPS (JSON)
// runs js in the page and writes OUT-name.png. The interface language lives in
// localStorage, so set it and reload:
//   '[["set","localStorage.setItem(\"scrollia-lang\",\"es\");location.reload()"],["es","1"]]'
// FULL=1 captures the whole document instead of the viewport. LANGS="it, en"
// sets the browser's preferred languages (navigator.languages).
import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2];
const out = process.argv[3] ?? join(tmpdir(), "scrollia-shot");
const port = Number(process.env.PORT ?? 9472);
const profile = join(tmpdir(), "scrollia-shot-profile");
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile);
if (process.env.LANGS) {
  writeFileSync(join(profile, "user.js"), `user_pref("intl.accept_languages", ${JSON.stringify(process.env.LANGS)});\n`);
}
const ff = spawn("firefox", ["--headless", "--no-remote", "--profile", profile, "--remote-debugging-port", String(port)],
  { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  try {
    ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    break;
  } catch { ws = null; }
}
if (!ws) { ff.kill(); throw new Error("Firefox did not open a BiDi session"); }

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params) => new Promise((res) => {
  const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params }));
});

try {
  await send("session.new", { capabilities: {} });
  const context = (await send("browsingContext.create", { type: "tab" })).result.context;
  await send("browsingContext.setViewport", {
    context, viewport: { width: Number(process.env.W ?? 412), height: Number(process.env.H ?? 900) }, devicePixelRatio: 1,
  });
  await send("browsingContext.navigate", { context, url, wait: "complete" });
  const evaluate = (expr) => send("script.evaluate", { target: { context }, expression: expr, awaitPromise: true, resultOwnership: "none" });
  const shot = async (name) => {
    const r = await send("browsingContext.captureScreenshot", { context, origin: process.env.FULL ? "document" : "viewport" });
    writeFileSync(`${out}-${name}.png`, Buffer.from(r.result.data, "base64"));
    console.log(`${out}-${name}.png`);
  };
  await sleep(5000);
  await shot("start");
  for (const [name, expr] of JSON.parse(process.argv[4] ?? "[]")) {
    await evaluate(expr);
    await sleep(2500);
    await shot(name);
  }
} finally {
  ws.close();
  ff.kill();
}
