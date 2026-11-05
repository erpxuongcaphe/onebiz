# F&B whole-order notes after kitchen submission

The POS cart previously updated its local tab only. The first kitchen send
stored the note, but editing the same field on an already-sent bill did not
persist it. Opening the bill again or receiving a live snapshot could replace
the local note with the older saved value.

- Sent bills save their note 850 ms after typing pauses, or immediately with
  **Lưu ngay**. The same editor is used on desktop and in the mobile cart.
- The draft stays with the bill, including its last acknowledged server value,
  in the existing device cart storage. Late server snapshots cannot discard it
  or replace a more recently acknowledged note. Explicitly closing a tab waits
  for a pending save, and kitchen submission does not discard a dirty note.
- Note-only requests serialize for each order. Reconnect processes drafts
  sequentially. A save failure keeps the text and gives a retry/discard choice.
  A conflicting edit shows the saved version and requires an explicit choice.
- Saving changes only the open kitchen order note and its update time, and adds
  one audit event per actual change. It does not resend or reprint any item.
  The database checks user, tenant, branch, POS permissions and unpaid status,
  and compares the previous note under a row lock. Repeating an acknowledged
  value is a no-op. The RPC is unavailable to anonymous users.
- Online checkout flushes an edited note before recording payment. Existing
  offline checkout still queues the note in its payment payload. Old paid,
  cancelled and merged bills cannot be edited through this operation.

Deploy `20261105055422_fnb_saved_order_note.sql` before the UI.
The migration creates a function only; it does not change existing records.
Run `node scripts/fnb-db-test/run-sent-order-note.mjs` and the sent-note/POS
regression tests. Live verification should avoid changing any trading bill.
