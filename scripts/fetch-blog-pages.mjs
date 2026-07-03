#!/usr/bin/env node
/**
 * Fetch blog post pages from live slaapkamerinspiratie.nl (Elementor single-post template).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://slaapkamerinspiratie.nl';
const BLOG_MDX_DIR = path.join(ROOT, 'src/content/blog');
const OUT_DIR = path.join(ROOT, 'src/data/blog-pages');
const MANIFEST_PATH = path.join(OUT_DIR, 'manifest.json');

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

  return result;
}

function extractMeta(html, slug) {
  const title =
    html.match(/<title>([^<]+)<\/title>/)?.[1]?.replace(/\s*[-–|]\s*slaapkamerinspiratie\.nl\s*$/i, '').trim() ??
    slug;
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
  const canonical =
    html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]?.replace(SITE, '') ?? `/${slug}/`;
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
  const singlePostIdx = html.indexOf('data-elementor-type="single-post"');
  const footerIdx = html.indexOf('data-elementor-type="footer"');
  if (singlePostIdx < 0 || footerIdx < singlePostIdx) {
    throw new Error('Could not locate single-post content');
  }
  const start = html.lastIndexOf('<div', singlePostIdx);
  return html.slice(start, footerIdx).trim();
}

function extractPostCss(html) {
  const sheets = new Set(['post-21379.css']);
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

function loadSlugs() {
  return fs
    .readdirSync(BLOG_MDX_DIR)
    .filter((f) => f.endsWith('.mdx') || f.endsWith('.md'))
    .map((f) => f.replace(/\.mdx?$/, ''));
}

async function fetchPage(slug) {
  const url = `${SITE}/${slug}/`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; migration-bot/1.0)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const meta = extractMeta(html, slug);
  const mainHtml = rewriteHtml(extractMain(html));
  const postCss = extractPostCss(html);

  for (const img of collectUploadPaths(mainHtml)) {
    await downloadImage(img);
  }

  return { ...meta, postCss, html: mainHtml };
}

async function main() {
  const slugs = loadSlugs();
  const only = process.argv.slice(2);
  const targets = only.length ? slugs.filter((s) => only.includes(s) || only.includes('all')) : slugs;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = fs.existsSync(MANIFEST_PATH)
    ? JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
    : {};

  let ok = 0;
  let fail = 0;

  for (const slug of targets) {
    process.stdout.write(`[${ok + fail + 1}/${targets.length}] ${slug}... `);
    try {
      const page = await fetchPage(slug);
      fs.writeFileSync(path.join(OUT_DIR, `${slug}.html`), page.html);
      manifest[slug] = {
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
      ok++;
    } catch (err) {
      console.log(`FAIL: ${err.message}`);
      fail++;
    }
    await new Promise((r) => setTimeout(r, 350));
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`\nDone: ${ok} OK, ${fail} failed, ${Object.keys(manifest).length} in manifest.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
