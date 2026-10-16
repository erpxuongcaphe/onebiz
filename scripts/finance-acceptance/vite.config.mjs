import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures.ts', import.meta.url));
export default defineConfig({
 root: fileURLToPath(new URL('./', import.meta.url)),
 esbuild: {jsx: 'automatic'},
 resolve: {alias: [
  ...['@/lib/contexts','@/lib/services/supabase/payments','@/lib/services/supabase/debt-workspace','@/lib/services/supabase/cash-book','@/lib/services/supabase/money-accounts'].map(find => ({find,replacement:fixture})),
  {find:'@',replacement:root+'src'},
 ]},
 css: {postcss:root},
 server: {host:'127.0.0.1',port:4187,strictPort:true,fs:{allow:[root]}},
});
