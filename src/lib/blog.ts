import type { CollectionEntry } from 'astro:content';
import { getCollection } from 'astro:content';
import { PRODUCT_SLUGS } from '../data/product-slugs';
import { resolvePostImage } from './mediaUrl';

export type BlogEntry = CollectionEntry<'blog'>;

/** Allow ~2 days clock skew / scheduled publish windows from Payload. */
const FUTURE_SLACK_MS = 48 * 60 * 60 * 1000;

const UNPUBLISHED_STATUS = new Set([
  'draft',
  'private',
  'pending',
  'trash',
  'auto-draft',
  'inherit',
  'future',
  'scheduled',
  'unpublished',
]);

/** WordPress uses `publish`; Payload uses `published`. Both are live. */
const PUBLISHED_STATUS = new Set(['publish', 'published', 'live', 'public']);

const PRODUCT_SLUG_SET = new Set(PRODUCT_SLUGS);

/**
 * True when this entry must stay off the live site.
 * Live status wins over leftover WP `draft: true` in synced frontmatter.
 */
export function isDraftPost(data: {
  draft?: boolean | string;
  _status?: string;
  publishStatus?: string;
}): boolean {
  const status = String(data._status ?? data.publishStatus ?? '')
    .trim()
    .toLowerCase();
  if (PUBLISHED_STATUS.has(status)) return false;
  if (UNPUBLISHED_STATUS.has(status)) return true;

  if (data.draft === true || data.draft === 'true') return true;
  if (typeof data.draft === 'string') {
    const d = data.draft.trim().toLowerCase();
    if (['draft', 'yes', '1'].includes(d)) return true;
  }
  return false;
}

function toTime(value: unknown): number {
  if (!value) return 0;
  const d = value instanceof Date ? value : new Date(String(value));
  const t = d.getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function isPublishedPost(post: {
  data: {
    draft?: boolean | string;
    _status?: string;
    publishStatus?: string;
    pubDate?: unknown;
    date?: unknown;
  };
}): boolean {
  if (isDraftPost(post.data)) return false;
  const pub = Math.max(toTime(post.data.pubDate), toTime(post.data.date));
  if (pub > Date.now() + FUTURE_SLACK_MS) return false;
  return true;
}

/** Static / product routes that must not be shadowed by a blog slug. */
export const RESERVED_BLOG_SLUGS = new Set([
  'blog',
  'contact',
  'bedden',
  'dekbed',
  'interieur',
  'kledingkasten',
  'verlichting',
  'sitemap',
  'index',
]);

/** Legacy WordPress migration posts — keep Elementor scrape rendering. */
export function isLegacyWpBlogBody(body?: string): boolean {
  if (!body) return false;
  return (
    /export\s+const\s+__html\s*=/.test(body) ||
    /import\s+WpContent\s+from/.test(body) ||
    /<WpContent\b/.test(body)
  );
}

export function isListedBlogEntry(entry: {
  id?: string;
  data: {
    draft?: boolean | string;
    _status?: string;
    publishStatus?: string;
    pubDate?: unknown;
    date?: unknown;
  };
}): boolean {
  if (!entry.id || RESERVED_BLOG_SLUGS.has(entry.id)) return false;
  if (PRODUCT_SLUG_SET.has(entry.id)) return false;
  return isPublishedPost(entry);
}

export function getPostImage(entry: BlogEntry): string {
  return resolvePostImage(entry.data as Record<string, unknown>, entry.body);
}

function postSortTime(post: BlogEntry): number {
  const data = post.data as {
    pubDate?: unknown;
    date?: unknown;
    updatedDate?: unknown;
    modifiedDate?: unknown;
  };
  return Math.max(
    toTime(data.pubDate),
    toTime(data.date),
    toTime(data.updatedDate),
    toTime(data.modifiedDate),
  );
}

export async function getBlogListingPosts(): Promise<BlogEntry[]> {
  const posts = await getCollection('blog', (entry) => isListedBlogEntry(entry));
  return [...posts].sort((a, b) => {
    const diff = postSortTime(b) - postSortTime(a);
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  });
}

export function getPostSlug(entry: BlogEntry): string {
  return entry.id;
}

export function getPostUrl(entry: BlogEntry): string {
  return `/${getPostSlug(entry)}/`;
}
