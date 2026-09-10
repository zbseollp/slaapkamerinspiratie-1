import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { resolveMediaUrl } from './lib/mediaUrl';

/**
 * Soft schemas so Payload sync (extra keys, date vs pubDate, draft/_status,
 * heroImage objects, category objects) never breaks the Astro content build.
 */

const softDate = z.union([z.string(), z.coerce.date(), z.null()]).optional();

const mediaField = z
  .union([
    z.string(),
    z
      .object({
        url: z.string().optional(),
        filename: z.string().optional(),
        alt: z.string().optional(),
      })
      .passthrough(),
    z.null(),
  ])
  .optional();

function mediaToUrl(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim()))) {
    return '';
  }
  if (value === '[object Object]') return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    const o = value as { url?: string; filename?: string; src?: string };
    return (o.url || o.src || o.filename || '').trim();
  }
  return '';
}

/** Payload sometimes emits categories/tags as `{ name }` / `{ title }` objects. */
function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        const o = item as {
          name?: unknown;
          title?: unknown;
          label?: unknown;
          slug?: unknown;
          value?: unknown;
        };
        const s = o.name ?? o.title ?? o.label ?? o.value ?? o.slug;
        return typeof s === 'string' ? s.trim() : '';
      }
      return '';
    })
    .filter(Boolean);
}

function coerceDate(value: unknown): Date | undefined {
  if (value == null || value === '') return undefined;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const blog = defineCollection({
  loader: glob({
    base: './src/content/blog',
    pattern: '**/*.{md,mdx}',
  }),
  schema: z
    .object({
      title: z.union([z.string(), z.number()]).transform((v) => String(v)),
      description: z.string().optional().default(''),
      slug: z.string().optional(),
      pubDate: softDate,
      date: softDate,
      updatedDate: softDate,
      modifiedDate: softDate,
      author: z.string().optional(),
      categories: z.array(z.unknown()).optional(),
      tags: z.array(z.unknown()).optional(),
      featuredImage: mediaField,
      featuredImageAlt: z.string().optional(),
      heroImage: mediaField,
      image: mediaField,
      draft: z.union([z.boolean(), z.string()]).optional(),
      _status: z.string().optional(),
      publishStatus: z.string().optional(),
    })
    .passthrough()
    .transform((d) => {
      const status = String(d._status ?? d.publishStatus ?? '')
        .trim()
        .toLowerCase();
      const published = ['publish', 'published', 'live', 'public'].includes(status);
      const unpublished = [
        'draft',
        'private',
        'pending',
        'trash',
        'auto-draft',
        'inherit',
        'future',
        'scheduled',
        'unpublished',
      ].includes(status);
      const draftFlag =
        d.draft === true ||
        d.draft === 'true' ||
        (typeof d.draft === 'string' &&
          ['draft', 'yes', '1'].includes(d.draft.trim().toLowerCase()));
      // Live status wins over leftover WP draft:true in synced frontmatter.
      const draft = published ? false : unpublished ? true : draftFlag;

      const rawImage =
        mediaToUrl(d.featuredImage) || mediaToUrl(d.heroImage) || mediaToUrl(d.image) || '';
      const featuredImage = resolveMediaUrl(rawImage) || undefined;

      const pubDate = coerceDate(d.pubDate) ?? coerceDate(d.date) ?? new Date();
      const updatedDate = coerceDate(d.updatedDate) ?? coerceDate(d.modifiedDate);

      return {
        ...d,
        title: String(d.title),
        description: d.description ?? '',
        pubDate,
        date: coerceDate(d.date) ?? pubDate,
        updatedDate,
        categories: normalizeStringList(d.categories),
        tags: normalizeStringList(d.tags),
        featuredImage,
        heroImage: featuredImage,
        image: featuredImage,
        draft,
      };
    }),
});

export const collections = { blog };
