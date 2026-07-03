#!/usr/bin/env node
/**
 * Download CSS assets required by product and inner content pages.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://slaapkamerinspiratie.nl';

const CSS_FILES = [
  `${SITE}/wp-content/uploads/elementor/css/post-50.css`,
  `${SITE}/wp-content/uploads/elementor/css/post-465.css`,
  `${SITE}/wp-content/uploads/elementor/css/post-21379.css`,
  `${SITE}/wp-content/plugins/elementor/assets/css/widget-button.min.css?ver=4.1.4`,
  `${SITE}/wp-content/plugins/elementor/assets/css/widget-divider.min.css?ver=4.1.4`,
  `${SITE}/wp-content/plugins/elementor/assets/css/widget-accordion.min.css?ver=4.1.4`,
  `${SITE}/wp-content/plugins/elementor-pro/assets/css/widget-table-of-contents.min.css?ver=4.1.2`,
  `${SITE}/wp-content/plugins/elementor-pro/assets/css/widget-author-box.min.css?ver=4.1.2`,
  `${SITE}/wp-content/plugins/elementor-pro/assets/css/widget-breadcrumbs.min.css?ver=4.1.2`,
  `${SITE}/wp-content/plugins/elementor/assets/css/widget-icon-list.min.css?ver=4.1.4`,
  `${SITE}/wp-content/plugins/elementor-pro/assets/css/widget-post-info.min.css?ver=4.1.2`,
  `${SITE}/wp-content/plugins/elementor-pro/assets/css/widget-form.min.css?ver=4.1.2`,
];

function mapDest(url) {
  const clean = url.replace(SITE, '').split('?')[0];
  if (clean.includes('/uploads/elementor/css/post-')) {
    return `public/css/elementor/${path.basename(clean)}`;
  }
  if (clean.includes('/plugins/elementor')) {
    return `public/css/elementor/${path.basename(clean)}`;
  }
  return null;
}

function rewriteCssUrls(content) {
  return content
    .replaceAll(SITE, '')
    .replaceAll('/wp-content/uploads/', '/uploads/')
    .replace(/url\(\.\.\/fonts\/(eicons\.[^)]+)\)/g, 'url(/fonts/eicons/$1)')
    .replace(/url\(\.\.\/webfonts\/([^)]+)\)/g, 'url(/fonts/fontawesome/$1)');
}

async function main() {
  console.log('Downloading content page CSS...');
  for (const url of CSS_FILES) {
    const destRel = mapDest(url);
    if (!destRel) continue;

    const destPath = path.join(ROOT, destRel);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; migration-bot/1.0)' },
    });
    if (!res.ok) {
      console.warn(`  Failed ${url}: ${res.status}`);
      continue;
    }

    let content = await res.text();
    content = rewriteCssUrls(content);
    fs.writeFileSync(destPath, content);
    console.log(`  CSS: ${destRel}`);
  }
  console.log('Content page CSS download complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
