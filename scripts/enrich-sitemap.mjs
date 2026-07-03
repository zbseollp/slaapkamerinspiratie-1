#!/usr/bin/env node
/**
 * Fix sitemap page HTML: valid local links only, strip admin/template URLs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITEMAP_HTML = path.join(ROOT, 'src/data/content-pages/sitemap.html');
const PRODUCT_SLUGS_FILE = path.join(ROOT, 'src/data/product-slugs.ts');
const BLOG_DIR = path.join(ROOT, 'src/content/blog');
const FALLBACK_IMAGE = '/uploads/2026/06/anaterate-farmhouse-7424128_1280-300x200.jpg';

function loadValidRoutes() {
  const routes = new Set([
    '/',
    '/bedden/',
    '/blog/',
    '/contact/',
    '/dekbed/',
    '/interieur/',
    '/kledingkasten/',
    '/sitemap/',
    '/verlichting/',
  ]);

  for (let i = 2; i <= 6; i += 1) {
    routes.add(`/blog/${i}/`);
  }

  if (fs.existsSync(PRODUCT_SLUGS_FILE)) {
    const content = fs.readFileSync(PRODUCT_SLUGS_FILE, 'utf8');
    for (const slug of content.matchAll(/"([^"]+)"/g)) {
      routes.add(`/${slug[1]}/`);
    }
  }

  if (fs.existsSync(BLOG_DIR)) {
    for (const file of fs.readdirSync(BLOG_DIR)) {
      if (file.endsWith('.mdx') || file.endsWith('.md')) {
        routes.add(`/${file.replace(/\.mdx?$/, '')}/`);
      }
    }
  }

  return routes;
}

function normalizeHref(href) {
  if (!href || href.startsWith('#') || href.startsWith('mailto:')) return href;
  let pathOnly = href.split('?')[0].split('#')[0];
  if (!pathOnly.startsWith('/')) return pathOnly;
  if (!pathOnly.endsWith('/')) pathOnly += '/';
  return pathOnly;
}

function isValidHref(href, validRoutes) {
  const norm = normalizeHref(href);
  if (!norm.startsWith('/')) return true;
  if (norm.includes('elementor_library')) return false;
  if (norm.startsWith('/category/')) return false;
  return validRoutes.has(norm);
}

function pickMdxImage(slug) {
  const mdxPath = path.join(BLOG_DIR, `${slug}.mdx`);
  if (!fs.existsSync(mdxPath)) return '';

  const content = fs.readFileSync(mdxPath, 'utf8');
  const images = [...content.matchAll(/\/uploads\/[^"\\]+\.(?:jpe?g|png|webp)/gi)].map((m) =>
    m[0].replace(/\\"/g, '')
  );
  const filtered = images.filter((img) => !/32x32|150x150|cropped-group|Group-18|icon/i.test(img));
  return filtered[0] || '';
}

function stripInvalidLinks(html, validRoutes) {
  let result = html;

  result = result.replace(/href="\/category\/blog\/"/g, 'href="/blog/"');
  result = result.replace(/href="\/category\/[^"]+"/g, 'href="/blog/"');

  result = result.replace(/<a[^>]*href="[^"]*elementor_library[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '');

  result = result.replace(/<li>\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/li>/gi, (item, href, label) => {
    if (!isValidHref(href, validRoutes)) return '';
    const norm = normalizeHref(href);
    return `<li><a href="${norm}">${label.trim()}</a></li>`;
  });

  result = result.replace(/<a\s+href="([^"]+)"([^>]*)>/gi, (tag, href, rest) => {
    if (!isValidHref(href, validRoutes)) return '';
    return `<a href="${normalizeHref(href)}"${rest}>`;
  });

  result = result.replace(/<h2 class="wsp-elementor_librarys-title">[\s\S]*?<\/ul>\s*/gi, '');
  result = result.replace(/<li>\s*<\/li>/g, '');
  result = result.replace(/<ul>\s*<\/ul>/g, '');
  result = result.replace(/<p>\s*<\/p>/g, '');

  return result;
}

function addCalendarIcons(html) {
  return html.replace(
    /<span class="elementor-post-date">\s*([^<]+?)\s*<\/span>/g,
    (_, date) =>
      `<span class="elementor-post-date"><i aria-hidden="true" class="far fa-calendar-check"></i> ${date.trim()}</span>`
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
      const imageUrl = pickMdxImage(slug) || FALLBACK_IMAGE;
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

function processContentHtml(html) {
  let result = html;

  if (!/id="content"/.test(result)) {
    result = result.replace(
      /(<div\s+)data-elementor-type="single-post"/,
      '$1id="content" data-elementor-type="single-post"'
    );
  }

  return result;
}

async function main() {
  if (!fs.existsSync(SITEMAP_HTML)) {
    console.log('No sitemap.html found. Run fetch-inner-pages first.');
    return;
  }

  const validRoutes = loadValidRoutes();
  let html = fs.readFileSync(SITEMAP_HTML, 'utf8');
  const before = html;

  html = processContentHtml(html);
  html = stripInvalidLinks(html, validRoutes);
  html = addCalendarIcons(enrichSidebarPosts(html));

  if (html !== before) {
    fs.writeFileSync(SITEMAP_HTML, html);
    console.log(`Sitemap enriched. Valid routes: ${validRoutes.size}`);
  } else {
    console.log('Sitemap already up to date.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
