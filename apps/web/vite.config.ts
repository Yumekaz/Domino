import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiToken = process.env.DOMINO_API_TOKEN || env.DOMINO_API_TOKEN;
  return {
    plugins: [react(), tailwindcss()],
    server: {
      fs: { allow: [searchForWorkspaceRoot(process.cwd()), repoRoot] },
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
          ...(apiToken
            ? { headers: { Authorization: `Bearer ${apiToken}` } }
            : {}),
        },
      },
    },
  };
});
