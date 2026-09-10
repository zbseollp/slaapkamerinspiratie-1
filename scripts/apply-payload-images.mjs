#!/usr/bin/env node
/**
 * Apply Payload `heroImage` / `featuredImage` onto scraped Elementor post HTML
 * and the blog-pages manifest `ogImage`, so CMS images actually show on legacy
 * scrape routes (not only on the Astro BlogPostLayout fallback).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listBlogFiles, readPost, readField } from './lib/blog-files.mjs';
import {
  preferExistingPublicUrl,
  resolveMediaUrl,
  resolvePostImageFromFile,
} from './lib/resolve-post-image.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BLOG_PAGES_DIR = path.join(ROOT, 'src/data/blog-pages');
const MANIFEST_PATH = path.join(BLOG_PAGES_DIR, 'manifest.json');

function escapeAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function applyFeaturedWidget(html, imageUrl, alt) {
  if (!imageUrl) return html;
  const safeAlt = escapeAttr(alt || '');
  const safeSrc = escapeAttr(imageUrl);

  if (/theme-post-featured-image[\s\S]*?<img\b/i.test(html)) {
    return html.replace(
      /(theme-post-featured-image[\s\S]*?<img\b[^>]*?\bsrc=")([^"]*)(")/i,
      `$1${safeSrc}$3`,
    );
  }

  // Widget present but empty — inject an <img>.
  if (/theme-post-featured-image/i.test(html)) {
    return html.replace(
      /(theme-post-featured-image[\s\S]*?<div class="elementor-widget-container">)(\s*)(<\/div>)/i,
      `$1$2<img width="800" height="533" src="${safeSrc}" class="attachment-large size-large wp-post-image" alt="${safeAlt}" />$2$3`,
    );
  }

  // No featured widget — insert after the post title widget when possible.
  const imgBlock = `<div class="elementor-element elementor-element-18ec435 elementor-widget elementor-widget-theme-post-featured-image elementor-widget-image" data-id="18ec435" data-element_type="widget" data-e-type="widget" data-widget_type="theme-post-featured-image.default">
				<div class="elementor-widget-container">
															<img width="800" height="533" src="${safeSrc}" class="attachment-large size-large wp-post-image" alt="${safeAlt}" />															</div>
				</div>
`;
  if (/theme-post-title[\s\S]*?<\/div>\s*<\/div>/i.test(html)) {
    return html.replace(
      /(theme-post-title[\s\S]*?<\/div>\s*<\/div>)/i,
      `$1\n\t\t\t\t${imgBlock}`,
    );
  }
  return html;
}

function hasPayloadImageFields(frontmatter) {
  return Boolean(
    readField(frontmatter, 'featuredImage') ||
      readField(frontmatter, 'heroImage') ||
      readField(frontmatter, 'image'),
  );
}

function main() {
  if (!fs.existsSync(BLOG_PAGES_DIR)) {
    console.log('[apply-payload-images] no blog-pages dir — skip');
    return;
  }

  let manifest = {};
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    } catch {
      manifest = {};
    }
  }

  let pagesUpdated = 0;
  let manifestUpdated = 0;

  for (const filePath of listBlogFiles()) {
    const post = readPost(filePath);
    if (!post.hasFrontmatter) continue;

    const title = readField(post.frontmatter, 'title') || post.slug;
    const hasPayload = hasPayloadImageFields(post.frontmatter);
    const imageUrl = preferExistingPublicUrl(resolvePostImageFromFile(filePath, ROOT), ROOT);
    if (!imageUrl) continue;

    const pagePath = path.join(BLOG_PAGES_DIR, `${post.slug}.html`);
    if (fs.existsSync(pagePath)) {
      const html = fs.readFileSync(pagePath, 'utf8');
      const current =
        html.match(/theme-post-featured-image[\s\S]*?<img[^>]+src="([^"]*)"/i)?.[1] || '';
      const shouldApply = hasPayload || !current || !looksLocallyOk(current);

      if (shouldApply) {
        const next = applyFeaturedWidget(html, imageUrl, title);
        if (next !== html) {
          fs.writeFileSync(pagePath, next);
          pagesUpdated += 1;
        }
      }
    }

    if (hasPayload) {
      const entry = manifest[post.slug] || {};
      const og =
        resolveMediaUrl(readField(post.frontmatter, 'featuredImage')) ||
        resolveMediaUrl(readField(post.frontmatter, 'heroImage')) ||
        imageUrl;
      if (og && entry.ogImage !== og) {
        manifest[post.slug] = { ...entry, ogImage: og };
        manifestUpdated += 1;
      }
    }
  }

  if (manifestUpdated > 0) {
    fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  console.log(
    `[apply-payload-images] pages=${pagesUpdated}, manifestOg=${manifestUpdated}`,
  );
}

function looksLocallyOk(src) {
  if (!src) return false;
  if (/^https?:\/\//i.test(src)) return looksLikeRemoteImage(src);
  const file = path.join(ROOT, 'public', src.replace(/^\//, ''));
  if (fs.existsSync(file)) return true;
  const unsized = src.replace(/-\d+x\d+(\.(?:jpe?g|png|webp))$/i, '$1');
  return unsized !== src && fs.existsSync(path.join(ROOT, 'public', unsized.replace(/^\//, '')));
}

function looksLikeRemoteImage(src) {
  return /\.(png|jpe?g|webp|gif|svg|avif)(\?.*)?$/i.test(src) || /\.r2\.dev/i.test(src);
}

main();
