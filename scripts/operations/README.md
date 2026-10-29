# Lightweight production monitoring

`monitor.py` runs independently of Vercel/Supabase on the existing Hetzner host.
It checks the ONEBIZ database health endpoint, ONEBIZ login page and xuongcaphe
homepage every five minutes. It makes GET requests only; it has no database
credentials and does not submit payments or print jobs.

Each HTTP request has an eight-second timeout. Only status, latency and a bounded
history of 288 samples are stored. Two consecutive failures raise an incident.
Telegram sends once for an incident and once on recovery. Failed delivery is
retried on the next sample. HTTP 200 alone is insufficient for database health:
the JSON must also contain `status=ok` and `db=connected`.

The existing Hetzner root disk is also checked every five minutes. At 80% used
or less than 5 GiB free, notify on the first affected sample. A new failing check
also sends a notification during an already-open incident. This monitor never
buys storage, resizes compute or changes spending caps. It does not read vendor
invoices and must not be described as a hard monetary billing cap.

Install the three monitor files under `/opt/onebiz-ops`, and the service/timer
under `/etc/systemd/system`. The service uses a dynamic user, a private state
directory, read-only system paths, 80 MB memory and a 10% CPU limit. Its Telegram
credential is loaded with systemd `LoadCredential` from a root-only JSON file
at `/etc/onebiz-ops/telegram.json`. The file contains `token` and the owner-approved
`chat_id`. Never add that file or a database password to Git.

```sh
systemctl daemon-reload
systemctl enable --now onebiz-monitor.timer
systemctl start onebiz-monitor.service
systemctl show onebiz-monitor.service -p Result -p ExecMainStatus
journalctl -u onebiz-monitor.service --since today
```

State lives at `/var/lib/onebiz-ops/monitor.json`. Monitor failure must not be
treated as proof of database failure: inspect its timestamp and service result.
If this Hetzner host itself goes offline, this monitor cannot send a Telegram
message. A separate external dead-man check is needed to cover that failure.

Local tests perform no network requests or Telegram sends:

```sh
python3 scripts/operations/test_monitor.py
```

## Receiver load reduction

The Windows receiver shares cooldown between claim and heartbeat calls. Invalid
credentials wait five minutes, HTTP 429 honors a bounded Retry-After, and transient
failures back off up to 30 seconds. Successful polling keeps its original one-second
idle interval. The supervisor watchdog is pulsed during deliberate cooldown, so a
restart cannot bypass the cooldown. No physical print is automatically replayed.

Publishing the ZIP does **not** update a receiver already installed at a branch.
Update and verify each installed receiver separately during an agreed window.
An old invalid receiver must still be identified and stopped or reconfigured;
changing this download does not prove that its existing requests have stopped.

## Cost boundary

Supabase spend cap does not cover compute or explicitly enabled add-ons. Compute
is billed per started hour, not at a fixed rounded monthly price. Pro + Small +
Micro may exceed USD 40 in a 31-day cycle even before tax. Do not promise a hard
USD 40 invoice cap. Keep spend cap enabled, do not enable paid add-ons without
approval, and only reduce compute after measuring the optimized workload.

## Backup boundary

This monitor is not a backup. The legacy `scripts/backup-db.mjs` is a partial
application-data export, not a full recovery archive. A proper independent backup
requires a separately approved database connection, a consistent PostgreSQL dump,
separate Storage object copies, encryption, retention and a real restore test.
Do not use service-role JSON exports as evidence that Auth/schema/ACLs/files are
recoverable.
