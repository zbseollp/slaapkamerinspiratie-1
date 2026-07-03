#!/usr/bin/env node
/**
 * Fetch blog archive pages (/blog/, /blog/2/, ...) from live slaapkamerinspiratie.nl.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://slaapkamerinspiratie.nl';
const OUT_DIR = path.join(ROOT, 'src/data/blog-archive');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');

const PAGE_PATHS = ['blog', 'blog/2', 'blog/3', 'blog/4', 'blog/5', 'blog/6'];

function rewriteHtml(content) {
  let result = content
    .replaceAll(SITE, '')
    .replaceAll('/wp-content/uploads/', '/uploads/')
    .replace(/href=""/g, 'href="/"')
    .replace(/action=""/g, 'action="/"')
    .replace(/\sfetchpriority="[^"]*"/g, '')
    .replace(/\sdecoding="[^"]*"/g, '')
    .replace(/\sloading="[^"]*"/g, '')
    .replace(/\ssrcset="[^"]*"/g, '')
    .replace(/\ssizes="[^"]*"/g, '')
    .replace(/\sdata-rocket-location-hash="[^"]*"/g, '')
    .replace(/\sdata-lazy-srcset="[^"]*"/g, '')
    .replace(/\sdata-lazy-sizes="[^"]*"/g, '')
    .replace(/\sdata-rocket-lazyload="[^"]*"/g, '');

  result = result.replace(
    /<img([^>]*)\ssrc="data:image\/svg\+xml[^"]*"([^>]*)\sdata-lazy-src="([^"]+)"([^>]*)>/gi,
    (_, before, mid, lazySrc, after) => {
      const cleaned = `${before} src="${lazySrc}"${mid}${after}`.replace(/\sdata-lazy-src="[^"]*"/g, '');
      return `<img${cleaned}>`;
    }
  );

  result = result.replace(/<noscript><img[^>]*><\/noscript>/gi, '');
  result = result.replace(
    /(<div\s+)data-elementor-type="wp-page" data-elementor-id="688"/,
    '$1id="content" data-elementor-type="wp-page" data-elementor-id="688"'
  );

  return result;
}

function extractMeta(html, pagePath) {
  const title =
    html.match(/<title>([^<]+)<\/title>/)?.[1]?.replace(/\s*[-–|]\s*slaapkamerinspiratie\.nl\s*$/i, '').trim() ??
    'Blog';
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
  const canonical =
    html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]?.replace(SITE, '') ?? `/${pagePath}/`;
  const ogImage =
    html
      .match(/<meta property="og:image" content="([^"]+)"/)?.[1]
      ?.replace(SITE, '')
      .replace('/wp-content/uploads/', '/uploads/') ?? '';
  const bodyClass = html.match(/<body[^>]*class="([^"]*)"/)?.[1] ?? '';

  return { title, description, canonical, ogImage, bodyClass };
}

function extractMain(html) {
  const pageIdx = html.indexOf('data-elementor-id="688"');
  const footerIdx = html.indexOf('data-elementor-type="footer"');
  if (pageIdx < 0 || footerIdx < pageIdx) {
    throw new Error('Could not locate blog archive content');
  }
  const start = html.lastIndexOf('<div', pageIdx);
  return html.slice(start, footerIdx).trim();
}

function extractPostCss(html) {
  const sheets = new Set(['post-688.css']);
  for (const match of html.matchAll(/\/uploads\/elementor\/css\/(post-\d+\.css)/g)) {
    sheets.add(match[1]);
  }
  return [...sheets];
}

async function downloadImage(localPath) {
  const destPath = path.join(ROOT, 'public', localPath);
  if (fs.existsSync(destPath)) return;

  const remote = `${SITE}/wp-content/uploads/${localPath.replace('/uploads/', '')}`;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  try {
    const res = await fetch(remote, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; migration-bot/1.0)' },
    });
    if (res.ok) fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
  } catch {
    /* skip */
  }
}

async function downloadPostCss() {
  const dest = path.join(ROOT, 'public/css/elementor/post-688.css');
  if (fs.existsSync(dest)) return;

  const res = await fetch(`${SITE}/wp-content/uploads/elementor/css/post-688.css`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; migration-bot/1.0)' },
  });
  if (!res.ok) throw new Error(`Failed to download post-688.css: ${res.status}`);

  let content = await res.text();
  content = content
    .replaceAll(SITE, '')
    .replaceAll('/wp-content/uploads/', '/uploads/');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  console.log('  CSS: public/css/elementor/post-688.css');
}

function collectUploadPaths(content) {
  const paths = new Set();
  for (const match of content.matchAll(/\/uploads\/[^\s"'<>]+/g)) {
    paths.add(match[0].split('?')[0]);
  }
  return [...paths];
}

async function fetchPage(pagePath) {
  const url = `${SITE}/${pagePath}/`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; migration-bot/1.0)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const meta = extractMeta(html, pagePath);
  const mainHtml = rewriteHtml(extractMain(html));
  const postCss = extractPostCss(html);

  for (const img of collectUploadPaths(mainHtml)) {
    await downloadImage(img);
  }

  return { ...meta, postCss, html: mainHtml };
}

function manifestKey(pagePath) {
  return pagePath === 'blog' ? '1' : pagePath.replace('blog/', '');
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await downloadPostCss();

  const manifest = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
    : {};

  for (const pagePath of PAGE_PATHS) {
    const key = manifestKey(pagePath);
    process.stdout.write(`Fetching /${pagePath}/... `);
    try {
      const page = await fetchPage(pagePath);
      fs.writeFileSync(path.join(OUT_DIR, `page-${key}.html`), page.html);
      manifest[key] = {
        title: page.title,
        description: page.description,
        canonical: page.canonical,
        ogImage: page.ogImage,
        bodyClass: page.bodyClass,
        postCss: page.postCss,
        pageNumber: Number(key),
      };
      console.log('OK');
    } catch (err) {
      console.log(`FAIL: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nSaved ${Object.keys(manifest).length} blog archive pages.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
