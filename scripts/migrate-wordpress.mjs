#!/usr/bin/env node
/**
 * WordPress WXR → Astro migration script for slaapkamerinspiratie.nl
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { parseHTML } from 'linkedom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const XML_PATH = path.join(ROOT, 'slaapkamerinspiratienl.WordPress.2026-07-03.xml');
const BLOG_DIR = path.join(ROOT, 'src/content/blog');
const PAGES_DIR = path.join(ROOT, 'src/pages');
const PUBLIC_UPLOADS = path.join(ROOT, 'public/uploads');
const NAV_PATH = path.join(ROOT, 'src/data/navigation.json');
const PAGE_DATA_DIR = path.join(ROOT, 'src/data/pages');
const PRODUCT_SLUGS_PATH = path.join(ROOT, 'src/data/product-slugs.ts');
const SITE_URL = 'https://slaapkamerinspiratie.nl';

const SKIP_PAGE_SLUGS = new Set([
  'blog',
  'sitemap',
  'zb_mp_product',
  'dekbedden-template',
  'privacy-policy',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '__cdata',
  isArray: (name) =>
    ['item', 'wp:author', 'wp:category', 'wp:tag', 'wp:term', 'category', 'wp:postmeta'].includes(
      name
    ),
});

function text(val) {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (val.__cdata != null) return String(val.__cdata);
  return String(val);
}

function ensureArray(val) {
  if (val == null) return [];
  return Array.isArray(val) ? val : [val];
}

function escapeYaml(str) {
  if (!str) return '""';
  const cleaned = str.replace(/\r/g, '').trim();
  if (/[:#\[\]{}|>&*!%@`"'\\]/.test(cleaned) || cleaned.includes('\n')) {
    return `"${cleaned.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  }
  return `"${cleaned.replace(/"/g, '\\"')}"`;
}

function stripWpBlocks(html) {
  return html
    .replace(/<!--\s*\/?wp:[^>]+-->/g, '')
    .replace(/\[wp_sitemap_page\]/g, '')
    .replace(/\[lmt-post-modified-info\]/g, '')
    .replace(/\[elementor-template[^\]]*\]/g, '')
    .replace(/\[embed\][\s\S]*?\[\/embed\]/g, '')
    .replace(/\[zb_mp[^\]]*\]/g, '');
}

function rewriteUrls(html) {
  return html
    .replace(/https:\/\/slaapkamerinspiratie\.nl\/wp-content\/uploads\//g, '/uploads/')
    .replace(/https:\/\/slaapkamerinspiratie\.nl\//g, '/')
    .replace(/srcset="[^"]*"/g, '')
    .replace(/sizes="[^"]*"/g, '')
    .replace(/loading="[^"]*"/g, '')
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, '–')
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function sanitizeHtml(html) {
  let body = rewriteUrls(stripWpBlocks(html));
  try {
    const { document } = parseHTML(`<div id="wp-root">${body}</div>`);
    document.querySelectorAll('style, script').forEach((el) => el.remove());
    body = document.querySelector('#wp-root')?.innerHTML || body;
  } catch {
    body = body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    body = body.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  }
  return body.trim();
}

function htmlToMdxBody(html) {
  const body = sanitizeHtml(html);
  return `import WpContent from '../../components/WpContent.astro';\n\n<WpContent html={${JSON.stringify(body)}} />`;
}

function extractDescription(excerpt, html, title) {
  const ex = text(excerpt).trim();
  if (ex) return ex.replace(/<[^>]+>/g, '').slice(0, 300);
  const match = html.match(/<p[^>]*>(.*?)<\/p>/is);
  if (match) return match[1].replace(/<[^>]+>/g, '').trim().slice(0, 300);
  return title;
}

function getMeta(item, key) {
  const metas = ensureArray(item['wp:postmeta']);
  for (const meta of metas) {
    if (text(meta['wp:meta_key']) === key) return text(meta['wp:meta_value']);
  }
  return '';
}

function getCategories(item) {
  return ensureArray(item.category)
    .filter((c) => text(c['@_domain']) === 'category')
    .map((c) => text(c.__cdata || c).trim())
    .filter(Boolean);
}

function getTags(item) {
  return ensureArray(item.category)
    .filter((c) => text(c['@_domain']) === 'post_tag')
    .map((c) => text(c.__cdata || c).trim())
    .filter(Boolean);
}

function parseItems() {
  const xml = fs.readFileSync(XML_PATH, 'utf-8');
  const data = parser.parse(xml);
  const channel = data.rss.channel;
  const items = ensureArray(channel.item);

  const authors = {};
  for (const a of ensureArray(channel['wp:author'])) {
    authors[text(a['wp:author_login'])] =
      text(a['wp:author_display_name']) || text(a['wp:author_login']);
  }

  const byId = {};
  const attachments = {};
  const posts = [];
  const pages = [];
  const navItems = [];

  for (const item of items) {
    const id = text(item['wp:post_id']);
    const type = text(item['wp:post_type']);
    const status = text(item['wp:status']);
    const slug = text(item['wp:post_name']);
    const title = text(item.title);
    const content = text(item['content:encoded']);
    const excerpt = text(item['excerpt:encoded']);
    const link = text(item.link);
    const creator = text(item['dc:creator']);
    const postDate = text(item['wp:post_date']);
    const modified = text(item['wp:post_modified']);

    const record = {
      id,
      type,
      status,
      slug,
      title,
      content,
      excerpt,
      link,
      creator,
      postDate,
      modified,
      parent: text(item['wp:post_parent']),
      menuOrder: Number(text(item['wp:menu_order']) || 0),
      categories: getCategories(item),
      tags: getTags(item),
      thumbnailId: getMeta(item, '_thumbnail_id'),
      attachmentUrl: text(item['wp:attachment_url']),
      attachedFile: getMeta(item, '_wp_attached_file'),
      menuMeta: {},
    };

    if (type === 'nav_menu_item') {
      record.menuMeta = {
        type: getMeta(item, '_menu_item_type'),
        objectId: getMeta(item, '_menu_item_object_id'),
        object: getMeta(item, '_menu_item_object'),
        parent: getMeta(item, '_menu_item_menu_item_parent'),
        url: getMeta(item, '_menu_item_url'),
      };
      navItems.push(record);
    }

    if (type === 'attachment') {
      attachments[id] = record;
    }

    byId[id] = record;

    if (status === 'publish') {
      if (type === 'post') posts.push(record);
      if (type === 'page') pages.push(record);
    }
  }

  return { authors, byId, attachments, posts, pages, navItems };
}

async function downloadFile(url, dest) {
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; migration-bot/1.0)' },
    });
    if (!res.ok) {
      console.warn(`Failed to download ${url}: ${res.status}`);
      return;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
  } catch (err) {
    console.warn(`Error downloading ${url}:`, err.message);
  }
}

async function downloadMedia(allRecords, attachments) {
  const urls = new Set();
  const regex = /https:\/\/slaapkamerinspiratie\.nl\/wp-content\/uploads\/([^\s"'<>]+)/g;

  for (const record of allRecords) {
    let m;
    while ((m = regex.exec(record.content)) !== null) {
      urls.add(m[0].split('?')[0]);
    }
  }

  for (const att of Object.values(attachments)) {
    if (att.attachmentUrl) urls.add(att.attachmentUrl.split('?')[0]);
    if (att.attachedFile) urls.add(`${SITE_URL}/wp-content/uploads/${att.attachedFile}`);
  }

  console.log(`Downloading ${urls.size} media files...`);
  let done = 0;
  const batchSize = 10;
  const urlList = [...urls];

  for (let i = 0; i < urlList.length; i += batchSize) {
    const batch = urlList.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (url) => {
        const rel = url.replace(`${SITE_URL}/wp-content/uploads/`, '');
        const dest = path.join(PUBLIC_UPLOADS, rel);
        await downloadFile(url, dest);
        done++;
      })
    );
    if (done % 50 === 0 || done === urlList.length) {
      console.log(`  ${done}/${urlList.length}`);
    }
  }
}

function resolveNavUrl(navItem, byId) {
  const { type, objectId, url } = navItem.menuMeta;
  if (type === 'custom' && url) {
    if (url === '#') return '#';
    return url.replace(SITE_URL, '').replace(/\/$/, '') || '/';
  }
  if (objectId && byId[objectId]) {
    const target = byId[objectId];
    if (target.slug === 'home') return '/';
    if (target.slug === 'blog') return '/blog';
    return `/${target.slug}`;
  }
  return url ? url.replace(SITE_URL, '').replace(/\/$/, '') || '/' : '#';
}

function buildNavigation(navItems, byId) {
  const mainMenu = navItems
    .filter((n) => n.status === 'publish')
    .sort((a, b) => a.menuOrder - b.menuOrder);

  const items = mainMenu.map((n) => {
    const linked = n.menuMeta.objectId ? byId[n.menuMeta.objectId] : null;
    const label =
      n.title ||
      linked?.title ||
      resolveNavUrl(n, byId).split('/').filter(Boolean).pop()?.replace(/-/g, ' ') ||
      'Link';
    const href = resolveNavUrl(n, byId);
    const normalizedHref = href === '/' ? '/' : href.startsWith('/') ? `${href}/` : `/${href}/`;
    return {
      id: n.id,
      label,
      href: normalizedHref === '//' ? '/' : normalizedHref,
      parentId: n.menuMeta.parent !== '0' ? n.menuMeta.parent : null,
      order: n.menuOrder,
    };
  });

  function dedupeSiblings(nodes) {
    const seen = new Set();
    return nodes.filter((node) => {
      if (seen.has(node.href)) return false;
      seen.add(node.href);
      return true;
    });
  }

  function buildTree(parentId = null) {
    return dedupeSiblings(
      items
        .filter((i) => i.parentId === parentId)
        .sort((a, b) => a.order - b.order)
        .map((i) => ({
          label: i.label,
          href: i.href,
          children: buildTree(i.id),
        }))
    );
  }

  return buildTree(null);
}

function buildFooterNav(pages, posts) {
  const useful = pages.filter((p) =>
    ['contact', 'blog', 'sitemap', 'bedden', 'dekbed', 'interieur', 'kledingkasten', 'verlichting'].includes(
      p.slug
    )
  );
  const footer = useful.map((p) => ({
    label: p.title || p.slug,
    href: p.slug === 'home' ? '/' : p.slug === 'blog' ? '/blog/' : `/${p.slug}/`,
  }));
  if (!footer.find((f) => f.href === '/')) {
    footer.unshift({ label: 'Home', href: '/' });
  }
  return footer;
}

function writeBlogPost(post, authors, attachments) {
  const slug = post.slug;
  if (!slug) return;

  const body = htmlToMdxBody(post.content);
  const description = extractDescription(post.excerpt, post.content, post.title);
  const author = authors[post.creator] || post.creator || 'admin';
  const categories = post.categories.length ? post.categories : ['Blog'];
  const tags = post.tags;

  const frontmatter = [
    '---',
    `title: ${escapeYaml(post.title)}`,
    `description: ${escapeYaml(description)}`,
    `pubDate: ${post.postDate.split(' ')[0]}`,
    post.modified !== post.postDate ? `updatedDate: ${post.modified.split(' ')[0]}` : null,
    `author: ${escapeYaml(author)}`,
    `categories:`,
    ...categories.map((c) => `  - ${escapeYaml(c)}`),
    tags.length ? `tags:` : `tags: []`,
    ...tags.map((t) => `  - ${escapeYaml(t)}`),
    '---',
  ]
    .filter(Boolean)
    .join('\n');

  fs.writeFileSync(path.join(BLOG_DIR, `${slug}.mdx`), `${frontmatter}\n\n${body}\n`);
}

function writePage(page) {
  const slug = page.slug;
  if (!slug || SKIP_PAGE_SLUGS.has(slug)) return;

  const body = sanitizeHtml(page.content);
  const title = page.title || slug;
  const description = extractDescription(page.excerpt, page.content, title);

  fs.writeFileSync(path.join(PAGE_DATA_DIR, `${slug}.html`), body);

  const file = `---
import PageLayout from '../layouts/PageLayout.astro';
import pageHtml from '../data/pages/${slug}.html?raw';

const title = ${JSON.stringify(title)};
const description = ${JSON.stringify(description)};
---

<PageLayout title={title} description={description}>
  <article class="page-content" set:html={pageHtml} />
</PageLayout>
`;

  if (slug === 'home') {
    fs.writeFileSync(path.join(PAGES_DIR, 'index.astro'), file);
    return;
  }

  fs.writeFileSync(path.join(PAGES_DIR, `${slug}.astro`), file);
}

function writeSitemapPage(pages, posts) {
  const pageLinks = pages
    .filter((p) => p.slug && !SKIP_PAGE_SLUGS.has(p.slug))
    .map((p) => ({
      label: p.title || p.slug,
      href: p.slug === 'home' ? '/' : `/${p.slug}/`,
    }));

  const postLinks = posts.map((p) => ({
    label: p.title,
    href: `/${p.slug}/`,
  }));

  const file = `---
import PageLayout from '../layouts/PageLayout.astro';

const pages = ${JSON.stringify(pageLinks, null, 2)};
const posts = ${JSON.stringify(postLinks, null, 2)};
---

<PageLayout title="Sitemap" description="Overzicht van alle pagina's en blogartikelen op slaapkamerinspiratie.nl">
  <article class="page-content">
    <h1>Sitemap</h1>
    <h2>Pagina's</h2>
    <ul>
      {pages.map((page) => (
        <li><a href={page.href}>{page.label}</a></li>
      ))}
    </ul>
    <h2>Blogartikelen</h2>
    <ul>
      {posts.map((post) => (
        <li><a href={post.href}>{post.label}</a></li>
      ))}
    </ul>
  </article>
</PageLayout>
`;
  fs.writeFileSync(path.join(PAGES_DIR, 'sitemap.astro'), file);
}

function collectProductSlugs(items, posts, pages) {
  const knownSlugs = new Set();
  for (const p of posts) knownSlugs.add(p.slug);
  for (const p of pages) knownSlugs.add(p.slug);

  const productSlugs = new Set();
  const slugRe = /https:\/\/slaapkamerinspiratie\.nl\/(beste-[a-z0-9-]+)/g;

  for (const item of items) {
    const content = text(item['content:encoded']);
    for (const match of content.matchAll(slugRe)) {
      if (!knownSlugs.has(match[1])) productSlugs.add(match[1]);
    }
    for (const meta of ensureArray(item['wp:postmeta'])) {
      const val = text(meta['wp:meta_value']);
      for (const match of val.matchAll(slugRe)) {
        if (!knownSlugs.has(match[1])) productSlugs.add(match[1]);
      }
    }
  }

  return [...productSlugs].sort();
}

async function main() {
  console.log('Parsing WordPress export...');
  const { authors, byId, attachments, posts, pages, navItems } = parseItems();
  const xml = fs.readFileSync(XML_PATH, 'utf-8');
  const data = parser.parse(xml);
  const items = ensureArray(data.rss.channel.item);

  console.log(
    `Found ${posts.length} posts, ${pages.length} pages, ${Object.keys(attachments).length} attachments`
  );

  fs.mkdirSync(BLOG_DIR, { recursive: true });
  fs.mkdirSync(PAGES_DIR, { recursive: true });
  fs.mkdirSync(PAGE_DATA_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(NAV_PATH), { recursive: true });

  const allRecords = [...posts, ...pages];
  await downloadMedia(allRecords, attachments);

  console.log('Writing blog posts...');
  for (const post of posts) {
    writeBlogPost(post, authors, attachments);
  }

  console.log('Writing pages...');
  for (const page of pages) {
    writePage(page);
  }
  writeSitemapPage(pages, posts);

  const headerNav = buildNavigation(navItems, byId);
  const footerNav = buildFooterNav(pages, posts);
  const productSlugs = collectProductSlugs(items, posts, pages);

  fs.writeFileSync(NAV_PATH, JSON.stringify({ header: headerNav, footer: footerNav }, null, 2));

  fs.writeFileSync(
    PRODUCT_SLUGS_PATH,
    `export const PRODUCT_SLUGS = ${JSON.stringify(productSlugs, null, 2)} as const;\n`
  );

  console.log('Migration complete!');
  console.log(`  Blog posts: ${posts.length}`);
  console.log(`  Pages: ${pages.length}`);
  console.log(`  Nav items: ${headerNav.length} top-level`);
  console.log(`  Product slugs to scrape: ${productSlugs.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
