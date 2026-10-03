// Copies the newest android/*.apk into the marketing site so the download CTA
// works everywhere, including serverless (Vercel bundles only the repo, and the
// function reads the site folder — not android/ — from disk).
// Run after every native release: npm run site:apk
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'android');
const to = path.join(root, 'website', 'download', 'nearbuygoods.apk');

const newest = fs.readdirSync(from).filter((f) => f.toLowerCase().endsWith('.apk')).sort().pop();
if (!newest) { console.error(`no .apk found in ${from}`); process.exit(1); }

const src = path.join(from, newest);
fs.mkdirSync(path.dirname(to), { recursive: true });
fs.copyFileSync(src, to);
const mb = (fs.statSync(to).size / 1024).toFixed(0);
console.log(`site APK ← android/${newest} (${mb} KB)`);
