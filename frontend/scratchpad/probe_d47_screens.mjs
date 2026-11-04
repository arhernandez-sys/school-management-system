/**
 * D47 — render the REAL screens against the demo MSW layer in headless Chrome (DevTools
 * protocol, no puppeteer) and prove they consume the new wire shapes: no error boundary,
 * no uncaught exception, and the marking-window states visible where the seed put them.
 *
 * Needs the demo server: npx vite --mode demo --port 5191 --strictPort
 * Usage: node scratchpad/probe_d47_screens.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const BASE = 'http://localhost:5191';
const PORT = 9334;
const profile = mkdtempSync(path.join(tmpdir(), 'sis-cdp-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--no-first-run', '--window-size=1280,900', 'about:blank']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (l, c, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? `  — ${x}` : ''}`); if (!c) failures++; };

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { await sleep(200); }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  const exceptions = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const waitFor = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await evaluate(expr)) return true; await sleep(250); } return false; };
  const goto = async (url) => { await send('Page.navigate', { url }); await sleep(600); };
  const text = () => evaluate('document.body.innerText');
  const healthy = async (label) => {
    const t = await text();
    check(`${label}: no error state`, !/Something went wrong/.test(t ?? ''), (t ?? '').slice(0, 160).replace(/\s+/g, ' '));
  };
  const as = async (role) => {
    await goto(`${BASE}/login`);
    await evaluate(`document.cookie = 'sis_mock_session=${role}; path=/'`);
  };

  await send('Page.enable'); await send('Runtime.enable');

  // ── Lecturer: the offering's assessment list ─────────────────────────────────
  await as('teacher');
  await goto(`${BASE}/grades?offering_id=off-1`);
  check('lecturer assessment list shows the seeded columns', await waitFor(`document.body.innerText.includes('Lab Practical') && document.body.innerText.includes('Reading Response')`));
  const list = await text();
  check('list shows a Locked badge', /Locked/.test(list));
  check('list shows "closes today" and "Reopened"', /closes today/i.test(list) && /Reopened/.test(list));
  await healthy('assessment list');

  // ── Lecturer: grading screen on the LOCKED assessment ────────────────────────
  await goto(`${BASE}/grades/assessment/asmt-lec-1?offering_id=off-1`);
  check('locked grading screen offers "Ask the Dean to reopen"', await waitFor(`document.body.innerText.includes('Ask the Dean to reopen')`));
  await healthy('locked grading screen');
  await goto(`${BASE}/grades/assessment/asmt-lec-2?offering_id=off-1`);
  await waitFor(`document.body.innerText.includes('Problem Set 2')`);
  const ps2 = await text();
  check('pending-request grading screen does NOT offer a second ask', !ps2.includes('Ask the Dean to reopen'), ps2.slice(0, 300).replace(/\s+/g, ' '));
  await healthy('pending grading screen');
  await goto(`${BASE}/grades/assessment/asmt-lec-4?offering_id=off-1`);
  check('open grading screen says marking is open', await waitFor(`/Marking is open/.test(document.body.innerText)`));

  // ── Lecturer dashboard ────────────────────────────────────────────────────────
  await goto(`${BASE}/dashboard`);
  check('lecturer dashboard lists an open assessment', await waitFor(`document.body.innerText.includes('Quiz 3')`));
  await healthy('lecturer dashboard');

  // ── Dean: reopen queue + bell ────────────────────────────────────────────────
  await as('principal');
  await goto(`${BASE}/grades/reopen-requests`);
  check('Dean reopen queue lists Problem Set 2', await waitFor(`document.body.innerText.includes('Problem Set 2')`));
  await healthy('reopen queue');
  await goto(`${BASE}/dashboard`);
  await waitFor(`document.body.innerText.length > 200`);
  await healthy('Dean dashboard');

  // ── Student: My Grades + dashboard ───────────────────────────────────────────
  await as('student');
  await goto(`${BASE}/grades`);
  check('student My Grades renders a course', await waitFor(`document.body.innerText.includes('MATH1110')`));
  await healthy('My Grades');
  await goto(`${BASE}/dashboard`);
  await waitFor(`document.body.innerText.length > 200`);
  await healthy('student dashboard');

  check('no uncaught exceptions on any page', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));
  ws.close();
} finally {
  chrome.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
