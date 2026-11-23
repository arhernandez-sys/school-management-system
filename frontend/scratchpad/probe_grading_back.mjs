/**
 * Drive the real demo app in headless Chrome (DevTools protocol, no puppeteer): as the
 * lecturer, open an offering's assessment list, click an assessment's "Grade" button,
 * then click Back. Back must land on THAT offering's assessment list, not the grid.
 *
 * Needs the demo server: npx vite --mode demo --port 5191 --strictPort
 * Usage: node scratchpad/probe_grading_back.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const BASE = 'http://localhost:5191';
const PORT = 9333;
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
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const waitFor = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await evaluate(expr)) return true; await sleep(250); } return false; };
  const goto = async (url) => { await send('Page.navigate', { url }); await sleep(500); };

  await send('Page.enable'); await send('Runtime.enable');
  await goto(`${BASE}/login`);
  await evaluate(`document.cookie = 'sis_mock_session=teacher; path=/'`);

  // The lecturer's first offering card on Grades.
  await goto(`${BASE}/grades`);
  const ok = await waitFor(`!!document.querySelector('a[href*="offering_id="], button') && document.body.innerText.includes('MATH')`);
  check('Grades page loaded as lecturer', ok, (await evaluate('location.href')));
  // Open the drill-down directly the way a card click does (sets ?offering_id=).
  await goto(`${BASE}/grades?offering_id=off-1`);
  check('assessment list for off-1 shows', await waitFor(`document.body.innerText.includes('New assessment')`));
  const listUrl = await evaluate('location.href');

  // Click the first "Grade" row action.
  const clicked = await evaluate(`(() => { const b = document.querySelector('button[aria-label^="Grade "]'); if (!b) return false; b.click(); return true; })()`);
  check('clicked an assessment', clicked);
  await waitFor(`location.pathname.startsWith('/grades/assessment/')`);
  const gradeUrl = await evaluate('location.href');
  check('on the grading page with offering_id', gradeUrl.includes('/grades/assessment/') && gradeUrl.includes('offering_id=off-1'), gradeUrl);
  const label = await evaluate(`[...document.querySelectorAll('button')].map((b) => b.innerText.trim()).find((t) => /assessments|offerings/i.test(t))`);
  check('Back button reads "Back to assessments"', label === 'Back to assessments', String(label));

  await evaluate(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Back to assessments').click()`);
  await waitFor(`location.pathname === '/grades'`);
  await waitFor(`document.body.innerText.includes('New assessment')`, 8000);
  const backUrl = await evaluate('location.href');
  const onList = await evaluate(`document.body.innerText.includes('New assessment') && document.body.innerText.includes('All offerings')`);
  check('Back lands on the SAME offering’s assessment list', onList && backUrl.includes('offering_id=off-1'), backUrl);
  console.log(`  list ${listUrl}\n  back ${backUrl}`);
  ws.close();
} finally {
  chrome.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked */ }
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
