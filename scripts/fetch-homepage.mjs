#!/usr/bin/env node
/**
 * Fetch live homepage HTML from slaapkamerinspiratie.nl and process for Astro.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://slaapkamerinspiratie.nl';
const OUT_DIR = path.join(ROOT, 'src/data/homepage');
const CACHE = path.join(ROOT, '.migration-cache/homepage-live.html');

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
    /(<div\s+)data-elementor-type="wp-page"/,
    '$1id="content" data-elementor-type="wp-page"'
  );

  return result;
}

function collectUploadPaths(...contents) {
  const paths = new Set();
  for (const content of contents) {
    for (const match of content.matchAll(/\/uploads\/[^\s"'<>]+/g)) {
      paths.add(match[0].split('?')[0]);
    }
  }
  return [...paths];
}

async function downloadImage(localPath) {
  const destPath = path.join(ROOT, 'public', localPath);
  if (fs.existsSync(destPath)) return;

  const remoteUrl = `${SITE}/wp-content/uploads/${localPath.replace('/uploads/', '')}`;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const res = await fetch(remoteUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; migration-bot/1.0)' },
  });
  if (!res.ok) {
    console.warn(`  Failed to download ${remoteUrl}: ${res.status}`);
    return;
  }
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
  console.log(`  Downloaded: ${localPath}`);
}

async function downloadImages(localPaths) {
  for (const localPath of localPaths.sort()) {
    await downloadImage(localPath);
  }
}

async function main() {
  console.log('Fetching live homepage...');
  const res = await fetch(`${SITE}/`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; migration-bot/1.0)' },
  });
  const html = await res.text();
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, html);

  const headerStart = html.indexOf('<header');
  const headerEnd = html.indexOf('</header>') + '</header>'.length;
  const footerStart = html.indexOf('<footer');
  const footerEnd = html.indexOf('</footer>') + '</footer>'.length;

  if (headerStart < 0 || footerStart < 0) {
    throw new Error('Could not locate header/footer in homepage HTML');
  }

  let main = html.slice(headerEnd, footerStart);
  main = rewriteHtml(main);

  const headerHtml = rewriteHtml(html.slice(headerStart, headerEnd));
  const mainHtml = rewriteHtml(main);
  const footerHtml = rewriteHtml(html.slice(footerStart, footerEnd));

  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const descMatch = html.match(/<meta property="og:description" content="([^"]*)"/);
  const modifiedMatch = html.match(/<meta property="article:modified_time" content="([^"]+)"/);
  const ogImageMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
  const bodyClassMatch = html.match(/<body class="([^"]+)"/);

  const meta = {
    title: titleMatch?.[1] || 'Home - slaapkamerinspiratie.nl',
    description:
      descMatch?.[1]
        ?.replace(/&euml;/g, 'ë')
        .replace(/&eacute;/g, 'é')
        .replace(/&ndash;/g, '–')
        .replace(/&hellip;/g, '…')
        .replace(/&amp;/g, '&') ||
      'Creëer de perfecte slaapomgeving. Welkom bij slaapkamerinspiratie.nl',
    canonical: '/',
    modifiedTime: modifiedMatch?.[1] || '',
    ogImage:
      ogImageMatch?.[1]?.replace(SITE, '').replace('/wp-content/uploads/', '/uploads/') ||
      '/uploads/2022/12/Rectangle-36111.jpg',
    bodyClass:
      bodyClassMatch?.[1] ||
      'home wp-singular page-template page-template-elementor_header_footer page page-id-18 wp-embed-responsive wp-theme-hello-elementor hello-elementor-default elementor-default elementor-template-full-width elementor-kit-9 elementor-page elementor-page-18',
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'header.html'), headerHtml);
  fs.writeFileSync(path.join(OUT_DIR, 'main.html'), mainHtml);
  fs.writeFileSync(path.join(OUT_DIR, 'footer.html'), footerHtml);
  fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2));

  console.log('Downloading homepage images...');
  const imagePaths = collectUploadPaths(headerHtml, mainHtml, footerHtml);
  await downloadImages(imagePaths);

  console.log(
    `Homepage HTML updated in ${path.relative(ROOT, OUT_DIR)}/ (${imagePaths.length} images checked)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
