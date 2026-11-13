#!/usr/bin/env node
if (process.argv[2] === '--help' || process.argv[2] === '-h') {
  console.log('Usage: node scripts/load-test.mjs <https://site> [concurrency] [/api/ping]');
  console.log('Default concurrency: 300');
  process.exit(0);
}
const base = String(process.argv[2] || '').replace(/\/$/, '');
const total = Math.max(1, Number(process.argv[3] || 300));
const path = process.argv[4] || '/api/ping';
if (!base) { console.error('Usage: node scripts/load-test.mjs <https://site> [concurrency] [/api/ping]'); process.exit(2); }
const target = base + path;
let ok = 0, failed = 0, totalMs = 0, maxMs = 0;
const worker = async () => {
  const started = performance.now();
  try {
    const r = await fetch(target, { headers: { 'cache-control':'no-store' } });
    const ms = performance.now() - started;
    totalMs += ms; maxMs = Math.max(maxMs, ms);
    if (r.ok) ok++; else failed++;
  } catch {
    failed++;
  }
};
await Promise.all(Array.from({length: total}, () => worker()));
console.log(JSON.stringify({target, requests: total, ok, failed, successRate: +(ok/total*100).toFixed(2), avgMs: +(totalMs/total).toFixed(1), maxMs:+maxMs.toFixed(1)}, null, 2));
if (failed) process.exitCode=1;
