# Win7 receipt receiver 2026.10.25.1

Requires .NET Framework 4.8 and the `202610250400_fnb_print_recoverable_claim` server migration. Startup verifies the server capability before claiming any job.

The receiver persists a random claim request ID before contacting the server. If the HTTP response is lost, it retrieves the same assignment with that ID. It writes the existing durable unknown-outcome journal before touching the physical printer, then retires the claim intent. On restart, a pending send journal is acknowledged before another claim; printer bytes are never replayed from a journal. A repeated finish is idempotent only for the same point, claim, job and final status. Expired or management-cancelled jobs remain unrecoverable without explicit management review.

The migration remains compatible with old agents. The one-sending-job guard, 2 minute ambiguity limit and 5 minute old-queue hold remain in place. This repairs recovery after lost cloud responses; it does not prove that TCP receipt equals paper printed or eliminate failures of the underlying connection.

## Update at the counter during a quiet period

1. Review unresolved tickets in Onebiz; do not automatically reprint them.
2. Stop only the print receiver at the counter; keep POS open.
3. Back up the current OnebizWin7.exe. Replace that executable only, preserving onebiz-print-point.json, all pending-ack/pending-claim files and the existing startup launcher/input/marker.
4. Start the existing launcher. Confirm the displayed version is 2026.10.25.1 and there is only one receiver. The server capability check must succeed.
5. Send one new test ticket and have someone at the counter confirm the paper. Then test several new tickets in sequence, checking one paper per ticket and visible errors for a disconnected printer.
6. Retain the old executable for rollback. If a pending-claim file exists, resolve that assignment with this version before downgrading; do not delete journals or silently fall back to an older receiver.

No credentials, printer routes or queues are bundled. No automatic Windows restart, driver change or network change is required. Existing scheduled autostart remains unchanged.

## Validation

The SQL integration suite covers legacy queue/access behavior, lost claim responses, idempotent acknowledgements, terminal/expired claim guards and 50 sequential tickets with deliberately discarded responses. CI also runs real PostgreSQL concurrent ownership tests. The .NET tests use loopback HTTP, disposable journals and a fake TCP printer; they never connect to a live queue or physical device.
