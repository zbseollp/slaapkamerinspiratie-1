#!/usr/bin/env node
/**
 * Download homepage CSS assets from live slaapkamerinspiratie.nl.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITE = 'https://slaapkamerinspiratie.nl';

const CSS_FILES = [
  {
    url: `${SITE}/wp-content/themes/hello-elementor/assets/css/reset.css?ver=3.4.4`,
    dest: 'public/css/theme/reset.css',
  },
  {
    url: `${SITE}/wp-content/themes/hello-elementor/assets/css/theme.css?ver=3.4.4`,
    dest: 'public/css/theme/theme.css',
  },
  {
    url: `${SITE}/wp-content/themes/hello-elementor/assets/css/header-footer.css?ver=3.4.4`,
    dest: 'public/css/theme/header-footer.css',
  },
  {
    url: `${SITE}/wp-content/plugins/elementor/assets/css/frontend.min.css?ver=4.1.4`,
    dest: 'public/css/elementor/frontend.min.css',
  },
  {
    url: `${SITE}/wp-content/uploads/elementor/css/post-9.css?ver=1782263547`,
    dest: 'public/css/elementor/post-9.css',
  },
  {
    url: `${SITE}/wp-content/plugins/elementor/assets/css/widget-image.min.css?ver=4.1.4`,
    dest: 'public/css/elementor/widget-image.min.css',
  },
  {
    url: `${SITE}/wp-content/plugins/elementor-pro/assets/css/widget-nav-menu.min.css?ver=4.1.2`,
    dest: 'public/css/elementor/widget-nav-menu.min.css',
  },
  {
    url: `${SITE}/wp-content/plugins/elementor/assets/css/widget-heading.min.css?ver=4.1.4`,
    dest: 'public/css/elementor/widget-heading.min.css',
  },
  {
    url: `${SITE}/wp-content/plugins/elementor-pro/assets/css/widget-search-form.min.css?ver=4.1.2`,
    dest: 'public/css/elementor/widget-search-form.min.css',
  },
  {
    url: `${SITE}/wp-content/plugins/elementor/assets/lib/font-awesome/css/fontawesome.min.css?ver=5.15.3`,
    dest: 'public/css/elementor/fontawesome.min.css',
  },
  {
    url: `${SITE}/wp-content/plugins/elementor/assets/lib/font-awesome/css/regular.min.css?ver=5.15.3`,
    dest: 'public/css/elementor/regular.min.css',
  },
  {
    url: `${SITE}/wp-content/plugins/elementor/assets/lib/font-awesome/css/solid.min.css?ver=5.15.3`,
    dest: 'public/css/elementor/solid.min.css',
  },
  {
    url: `${SITE}/wp-content/plugins/elementor/assets/css/widget-social-icons.min.css?ver=4.1.4`,
    dest: 'public/css/elementor/widget-social-icons.min.css',
  },
  {
    url: `${SITE}/wp-content/plugins/elementor/assets/css/conditionals/apple-webkit.min.css?ver=4.1.4`,
    dest: 'public/css/elementor/apple-webkit.min.css',
  },
  {
    url: `${SITE}/wp-content/plugins/elementor-pro/assets/css/widget-posts.min.css?ver=4.1.2`,
    dest: 'public/css/elementor/widget-posts.min.css',
  },
  {
    url: `${SITE}/wp-content/plugins/elementor/assets/lib/eicons/css/elementor-icons.min.css?ver=5.44.0`,
    dest: 'public/css/elementor/elementor-icons.min.css',
  },
  {
    url: `${SITE}/wp-content/plugins/elementor/assets/css/widget-icon-box.min.css?ver=4.1.4`,
    dest: 'public/css/elementor/widget-icon-box.min.css',
  },
  {
    url: `${SITE}/wp-content/uploads/elementor/css/post-18.css?ver=1782263658`,
    dest: 'public/css/elementor/post-18.css',
  },
  {
    url: `${SITE}/wp-content/uploads/elementor/css/post-11.css?ver=1782263548`,
    dest: 'public/css/elementor/post-11.css',
  },
  {
    url: `${SITE}/wp-content/uploads/elementor/css/post-15.css?ver=1782263549`,
    dest: 'public/css/elementor/post-15.css',
  },
  {
    url: `${SITE}/wp-content/uploads/elementor/google-fonts/css/questrial.css?ver=1742228722`,
    dest: 'public/css/fonts/questrial.css',
  },
  {
    url: `${SITE}/wp-content/uploads/elementor/google-fonts/css/roboto.css?ver=1742228722`,
    dest: 'public/css/fonts/roboto.css',
  },
  {
    url: `${SITE}/wp-content/plugins/elementor/assets/lib/font-awesome/css/brands.min.css?ver=5.15.3`,
    dest: 'public/css/elementor/brands.min.css',
  },
  {
    url: `${SITE}/wp-content/plugins/elementor/assets/css/widget-text-editor.min.css?ver=4.1.4`,
    dest: 'public/css/elementor/widget-text-editor.min.css',
  },
];

async function downloadFile(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; migration-bot/1.0)' },
  });
  if (!res.ok) throw new Error(`Failed ${url}: ${res.status}`);
  return res.text();
}

function rewriteCssUrls(content) {
  return content
    .replaceAll(SITE, '')
    .replaceAll('/wp-content/uploads/', '/uploads/')
    .replace(/url\((['"]?)(https?:\/\/[^)'"]+)(['"]?)\)/g, (_match, q1, url, q2) => {
      const local = url
        .replace(SITE, '')
        .replace('/wp-content/uploads/', '/uploads/')
        .replace('/wp-content/plugins/elementor/assets/lib/eicons/fonts/', '/fonts/eicons/')
        .replace('/wp-content/plugins/elementor/assets/lib/font-awesome/webfonts/', '/fonts/fontawesome/');
      return `url(${q1}${local}${q2})`;
    })
    .replace(/url\(\.\.\/fonts\/(eicons\.[^)]+)\)/g, 'url(/fonts/eicons/$1)')
    .replace(/url\(\.\.\/webfonts\/([^)]+)\)/g, 'url(/fonts/fontawesome/$1)');
}

async function downloadFontsFromCss(cssContent) {
  const fontUrls = new Set();
  for (const match of cssContent.matchAll(/url\(['"]?([^)'"]+\.(?:woff2?|ttf|eot|svg))['"]?\)/gi)) {
    if (match[1].startsWith('/')) fontUrls.add(match[1]);
  }

  for (const fontPath of [...fontUrls].sort()) {
    const destPath = path.join(ROOT, 'public', fontPath);
    if (fs.existsSync(destPath)) continue;

    let remotePath = fontPath;
    if (fontPath.startsWith('/uploads/')) {
      remotePath = `/wp-content/uploads/${fontPath.replace('/uploads/', '')}`;
    } else if (fontPath.startsWith('/fonts/eicons/')) {
      remotePath = `/wp-content/plugins/elementor/assets/lib/eicons/fonts/${fontPath.replace('/fonts/eicons/', '')}`;
    } else if (fontPath.startsWith('/fonts/fontawesome/')) {
      remotePath = `/wp-content/plugins/elementor/assets/lib/font-awesome/webfonts/${fontPath.replace('/fonts/fontawesome/', '')}`;
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const res = await fetch(`${SITE}${remotePath}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; migration-bot/1.0)' },
    });
    if (!res.ok) {
      console.warn(`  Font download failed: ${remotePath} (${res.status})`);
      continue;
    }
    fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
    console.log(`  Font: ${fontPath}`);
  }
}

async function main() {
  console.log('Downloading homepage CSS...');
  for (const { url, dest } of CSS_FILES) {
    const destPath = path.join(ROOT, dest);
    let content = await downloadFile(url);
    content = rewriteCssUrls(content);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content);
    console.log(`  CSS: ${dest}`);

    if (
      dest.includes('questrial.css') ||
      dest.includes('roboto.css') ||
      dest.includes('elementor-icons') ||
      dest.includes('fontawesome') ||
      dest.includes('regular') ||
      dest.includes('brands')
    ) {
      await downloadFontsFromCss(content);
    }
  }

  for (const fontCss of ['elementor-icons.min.css', 'fontawesome.min.css', 'regular.min.css', 'solid.min.css', 'brands.min.css']) {
    const p = path.join(ROOT, 'public/css/elementor', fontCss);
    if (fs.existsSync(p)) await downloadFontsFromCss(fs.readFileSync(p, 'utf8'));
  }

  for (const fontCss of ['questrial.css', 'roboto.css']) {
    const p = path.join(ROOT, 'public/css/fonts', fontCss);
    if (fs.existsSync(p)) await downloadFontsFromCss(fs.readFileSync(p, 'utf8'));
  }

  console.log('Homepage CSS download complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
