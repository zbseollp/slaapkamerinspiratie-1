#!/usr/bin/env node
/**
 * Fetch inner pages (contact, category pages) from live slaapkamerinspiratie.nl.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://slaapkamerinspiratie.nl';
const OUT_DIR = path.join(ROOT, 'src/data/content-pages');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');

const PAGE_PATHS = ['contact', 'bedden', 'dekbed', 'kledingkasten', 'interieur', 'verlichting', 'sitemap'];

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
    /(<div\s+)data-elementor-type="single-post"/,
    '$1id="content" data-elementor-type="single-post"'
  );
  result = result.replace(
    /<p>([\s\S]*?)<style>[\s\S]*?<\/style>\s*(<div class="zbmp-category-links">[\s\S]*?<\/div>)\s*<\/p>/gi,
    (_, intro, grid) => {
      const text = intro.trim();
      return text ? `<p>${text}</p>\n${grid}` : grid;
    }
  );
  result = result.replace(/<style>\s*\.zbmp-category-links[\s\S]*?<\/style>/gi, '');

  return result;
}

function extractMeta(html, pagePath) {
  const title =
    html.match(/<title>([^<]+)<\/title>/)?.[1]?.replace(/\s*\|\s*slaapkamerinspiratie\.nl\s*$/i, '').trim() ??
    pagePath;
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
  const canonical =
    html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]?.replace(SITE, '') ?? `/${pagePath}/`;
  const ogImage =
    html
      .match(/<meta property="og:image" content="([^"]+)"/)?.[1]
      ?.replace(SITE, '')
      .replace('/wp-content/uploads/', '/uploads/') ?? '';
  const bodyClass = html.match(/<body[^>]*class="([^"]*)"/)?.[1] ?? '';
  const modifiedTime = html.match(/<meta property="article:modified_time" content="([^"]+)"/)?.[1] ?? '';
  const publishedTime = html.match(/<meta property="article:published_time" content="([^"]+)"/)?.[1] ?? '';

  return { title, description, canonical, ogImage, bodyClass, modifiedTime, publishedTime };
}

function extractMain(html) {
  const headerEnd = html.indexOf('</header>');
  const footerStart = html.indexOf('<footer');
  if (headerEnd < 0 || footerStart < headerEnd) {
    throw new Error('Could not locate main content boundaries');
  }
  return html.slice(headerEnd + '</header>'.length, footerStart).trim();
}

function extractPostCss(html) {
  const sheets = new Set();
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
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  const meta = extractMeta(html, pagePath);
  const mainHtml = rewriteHtml(extractMain(html));
  const postCss = extractPostCss(html);

  for (const img of collectUploadPaths(mainHtml)) {
    await downloadImage(img);
  }

  return {
    ...meta,
    postCss,
    html: mainHtml,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
    : {};

  for (const pagePath of PAGE_PATHS) {
    process.stdout.write(`Fetching ${pagePath}... `);
    try {
      const page = await fetchPage(pagePath);
      fs.writeFileSync(path.join(OUT_DIR, `${pagePath}.html`), page.html);
      manifest[pagePath] = {
        title: page.title,
        description: page.description,
        canonical: page.canonical,
        ogImage: page.ogImage,
        bodyClass: page.bodyClass,
        modifiedTime: page.modifiedTime,
        publishedTime: page.publishedTime,
        postCss: page.postCss,
      };
      console.log('OK');
    } catch (err) {
      console.log(`FAIL: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nSaved ${Object.keys(manifest).length} pages to manifest.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
