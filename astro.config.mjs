import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://slaapkamerinspiratie.nl',
  trailingSlash: 'always',
  integrations: [mdx()],
});
