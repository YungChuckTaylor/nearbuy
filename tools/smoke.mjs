// Headless smoke test: boots the PWA in jsdom against the live server and walks routes.
import { JSDOM, VirtualConsole } from 'jsdom';

const BASE = 'http://localhost:3000';
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { if (!/Not implemented/.test(e.message)) errors.push('jsdomError: ' + e.message); });
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(`<!doctype html><html><body><div id="splash"></div><div id="app" hidden></div></body></html>`, {
  url: BASE + '/#/home',
  pretendToBeVisual: true,
  virtualConsole: vc,
  runScripts: 'outside-only',
});
const { window } = dom;
window.localStorage.setItem('nbg_onboarded', '1');
if (process.env.LOGIN) {
  const res = await fetch(BASE + '/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: process.env.LOGIN, password: 'demo1234' }) });
  const { token } = await res.json();
  window.localStorage.setItem('nbg_token', token);
  console.log('logged in as', process.env.LOGIN);
}

// wire globals
global.window = window;
global.document = window.document;
global.localStorage = window.localStorage;
global.location = window.location;
global.history = window.history;
if (!global.navigator) global.navigator = window.navigator;
global.HTMLElement = window.HTMLElement;
global.Node = window.Node;
global.Image = window.Image;
global.canvasStub = true;
const realFetch = global.fetch;
global.fetch = (input, init) => realFetch(new URL(input, BASE), init);
window.fetch = global.fetch;
process.on('unhandledRejection', (r) => errors.push('unhandledRejection: ' + (r?.stack || r)));
window.addEventListener('error', (e) => errors.push('windowError: ' + e.message));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await import('../public/js/app.js');
await sleep(1200);

const view = () => document.getElementById('view');
const report = [];
async function visit(hash, expect) {
  window.location.hash = hash;
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(900);
  const v = view();
  const len = v ? v.innerHTML.length : 0;
  const ok = len > (expect || 200);
  report.push(`${ok ? 'PASS' : 'FAIL'} ${hash} → ${len} bytes of UI`);
}

report.push(`shell: topbar=${!!document.querySelector('.topbar')} bottomnav=${!!document.querySelector('.bottomnav')} view=${!!view()}`);
await visit('#/home', 500);
await visit('#/search?q=rice', 500);
await visit('#/upload', 300);
await visit('#/product/p1', 800);
await visit('#/store/s1', 800);
await visit('#/saved', 200);
await visit('#/alerts', 200);
await visit('#/profile', 800);
await visit('#/premium', process.env.LOGIN ? 400 : 200); // guests correctly see the login gate
await visit('#/business', 200);
await visit('#/admin', 200);
await visit('#/auth', 400);

console.log(report.join('\n'));
if (errors.length) { console.log('\nERRORS:'); console.log([...new Set(errors)].slice(0, 12).join('\n---\n')); process.exit(1); }
console.log('\nNo runtime errors detected.');
process.exit(0);
