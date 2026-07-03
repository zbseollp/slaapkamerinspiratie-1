#!/usr/bin/env node
/**
 * Scrape live /beste-* product pages from slaapkamerinspiratie.nl
 */
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'src/content/products');
const UPLOADS_DIR = join(ROOT, 'public/uploads');
const BASE = 'https://slaapkamerinspiratie.nl';

async function loadSlugs() {
  const slugsPath = join(ROOT, 'src/data/product-slugs.ts');
  try {
    const content = await readFile(slugsPath, 'utf8');
    const match = content.match(/PRODUCT_SLUGS = (\[[\s\S]*?\]) as const/);
    if (match) return JSON.parse(match[1]);
  } catch {
    /* fall through */
  }
  return [];
}

function extractMeta(html, name) {
  const m = html.match(new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']*)["']`, 'i'));
  return m?.[1] ?? '';
}

function extractMainHtml(html) {
  const wpPageIdx = html.indexOf('data-elementor-type="wp-page"');
  const footerIdx = html.indexOf('data-elementor-type="footer"');
  if (wpPageIdx === -1 || footerIdx === -1) {
    const main = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (main) return main[1];
    const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (article) return article[1];
    throw new Error('Could not locate page content section');
  }
  const start = html.lastIndexOf('<div', wpPageIdx);
  const end = html.lastIndexOf('<', footerIdx);
  return html.slice(start, end);
}

function processHtml(html) {
  let out = html;

  out = out.replaceAll(`${BASE}/wp-content/uploads/`, '/uploads/');
  out = out.replaceAll('https://slaapkamerinspiratie.nl/wp-content/uploads/', '/uploads/');

  out = out.replace(
    /<img([^>]*)\sdata-lazy-src="([^"]+)"([^>]*)>/gi,
    (_, before, src, after) => {
      const cleaned = `${before} src="${src}"${after}`.replace(/\sloading="lazy"/gi, '');
      return `<img${cleaned}>`;
    }
  );
  out = out.replace(/\sdata-lazy-srcset="[^"]*"/gi, '');
  out = out.replace(/\sdata-lazy-sizes="[^"]*"/gi, '');
  out = out.replace(/\ssrcset="data:image\/svg\+xml[^"]*"/gi, '');
  out = out.replace(/\ssizes="\(max-width:[^"]*\)"/gi, '');
  out = out.replace(/<noscript>[\s\S]*?<\/noscript>/gi, '');
  out = out.replace(/\sdata-rocket-lazyload="[^"]*"/gi, '');
  out = out.replace(/\ssrc="data:image\/svg\+xml[^"]*"/gi, '');

  out = out.replaceAll(`href="${BASE}`, 'href="');
  out = out.replaceAll(`href='${BASE}`, "href='");

  out = out.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  out = out.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  return out.trim();
}

function collectImageUrls(html) {
  const urls = new Set();
  for (const m of html.matchAll(/(?:src|data-lazy-src|href)="(\/uploads\/[^"?]+)/g)) {
    urls.add(m[1]);
  }
  for (const m of html.matchAll(
    /(?:src|data-lazy-src)="(https:\/\/slaapkamerinspiratie\.nl\/wp-content\/uploads\/[^"?]+)/g
  )) {
    urls.add(m[1].replace(`${BASE}/wp-content/uploads/`, '/uploads/'));
  }
  return [...urls];
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function downloadImage(localPath) {
  const fullPath = join(ROOT, 'public', localPath);
  if (await fileExists(fullPath)) return;

  const remote = `${BASE}/wp-content/uploads/${localPath.replace('/uploads/', '')}`;
  const res = await fetch(remote, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; migration-bot/1.0)' },
  });
  if (!res.ok) {
    console.warn(`  image ${remote} -> ${res.status}`);
    return;
  }
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, Buffer.from(await res.arrayBuffer()));
}

async function scrapeSlug(slug, retries = 5) {
  const url = `${BASE}/${slug}/`;
  let html = '';
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; migration-bot/1.0)' },
    });
    if (res.ok) {
      html = await res.text();
      break;
    }
    if (attempt === retries) throw new Error(`HTTP ${res.status} for ${url}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }

  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  const title = titleMatch?.[1]?.replace(/\s*\|\s*slaapkamerinspiratie\.nl\s*$/i, '').trim() ?? slug;
  const description = extractMeta(html, 'description');
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/i)?.[1] ?? url;

  const mainHtml = processHtml(extractMainHtml(html));
  const images = collectImageUrls(mainHtml);

  for (const img of images) {
    await downloadImage(img);
  }

  const meta = {
    slug,
    title,
    description: description || title,
    canonical: canonical.replace(BASE, ''),
  };

  await writeFile(join(OUT_DIR, `${slug}.json`), JSON.stringify(meta, null, 2));
  await writeFile(join(OUT_DIR, `${slug}.html`), mainHtml);

  return { slug, title, images: images.length };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(UPLOADS_DIR, { recursive: true });

  const argSlugs = process.argv.slice(2);
  const slugsToScrape = argSlugs.length > 0 ? argSlugs : await loadSlugs();

  if (slugsToScrape.length === 0) {
    console.log('No product slugs to scrape.');
    return;
  }

  const results = [];
  for (const slug of slugsToScrape) {
    process.stdout.write(`Scraping ${slug}... `);
    try {
      const r = await scrapeSlug(slug);
      results.push(r);
      console.log(`OK (${r.images} images)`);
    } catch (err) {
      console.log(`FAIL: ${err.message}`);
      results.push({ slug, error: err.message });
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  const failed = results.filter((r) => r.error);
  console.log(`\nDone: ${results.length - failed.length}/${slugsToScrape.length} pages`);
  if (failed.length) {
    console.error('Failed:', failed.map((f) => f.slug).join(', '));
    process.exit(1);
  }
}

main();
