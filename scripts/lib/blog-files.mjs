/** Shared helpers for the scripts/*-blog.mjs content passes. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const BLOG_DIR = 'src/content/blog';

export function listBlogFiles(dir = BLOG_DIR) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listBlogFiles(path));
    else if (/\.mdx?$/.test(entry.name)) files.push(path);
  }
  return files.sort();
}

export function splitFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: '', body: raw, hasFrontmatter: false };
  return {
    frontmatter: match[1],
    body: raw.slice(match[0].length),
    hasFrontmatter: true,
  };
}

/**
 * Read one frontmatter field.
 *
 * Handles YAML block scalars (`pubDate: |` with the value on the following
 * indented lines) as well as inline values. Some migrations write every field
 * that way; reading only the inline part returned a literal "|" and made every
 * post look like it had an unparseable date.
 */
export function readField(frontmatter, field) {
  const match = frontmatter.match(new RegExp(`^${field}:[ \\t]*(.*)$`, 'm'));
  if (!match) return null;

  const inline = match[1].trim();
  if (!/^[|>][-+]?\d*$/.test(inline)) {
    return inline.replace(/^["']|["']$/g, '') || null;
  }

  // Block scalar: take the indented lines that follow.
  const after = frontmatter.slice(match.index + match[0].length).split('\n').slice(1);
  const lines = [];
  for (const line of after) {
    if (line.trim() === '') {
      if (lines.length === 0) continue;
      break;
    }
    if (!/^\s/.test(line)) break;
    lines.push(line.trim());
  }
  return lines.join(' ').trim().replace(/^["']|["']$/g, '') || null;
}

export function slugOf(path) {
  return path.split('/').pop().replace(/\.mdx?$/, '');
}

export function readPost(path) {
  const raw = readFileSync(path, 'utf8');
  const { frontmatter, body, hasFrontmatter } = splitFrontmatter(raw);
  return { path, raw, frontmatter, body, hasFrontmatter, slug: slugOf(path) };
}

export function exists(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
