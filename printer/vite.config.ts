import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      // Base path: GitHub Pages serves the repo under its name; the one-site
      // build (site/build.mjs) serves this at the root of awana.kvbchurch.org
      // and sets SITE_BASE=/.
      base: process.env.SITE_BASE || '/Print-TwoTimTwo-Labels/',
      server: {
        port: 3000,
        host: '0.0.0.0',
        // The home page draws the lobby's brand kit (shared/brand: its
        // shapes, doodles and club marks), imported from its one copy.
        fs: { allow: ['..'] },
      },
      plugins: [
        react(),
        // Compiled Tailwind v4 (was the runtime cdn.tailwindcss.com script).
        // Scanning is pinned to the site's own files in styles/site.css.
        tailwindcss(),
      ],
      build: {
        rollupOptions: {
          // The public pages: the home page (index: the demo reel, the six
          // parts and the simulator), the install guide and FAQ (help, served
          // at /help) and the capabilities/roadmap reference (capabilities).
          input: {
            main: path.resolve(__dirname, 'index.html'),
            help: path.resolve(__dirname, 'help.html'),
            capabilities: path.resolve(__dirname, 'capabilities.html'),
          },
        },
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
