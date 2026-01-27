import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const isPos = env.VITE_APP_MODE === 'pos';
    return {
      server: {
        port: isPos ? 3001 : 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      build: {
        sourcemap: false,
        reportCompressedSize: false,
        rollupOptions: {
          output: {
            manualChunks(id) {
              if (!id.includes('node_modules')) return;

              if (
                id.includes('react-dom') ||
                id.includes('/react/') ||
                id.includes('scheduler') ||
                id.includes('use-sync-external-store') ||
                id.includes('react-is') ||
                id.includes('object-assign') ||
                id.includes('loose-envify')
              ) {
                return 'react';
              }
              if (id.includes('@supabase/supabase-js')) return 'supabase';
              if (id.includes('recharts')) return 'charts';
              if (id.includes('lucide-react')) return 'icons';
              return 'vendor';
            },
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
