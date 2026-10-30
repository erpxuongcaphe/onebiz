# Private print wake and durable receiver recovery

## Behavior

PR #874 already reduces browser preparation and route reads. This change addresses the next stage: the receiver's idle wait and acknowledgement recovery. It does not replace the USB/LAN transport, bill rendering, printer driver, or autostart supervisor.

- A database trigger broadcasts an empty private hint when a job becomes queued at an opted-in point. A server-side Edge Function authenticates the installed point token, subscribes only to that point, and forwards constant SSE events. No bill, printer bytes, token, customer data, or service credential is in a notification.
- Node and Win7 interrupt idle sleep on the hint, then use the existing authenticated atomic claim. They drain successive jobs without a polling pause between successful finishes. Reconnect readiness also triggers a claim, covering jobs created during reconnection.
- The stream lasts at most 100 seconds. Keepalive comments occur every 15 seconds without querying PostgreSQL. A healthy connected receiver retains a 15-second fallback claim; without the stream it uses idle backoff of 1/2/5 seconds. Failed HTTP authentication waits five minutes; other failures have bounded backoff and jitter. Wake signals do not interrupt RPC failure cooldowns.
- Node now persists a recoverable claim intent before requesting a job and an unknown-outcome journal before physical transmission, matching the existing Win7 recovery protocol. It persists the final result before acknowledging. Restart or lost acknowledgement retries that result, never the printer bytes. Expired claims are archived for review. Corrupt journals stop new claims rather than silently dropping uncertainty.
- Node acquires an exclusive loopback lease for its point; the listener discards connections and exposes no API. A collision fails closed. Do not mix Node and Win7 receivers for one point: their process locks are different. The installer stops/verifies the old receiver before replacement.

`handed_off` means Windows/the transport accepted the job, not that a paper sensor confirmed output. An uncertain send still requires checking paper before a deliberate reprint. No automatic replay of old/uncertain tickets is added.

## Load budget and privacy

`fnb_print_points.wake_enabled` defaults to false. Existing points incur no Realtime broadcast until explicitly enabled. The authorization RPC is executable only by service_role. No anonymous/authenticated Realtime policy is added. The service credential remains in the Edge runtime; the point credential travels only in the bounded POST body, never in a URL or logs.

For a fully idle healthy point, a 15-second fallback is approximately 240 claim calls/hour rather than 720 at 5 seconds or 3,600 at 1 second, plus roughly 36 stream authorizations/hour and readiness checks. These are design estimates, not measured production throughput; selling adds normal claims/finishes. One small Realtime write is added per queued job at an enabled point. The stream does not poll the database or enumerate printers. Initial deployment must remain limited to one point, with bounded measurements, not a production load test.

The trigger catches Realtime failures and uses a 100ms lock timeout; ordinary polling remains available. This still adds work inside the enqueue transaction, so measure enqueue latency before wider activation. Turn off the flag if enqueue or database latency regresses.

## Rollout order

1. Require green application, isolated PostgreSQL/concurrency, Windows receiver and Edge module checks on the exact PR revision. Compile the Win7 artifact from that revision. Do not copy an unverified local EXE.
2. Apply `20261030051557_print_private_wake.sql` with its short lock/statement deadlines, leaving every point's flag false. Deploy `supabase/functions/print-wake` with gateway JWT verification disabled as configured; the handler performs point authorization. Verify missing/invalid credentials are rejected and no public Realtime policies were introduced. Never log/request installed tokens in chat.
3. At one agreed quiet counter, inspect unresolved jobs and preserve the current program, config, autostart and journals. Update the receiver once using the existing guarded installer (Node) or the Win7 procedure. Verify exactly one receiver and a new test ticket on paper. Do not restart Windows or replay a real ticket to test this.
4. Enable `wake_enabled` for that exact point only after the new receiver is confirmed. Verify a fresh test after an idle period, a short sequence of distinct test tickets, disconnect/reconnect recovery, and one paper per ticket. Use test tickets, not revenue transactions. Compare preparation, created-to-claim, send and finish timings separately; paper confirmation is still needed.
5. Review the first point's bounded observations before updating the other Windows/Win7 point. A later reboot test should be agreed with the counter; the startup mechanism itself is unchanged.

No steps above have been performed merely by creating this document. A built package is not a completed counter installation.

## Rollback

First disable the point's `wake_enabled`. Connected streams expire within 100 seconds and revert to ordinary polling; set local `wakeEnabled:false` at the next controlled receiver restart if needed. Keep the durable recovery-capable receiver in place where possible.

Do not delete `pending-send-*.json`, Win7 pending-ack/pending-claim files, or their expired review records. Do not downgrade to a Node version that ignores a pending journal. Resolve/acknowledge the outstanding assignment with the recovery-capable version, verify the queue, then stop the receiver and restore the backed-up program if necessary. Keep the additive server migration; older clients remain supported. Disable the trigger or remove the Edge Function only through a reviewed rollback if turning off the point flags is insufficient.

## Validation and references

Local tests simulate lost claim/finish responses, restart uncertainty, corrupt/cross-point journals, exclusive receiver ownership, 100 consecutive jobs, wake bursts, unauthorized/oversized requests, cancellation and stream expiry. Windows CI runs the .NET loopback/fake-printer suites. PostgreSQL CI runs the complete existing print suite plus private wake and concurrent claim checks. None sends paper or traffic to a café during CI.

Primary design references: [Supabase private Realtime authorization](https://supabase.com/docs/guides/realtime/authorization), [database Broadcast](https://supabase.com/docs/guides/realtime/broadcast), and [Edge persistent connection constraints](https://supabase.com/docs/guides/functions/websockets).

Win7 compatibility follow-up: Supabase announced [CBC TLS cipher deprecation](https://supabase.com/changelog/cbc-tls-ciphers-deprecated), with changes starting 10 November 2026. Verify the actual counter's negotiated TLS compatibility separately; do not attribute today's delays to that future change or promise this code updates Windows TLS support.
