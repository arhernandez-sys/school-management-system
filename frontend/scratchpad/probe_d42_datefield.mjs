/**
 * D42 §6 — prove the date controls actually RENDER dd/mm/yyyy.
 *
 * A green `tsc` says nothing about the displayed format: `adapterLocale`, the `format`
 * prop and the strict wire parse are all runtime behaviour, and getting any one of them
 * wrong still typechecks. So render the real components through the real
 * `LocalizationProvider` and read the value out of the emitted markup.
 *
 * Also pins the two things a reader would otherwise have to take on trust:
 *  - a `YYYY-MM-DD` wire value renders day-first, not month-first;
 *  - a malformed wire value renders EMPTY rather than as a confidently wrong date.
 */
import { build } from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/*
 * The smallest `document` emotion's `createCache` needs.
 *
 * We render the BROWSER bundle (see the `platform` note below), and emotion's browser
 * build inserts its <style> tags into `document.head` at cache-construction time. Node has
 * no DOM and this repo has no jsdom. Nothing under test reads any of it — the assertions
 * are all about the <input value>, and the style sheet is discarded — so a stub that lets
 * `createCache` complete is enough, and is considerably less machinery than a real DOM.
 */
const stubNode = () => ({
  setAttribute() {},
  appendChild() {},
  insertBefore() {},
  removeChild() {},
  cloneNode: stubNode,
  sheet: { insertRule() {}, cssRules: [] },
  style: {},
  nodeType: 1,
  tagName: 'STYLE',
});
globalThis.document = {
  head: stubNode(),
  body: stubNode(),
  createElement: stubNode,
  createTextNode: () => ({}),
  querySelectorAll: () => [],
  querySelector: () => null,
};

const FE = String.raw`C:\Users\arhernandez\source\repos\school-management-system\frontend`;
// ESM, not CJS. Bundled to CJS, esbuild's interop hands `@mui/material/useMediaQuery`
// back as a namespace object rather than the function MUI X calls — an artifact of the
// bundle format, not of the app, which Vite never produces. ESM output sidesteps it.
const out = path.join(FE, 'scratchpad', `.datefield-probe-${process.pid}.mjs`);

await build({
  stdin: {
    contents: `
      export { DateField, DateTimeField } from '@shared/components/DateField';
      export { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
      export { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
      import 'dayjs/locale/en-gb';
      // The BROWSER server build: react-dom/server pulls in node's stream module through
      // a CJS require, which esbuild's ESM output cannot satisfy. Same renderer, no builtins.
      export { renderToStaticMarkup } from 'react-dom/server.browser';
      export { default as React } from 'react';
      // Emotion's BROWSER build reads its cache from a context normally populated by a
      // DOM-side auto-initialisation. Rendering to static markup has no DOM, so the cache
      // is supplied explicitly - emotion's documented SSR setup, not a workaround for
      // anything in the app.
      export { CacheProvider } from '@emotion/react';
      export { default as createEmotionCache } from '@emotion/cache';
    `,
    resolveDir: FE,
    loader: 'ts',
  },
  bundle: true,
  // `platform: 'browser'` — under `'node'` esbuild takes each package's CJS `main`, and
  // `@mui/material/useMediaQuery`'s CJS shape comes back as a namespace where MUI X calls
  // a function. The app is a browser bundle; resolving it the way Vite does is both more
  // faithful and the thing that works.
  platform: 'browser',
  format: 'esm',
  outfile: out,
  logLevel: 'error',
  jsx: 'automatic',
  alias: {
    '@shared': path.join(FE, 'src/shared'),
    '@features': path.join(FE, 'src/features'),
    '@app': path.join(FE, 'src/app'),
    '@i18n': path.join(FE, 'src/i18n'),
  },
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env.VITE_API_BASE_URL': '"/api/v1"',
  },
});

const m = await import(pathToFileURL(out).href);
const {
  DateField,
  DateTimeField,
  LocalizationProvider,
  AdapterDayjs,
  renderToStaticMarkup,
  React,
  CacheProvider,
  createEmotionCache,
} = m;
const emotionCache = createEmotionCache({ key: 'probe' });

const fails = [];
function check(label, cond, detail) {
  if (!cond) fails.push(label);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

/** Render one field inside the app's real LocalizationProvider and return its markup. */
function render(node) {
  return renderToStaticMarkup(
    React.createElement(
      CacheProvider,
      { value: emotionCache },
      React.createElement(
        LocalizationProvider,
        { dateAdapter: AdapterDayjs, adapterLocale: 'en-gb' },
        node,
      ),
    ),
  );
}

/** The `value="..."` of the single <input> in the markup. */
function inputValue(html) {
  const m = /<input[^>]*\bvalue="([^"]*)"/.exec(html);
  return m ? m[1] : null;
}

// ── 1. A wire date renders DAY-FIRST ──────────────────────────────────────────
// 14 March 2004: unambiguous, because 14 cannot be a month. A month-first render would
// be "03/14/2004" and the day/month halves are visibly swapped.
{
  const html = render(
    React.createElement(DateField, {
      label: 'Date of birth',
      value: '2004-03-14',
      onChange: () => {},
    }),
  );
  const v = inputValue(html);
  check('DateField renders 2004-03-14 as 14/03/2004', v === '14/03/2004', `got ${JSON.stringify(v)}`);
  check(
    'DateField placeholder advertises dd/mm/yyyy',
    /placeholder="dd\/mm\/yyyy"/.test(html),
    html.includes('placeholder') ? undefined : 'no placeholder attribute at all',
  );
}

// ── 2. An empty value renders empty, not "Invalid Date" ───────────────────────
{
  const v = inputValue(
    render(React.createElement(DateField, { label: 'Empty', value: '', onChange: () => {} })),
  );
  check('DateField renders an empty value as empty', v === '', `got ${JSON.stringify(v)}`);
}

// ── 3. A malformed wire value renders EMPTY, never a guessed date ─────────────
// This is what the strict `customParseFormat` parse buys. Without the plugin registered,
// dayjs ignores the format argument and its loose parser accepts "14/03/2004" here —
// silently rendering a value that is not in the wire format the API sends.
{
  const v = inputValue(
    render(
      React.createElement(DateField, { label: 'Bad', value: '14/03/2004', onChange: () => {} }),
    ),
  );
  check(
    'DateField rejects a non-wire value instead of guessing',
    v === '',
    `got ${JSON.stringify(v)} — strict parse is not in effect`,
  );
}

// ── 4. DateTimeField renders dd/mm/yyyy HH:mm on a 24h clock ──────────────────
// The instant is rendered in the RUNNER's local timezone by design (a Dean reads their own
// wall clock), so assert the SHAPE and the date part rather than a fixed string.
{
  const html = render(
    React.createElement(DateTimeField, {
      label: 'Freeze starts',
      value: '2026-03-14T17:30:00.000Z',
      onChange: () => {},
    }),
  );
  const v = inputValue(html);
  check(
    'DateTimeField renders dd/mm/yyyy HH:mm',
    /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(v ?? ''),
    `got ${JSON.stringify(v)}`,
  );
  check(
    'DateTimeField is 24-hour (no AM/PM)',
    !/\b(AM|PM)\b/i.test(v ?? ''),
    `got ${JSON.stringify(v)}`,
  );
  // 17:30Z on the 14th is still the 14th anywhere from UTC-17 to UTC+6, which covers
  // every real timezone this app runs in (Belize is UTC-6).
  check('DateTimeField keeps the day-first order', (v ?? '').startsWith('14/03/2026'), `got ${v}`);
}

// ── 5. The empty datetime is empty too ────────────────────────────────────────
{
  const v = inputValue(
    render(React.createElement(DateTimeField, { label: 'Empty', value: '', onChange: () => {} })),
  );
  check('DateTimeField renders an empty value as empty', v === '', `got ${JSON.stringify(v)}`);
}

console.log(fails.length === 0 ? '\nALL PASS' : `\n${fails.length} FAILED: ${fails.join(' | ')}`);
process.exitCode = fails.length === 0 ? 0 : 1;
