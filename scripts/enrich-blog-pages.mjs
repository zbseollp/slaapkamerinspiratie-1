#!/usr/bin/env node
/**
 * Clean and enrich fetched blog post HTML (sidebar thumbnails, content fixes).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePostImageFromFile } from './lib/resolve-post-image.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BLOG_PAGES_DIR = path.join(ROOT, 'src/data/blog-pages');
const BLOG_MDX_DIR = path.join(ROOT, 'src/content/blog');

function processContentHtml(html) {
  let result = html;

  if (!/id="content"/.test(result)) {
    result = result.replace(
      /(<div\s+)data-elementor-type="single-post"/,
      '$1id="content" data-elementor-type="single-post"'
    );
  }

  result = result.replace(/<p>\s*<\/p>/g, '');

  return result;
}

function pickMdxImage(slug) {
  const candidates = [`${slug}.mdx`, `${slug}.md`].map((f) => path.join(BLOG_MDX_DIR, f));
  const filePath = candidates.find((p) => fs.existsSync(p));
  if (!filePath) return '';
  return resolvePostImageFromFile(filePath, ROOT) || '';
}

function normalizePostImages(html) {
  return html.replace(
    /<div class="elementor-post__thumbnail"><img[^>]*\/?><\/div>/gi,
    (block) => {
      const src = block.match(/src="([^"]+)"/)?.[1];
      const alt = block.match(/alt="([^"]*)"/)?.[1] || '';
      if (!src) return block;
      return `<div class="elementor-post__thumbnail"><img width="300" height="200" src="${src}" class="attachment-medium size-medium wp-post-image" alt="${alt}" loading="lazy" decoding="async" /></div>`;
    }
  );
}

function enrichSidebarPosts(html) {
  return html.replace(
    /<article class="elementor-post[^"]*"[^>]*role="listitem">([\s\S]*?)<\/article>/g,
    (articleHtml) => {
      if (articleHtml.includes('elementor-post__thumbnail')) return articleHtml;

      const slugMatch = articleHtml.match(/href="\/([^/]+)\/"[^>]*>\s*([^<]+?)\s*<\/a>/);
      if (!slugMatch) return articleHtml;

      const [, slug, title] = slugMatch;
      const imageUrl =
        pickMdxImage(slug) ||
        '/uploads/2026/06/anaterate-farmhouse-7424128_1280-300x200.jpg';

      const thumb = `<a class="elementor-post__thumbnail__link" href="/${slug}/" tabindex="-1">
\t\t\t<div class="elementor-post__thumbnail"><img width="300" height="200" src="${imageUrl}" class="attachment-medium size-medium wp-post-image" alt="${title.replace(/"/g, '&quot;')}" loading="lazy" decoding="async" /></div>
\t\t</a>
\t\t\t\t`;

      return articleHtml.replace(
        /(<article class="elementor-post[^"]*)([^"]*)"([^>]*role="listitem">)\s*<div class="elementor-post__text">/,
        `$1 has-post-thumbnail$2"$3
\t\t\t\t${thumb}<div class="elementor-post__text">`
      );
    }
  );
}

function normalizeContentImages(html) {
  return html.replace(
    /<figure class="wp-block-image[^"]*">([\s\S]*?)<\/figure>/gi,
    (figure) => {
      const src = figure.match(/src="([^"]+)"/)?.[1];
      if (!src) return figure;
      const alt = figure.match(/alt="([^"]*)"/)?.[1] || '';
      return `<figure class="wp-block-image size-large"><img src="${src}" alt="${alt}" loading="lazy" decoding="async" /></figure>`;
    }
  );
}

async function main() {
  if (!fs.existsSync(BLOG_PAGES_DIR)) {
    console.log('No blog-pages directory found. Run fetch-blog-pages first.');
    return;
  }

  const files = fs.readdirSync(BLOG_PAGES_DIR).filter((f) => f.endsWith('.html'));
  let updated = 0;

  for (const file of files) {
    const filePath = path.join(BLOG_PAGES_DIR, file);
    let html = fs.readFileSync(filePath, 'utf8');
    const next = normalizeContentImages(
      normalizePostImages(enrichSidebarPosts(processContentHtml(html)))
    );

    if (next !== html) {
      fs.writeFileSync(filePath, next);
      updated++;
      console.log(`Updated ${file}`);
    }
  }

  console.log(`\nProcessed ${files.length} blog pages, updated ${updated}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
