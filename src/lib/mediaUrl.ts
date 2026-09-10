/**
 * Normalize blog/media URLs for slaapkamerinspiratie.
 * Payload may emit string paths, R2 URLs, `/api/media/file/…`, or `{ url, filename }` objects.
 */

export const TENANT_SLUG = 'slaapkamerinspiratie';

export const DEFAULT_FEATURED =
  '/uploads/2026/06/anaterate-farmhouse-7424128_1280-300x200.jpg';

function scrub(value: string): string {
  return value.replace(/[\u00AD\u200B\uFEFF]/g, '').trim();
}

/** Reject webpage / non-image URLs that Payload sometimes stores in image fields. */
export function looksLikeImageUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('data:image/')) return true;
  if (/^\/(?:uploads|wp-content\/uploads|media|api\/media)\//i.test(url)) return true;
  if (/\.(png|jpe?g|webp|gif|svg|avif)(\?.*)?$/i.test(url)) return true;
  if (/\.r2\.dev|cloudflarestorage\.com/i.test(url)) return true;
  return false;
}

export function extractMediaPath(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    // Payload YAML sometimes appends junk after the URL.
    return scrub(value).replace(/\s+\\?["'].*$/, '').trim();
  }
  if (typeof value === 'object') {
    const obj = value as {
      url?: unknown;
      filename?: unknown;
      src?: unknown;
      prefix?: unknown;
    };
    const filename = typeof obj.filename === 'string' ? scrub(obj.filename) : '';
    const prefix = typeof obj.prefix === 'string' ? scrub(obj.prefix).replace(/^\/+|\/+$/g, '') : '';
    const rawUrl = typeof obj.url === 'string' ? scrub(obj.url) : '';
    if (filename && prefix) {
      if (rawUrl && /^https?:\/\//i.test(rawUrl) && !rawUrl.includes(`/${prefix}/`)) {
        try {
          return `${new URL(rawUrl).origin}/${prefix}/${filename}`;
        } catch {
          /* fall through */
        }
      }
      if (rawUrl) return rawUrl;
      return `/${prefix}/${filename}`;
    }
    if (rawUrl) return rawUrl;
    if (typeof obj.src === 'string' && scrub(obj.src)) return scrub(obj.src);
    if (filename) return filename;
  }
  return '';
}

/** Rewrite tenant R2 object keys when Payload omits `tenants/<slug>/`. */
export function rewriteTenantR2Url(url: string): string {
  const raw = scrub(url);
  if (!raw || !/^https?:\/\//i.test(raw)) return raw;
  try {
    const u = new URL(raw);
    if (!/\.r2\.dev$/i.test(u.hostname) && !/cloudflarestorage\.com$/i.test(u.hostname)) {
      return raw;
    }
    let path = u.pathname.replace(/^\/+/, '');
    if (!path) return raw;
    if (path.startsWith(`tenants/${TENANT_SLUG}/`)) return `${u.origin}/${path}`;
    if (path.startsWith('tenants/') && !path.startsWith(`tenants/${TENANT_SLUG}/`)) {
      return `${u.origin}/${path}`;
    }
    if (!path.startsWith('tenants/')) path = `tenants/${TENANT_SLUG}/${path}`;
    return `${u.origin}/${path}`;
  } catch {
    return raw;
  }
}

export function resolveMediaUrl(pathOrUrl: unknown, options: { fallback?: string } = {}): string {
  const raw = extractMediaPath(pathOrUrl);
  if (!raw) return options.fallback ?? '';

  if (/^https?:\/\//i.test(raw)) {
    if (!looksLikeImageUrl(raw)) return options.fallback ?? '';
    return rewriteTenantR2Url(raw);
  }

  if (raw.startsWith('/api/media/file/')) {
    const filename = raw.slice('/api/media/file/'.length).replace(/^\/+/, '');
    // Prefer absolute-looking CDN later; keep a site-relative media path for now.
    const candidate = `/media/${filename}`;
    return looksLikeImageUrl(candidate) || looksLikeImageUrl(filename)
      ? candidate
      : options.fallback ?? '';
  }

  let path = raw;
  if (path.startsWith('uploads/')) path = `/${path}`;
  if (path.startsWith('wp-content/')) path = `/${path}`;
  if (!path.startsWith('/')) path = `/${path}`;

  if (!looksLikeImageUrl(path)) return options.fallback ?? '';
  return path;
}

export function firstImageFromBody(body: string | undefined): string {
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
    const resolved = resolveMediaUrl(md[1]);
    if (resolved) return resolved;
  }
  const html = searchIn.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (html?.[1]) {
    const resolved = resolveMediaUrl(html[1]);
    if (resolved) return resolved;
  }
  const upload = searchIn.match(/(\/(?:uploads|wp-content\/uploads)\/[^\s"'<>)]+)/i);
  if (upload?.[1]) {
    const resolved = resolveMediaUrl(upload[1]);
    if (resolved) return resolved;
  }
  return '';
}

export function resolvePostImage(data: Record<string, unknown>, body?: string): string {
  const candidates = [
    data.featuredImage,
    data.heroImage,
    data.image,
    data.thumbnail,
    data.coverImage,
    data.ogImage,
  ];
  for (const c of candidates) {
    const resolved = resolveMediaUrl(c);
    if (resolved) return resolved;
  }
  return firstImageFromBody(body) || DEFAULT_FEATURED;
}
