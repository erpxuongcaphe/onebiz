# Print preparation latency, 30 October 2026

## Evidence and boundaries

At Tu Bua on 29 October, 18:00–24:00 Vietnam time, the sampled 49 completed queue jobs had mean enqueue-to-claim 2.75s and claim-to-finish 0.49s. Ten exceeded 5s overall; maximum 9.90s. Earlier at 17:24, HD003506 waited 149.39s to be claimed and then finished in 0.52s. This establishes a queue/receiver availability delay for that ticket, not a slow bitmap by itself. It does not establish why the receiver was unavailable.

These database timestamps exclude browser rendering and do not measure physical paper completion. `handed_off` is acceptance by the transport/Windows, not a printer sensor confirmation. The installed receiver version and Windows port must be checked separately; a printer display name does not establish USB versus LAN.

## This change

- Dispatch reads an authorized point/routing projection instead of querying/sorting fifty historical jobs. There is no routing cache that could survive a route, user or branch change; enqueue revalidates the route and paper.
- Routing and renderer module loading run concurrently. Image decoding, font readiness and renderer loading also run concurrently before drawing.
- Marked business logo conversions are reused for at most 60s, with four entries and a 256KiB retention threshold per asset. Failed/oversized assets are evicted. Receipt content and payment QR images are never reused. The iframe/browser may still perform its normal image loading; this is not a claim of eliminating every image network request.
- Browser prepare/render/base64 durations accompany the existing enqueue RPC. No dedicated telemetry RPC, timer or background database poll is added. Values are bounded, client-reported diagnostic metadata; legacy jobs remain null. A repeated request retains its original timing and job identity.
- No change to printing status semantics, receiver polling, claim ownership, stale-ticket review, unknown-send replay protection or installed programs at cafés.

## Release and rollback

Apply `20261030030229_print_dispatch_preparation.sql` before deploying the web. It adds one nullable column and two functions, retaining v1 for old browsers and receivers. Lock acquisition is bounded to two seconds; stop on failure rather than repeatedly retrying during service. Verify function privileges and branch guards before web release. Never print a real bill as part of migration verification.

Rollback the web if needed; keep additive functions/column for outstanding requests. Do not drop columns/functions while browsers may still call them. Existing receiver binaries require no update for this change.

## Remaining architectural work

The current receiver's idle poll may wait up to five seconds. This change does not remove that wait. Reducing polling to a permanent tight loop would increase database load and is not the chosen solution.

An event wake channel needs device-scoped authentication, reconnect/cooldown, bounded fallback polling and a burst test. Do not expose queue rows, receiver credentials or customer data through public Realtime channels. Notifications must only wake the existing atomic claim path, never instruct physical printing directly. An event lost during a disconnect must recover through the existing queue; uncertain physical sends must remain non-replayable.

A text-first ESC/POS renderer could reduce raster work further, but needs verified Vietnamese glyph/font support and parity for logo, QR, modifiers and 58/80mm paper. Do not replace current rendering blindly on live printers.

References: https://supabase.com/docs/guides/realtime/broadcast ; https://learn.microsoft.com/en-us/windows/win32/printdocs/writeprinter
