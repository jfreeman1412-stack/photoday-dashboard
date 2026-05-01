#!/usr/bin/env node
/**
 * clear-shipstation-product-weights.js
 *
 * One-shot utility to clear the Weight field on every product in ShipStation.
 * V1 API has no DELETE for products, but we can update them — setting weight to 0
 * stops ShipStation from overriding the per-line-item weights we send on createorder.
 *
 * Run from your sportsline-dashboard project root:
 *   node clear-shipstation-product-weights.js           # dry run, prints what would change
 *   node clear-shipstation-product-weights.js --apply   # actually update
 *
 * Reads ShipStation credentials the same way shipstationService.js does —
 * via require('./server/config'). If your config path is different, adjust below.
 */

const path = require('path');

// Adjust this require path if needed (run from project root)
const config = require(path.resolve(process.cwd(), 'server/config'));

const APPLY = process.argv.includes('--apply');
const PAGE_SIZE = 500;
const REQUEST_GAP_MS = 1600; // ~37 req/min, safely under the 40/min ShipStation limit

const authString = Buffer.from(
  `${config.shipstation.apiKey}:${config.shipstation.apiSecret}`
).toString('base64');

const baseUrl = config.shipstation.baseUrl || 'https://ssapi.shipstation.com';

async function ssRequest(method, endpoint, body = null) {
  const https = require('https');
  const url = new URL(`${baseUrl}${endpoint}`);
  const jsonBody = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Basic ${authString}`,
        'Content-Type': 'application/json',
        ...(jsonBody && { 'Content-Length': Buffer.byteLength(jsonBody) }),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 429) {
          const retryAfter = parseInt(res.headers['retry-after'] || '30', 10);
          console.warn(`  Rate limited. Waiting ${retryAfter}s...`);
          setTimeout(() => ssRequest(method, endpoint, body).then(resolve).catch(reject), retryAfter * 1000);
          return;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        } else {
          reject(new Error(`${method} ${endpoint} → ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (jsonBody) req.write(jsonBody);
    req.end();
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function listAllProducts() {
  const all = [];
  let page = 1;
  while (true) {
    console.log(`Fetching page ${page}...`);
    const res = await ssRequest('GET', `/products?page=${page}&pageSize=${PAGE_SIZE}`);
    const products = res.products || [];
    all.push(...products);
    if (page >= (res.pages || 1)) break;
    page++;
    await sleep(REQUEST_GAP_MS);
  }
  return all;
}

async function clearWeight(product) {
  // ShipStation /products PUT requires the full product object
  const updated = {
    ...product,
    weightOz: 0,
  };
  return ssRequest('PUT', `/products/${product.productId}`, updated);
}

(async () => {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`API base: ${baseUrl}\n`);

  const products = await listAllProducts();
  console.log(`\nFetched ${products.length} products.\n`);

  const needsUpdate = products.filter(p => (p.weightOz || 0) > 0);
  console.log(`${needsUpdate.length} products have weight > 0 and would be cleared.`);
  console.log(`${products.length - needsUpdate.length} products already at 0oz (skipping).\n`);

  if (!APPLY) {
    console.log('Sample (first 10 that would be cleared):');
    for (const p of needsUpdate.slice(0, 10)) {
      console.log(`  SKU "${p.sku}" — "${p.name}" — currently ${p.weightOz}oz`);
    }
    console.log('\nRe-run with --apply to update them.');
    return;
  }

  let success = 0, failed = 0;
  for (const p of needsUpdate) {
    try {
      await clearWeight(p);
      success++;
      console.log(`  [${success}/${needsUpdate.length}] cleared ${p.sku} (${p.weightOz}oz → 0oz)`);
    } catch (e) {
      failed++;
      console.error(`  FAIL ${p.sku}: ${e.message}`);
    }
    await sleep(REQUEST_GAP_MS);
  }

  console.log(`\nDone. Success: ${success}, Failed: ${failed}`);
})().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
