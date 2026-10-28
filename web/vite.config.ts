import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';

// Bij npm run dev draait Vite op 3080 en stuurt API-verzoeken door naar de server op 3000.
const SERVER = `http://localhost:${process.env.SERVER_PORT ?? 3000}`;

/**
 * Bouwt src/sw.ts als /sw.js (vaste naam, zonder hash) en vult __PRECACHE__ en __BUILD_ID__ in:
 * de lijst met gebouwde bestanden die offline beschikbaar moeten zijn, en een id dat bij elke wijziging verandert.
 */
function serviceWorker(): Plugin {
  const fill = (code: string, files: string[], buildId: string) =>
    code.replace('__PRECACHE__', JSON.stringify(files)).replace('__BUILD_ID__', JSON.stringify(buildId));

  return {
    name: 'ehbo-service-worker',
    enforce: 'post',
    configureServer(server) {
      // Ontwikkelen: dezelfde service worker, maar zonder precache; Vite levert alles vers.
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] !== '/sw.js') return next();
        try {
          const result = await server.transformRequest('/src/sw.ts');
          res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          res.setHeader('Service-Worker-Allowed', '/');
          // De service worker is een gewoon script, geen module: de lege export van de transformatie moet eruit.
          res.end(fill(result?.code ?? '', [], 'dev').replace(/^export \{\s*\};?$/m, ''));
        } catch (err) {
          next(err);
        }
      });
    },
    generateBundle(_options, bundle) {
      const sw = bundle['sw.js'];
      if (sw?.type !== 'chunk') return;
      // .woff is alleen een terugval voor oude browsers; elke browser die de app kan installeren gebruikt .woff2.
      const names = Object.keys(bundle).filter((name) => name !== 'sw.js' && !/\.(map|woff)$/.test(name)).sort();
      const hash = createHash('sha256');
      for (const name of names) {
        const item = bundle[name]!;
        hash.update(name).update(item.type === 'chunk' ? item.code : item.source);
      }
      sw.code = fill(sw.code, names.map((name) => `/${name}`), hash.digest('hex').slice(0, 12));
    },
  };
}

export default defineConfig({
  plugins: [vue(), serviceWorker()],
  server: {
    port: 3080,
    strictPort: true,
    proxy: { '/api': SERVER, '/healthz': SERVER },
  },
  build: {
    rolldownOptions: {
      input: { index: 'index.html', sw: 'src/sw.ts' },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
