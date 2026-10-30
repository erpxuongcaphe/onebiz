import { createClient } from 'npm:@supabase/supabase-js@2.101.1';
import { handlePrintWake } from './handler.mjs';

const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
// Each stream owns one subscription. It never queries jobs and closes within
// 100s, so disabled/revoked points must reauthenticate on renewal.
Deno.serve(request => handlePrintWake(request, {
  async authorize(pointId, token) {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.rpc('fnb_print_wake_authorize_v1', { p_point: pointId, p_token: token }).abortSignal(AbortSignal.timeout(5000));
    return !error && data === true;
  },
  subscribe(pointId, wake, ready, close) {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    let settled = false;
    const deadline = setTimeout(close, 8000);
    const channel = client.channel(`fnb-print:${pointId}`, { config: { private: true } })
      .on('broadcast', { event: 'wake' }, wake)
      .subscribe(status => {
        if (status === 'SUBSCRIBED' && !settled) { settled = true; clearTimeout(deadline); ready(); }
        if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) close();
      });
    return () => { clearTimeout(deadline); void client.removeChannel(channel); };
  },
  waitUntil(promise) { EdgeRuntime.waitUntil(promise); },
}));
