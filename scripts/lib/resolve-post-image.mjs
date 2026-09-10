/**
 * Shared image helpers for Node enrich scripts (mirror of src/lib/mediaUrl.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { readField, readPost, listBlogFiles } from './blog-files.mjs';

export const TENANT_SLUG = 'slaapkamerinspiratie';
export const DEFAULT_FEATURED =
  '/uploads/2026/06/anaterate-farmhouse-7424128_1280-300x200.jpg';

export function looksLikeImageUrl(url) {
  if (!url) return false;
  if (url.startsWith('data:image/')) return true;
  if (/^\/(?:uploads|wp-content\/uploads|media|api\/media)\//i.test(url)) return true;
  if (/\.(png|jpe?g|webp|gif|svg|avif)(\?.*)?$/i.test(url)) return true;
  if (/\.r2\.dev|cloudflarestorage\.com/i.test(url)) return true;
  return false;
}

export function extractMediaPath(value) {
  if (value == null) return '';
  if (typeof value === 'string') {
    return value
      .replace(/[\u00AD\u200B\uFEFF]/g, '')
      .trim()
      .replace(/\s+\\?["'].*$/, '')
      .trim();
  }
  return '';
}

export function resolveMediaUrl(pathOrUrl, options = {}) {
  const raw = extractMediaPath(pathOrUrl);
  if (!raw) return options.fallback ?? '';

  if (/^https?:\/\//i.test(raw)) {
    if (!looksLikeImageUrl(raw)) return options.fallback ?? '';
    try {
      const u = new URL(raw);
      if (/\.r2\.dev$/i.test(u.hostname) || /cloudflarestorage\.com$/i.test(u.hostname)) {
        let p = u.pathname.replace(/^\/+/, '');
        if (p && !p.startsWith('tenants/')) {
          p = `tenants/${TENANT_SLUG}/${p}`;
          return `${u.origin}/${p}`;
        }
      }
    } catch {
      /* keep */
    }
    return raw;
  }

  let p = raw;
  if (p.startsWith('uploads/') || p.startsWith('wp-content/')) p = `/${p}`;
  if (!p.startsWith('/')) p = `/${p}`;
  if (!looksLikeImageUrl(p)) return options.fallback ?? '';
  return p;
}

/** Prefer a file that actually exists under public/ (drop WP -1024x682 variants). */
export function preferExistingPublicUrl(url, root = process.cwd()) {
  const resolved = resolveMediaUrl(url);
  if (!resolved || !resolved.startsWith('/')) return resolved;
  const publicFile = path.join(root, 'public', resolved.replace(/^\//, ''));
  if (fs.existsSync(publicFile)) return resolved;
  const unsized = resolved.replace(/-\d+x\d+(\.(?:jpe?g|png|webp))$/i, '$1');
  if (unsized !== resolved) {
    const unsizedFile = path.join(root, 'public', unsized.replace(/^\//, ''));
    if (fs.existsSync(unsizedFile)) return unsized;
  }
  return resolved;
}

function firstImageFromBody(body) {
  if (!body) return '';
  const htmlExport =
    body.match(/export\s+const\s+__html\s*=\s*"((?:\\.|[^"\\])*)"/) ||
    body.match(/<WpContent\s+html=\{"((?:\\.|[^"\\])*)"\}/);
  const searchIn = htmlExport?.[1]
    ? htmlExport[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
    : body;

  const md = searchIn.match(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
  if (md?.[1]) {
    const r = resolveMediaUrl(md[1]);
    if (r) return r;
  }
  const html = searchIn.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (html?.[1]) {
    const r = resolveMediaUrl(html[1]);
    if (r) return r;
  }
  const upload = searchIn.match(/(\/(?:uploads|wp-content\/uploads)\/[^\s"'<>)]+)/i);
  if (upload?.[1]) {
    const r = resolveMediaUrl(upload[1]);
    if (r) return r;
  }
  return '';
}

/** Resolve featured/hero/image for one blog markdown file. */
export function resolvePostImageFromFile(filePath, root = process.cwd()) {
  const post = readPost(filePath);
  if (!post.hasFrontmatter) return DEFAULT_FEATURED;
  const candidates = [
    readField(post.frontmatter, 'featuredImage'),
    readField(post.frontmatter, 'heroImage'),
    readField(post.frontmatter, 'image'),
    readField(post.frontmatter, 'ogImage'),
    readField(post.frontmatter, 'thumbnail'),
  ];
  for (const c of candidates) {
    const resolved = preferExistingPublicUrl(resolveMediaUrl(c), root);
    if (resolved) return resolved;
  }
  const fromBody = preferExistingPublicUrl(firstImageFromBody(post.body), root);
  return fromBody || DEFAULT_FEATURED;
}

export function loadBlogImageMap(root = process.cwd()) {
  const map = new Map();
  for (const filePath of listBlogFiles(path.join(root, 'src/content/blog'))) {
    const post = readPost(filePath);
    map.set(post.slug, resolvePostImageFromFile(filePath, root));
  }
  return map;
}
