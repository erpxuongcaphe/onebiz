# F&B buyer popup lifecycle

Premium reported an idle buyer popup around every five minutes and an X button
that appeared unable to dismiss it, although Escape worked.

## Evidence and limits

- All existing open paths were inspected: customer button, F4, the required-buyer
  guard on send/payment, and the explicit payment customer action. No periodic
  opener exists in the inspected POS code.
- Live production QA closed the original popup by X normally. Leaving the POS
  idle did not reproduce a periodic opener. The exact Premium device trigger is
  **not yet proven**; do not attribute it to Supabase or a customer's identity.
- A reproducible unsafe shortcut path exists: F4 is accepted even on key repeat,
  with Alt/Ctrl modifiers, after another handler consumes it, or while another
  dialog owns focus. A repeated F4 can reopen the picker immediately after X.

## Change

- Only a genuine, plain, non-repeating F4 can open the buyer picker. Ignore it
  during composition, while hidden, or while any dialog is open. Leave native
  Alt+F4 and Ctrl+F4 intact. Other POS shortcut and settlement logic is unchanged.
- Route X through DialogClose and the same guarded onOpenChange as Escape.
  Preserve the existing no-dismiss-during-buyer-save protection. Searching is
  not an unsaved business edit and does not require a discard confirmation.
- Keep popup state transient, initially closed; no refresh timer or restored
  bill state can request it through this controller.
- Keep at most 40 timestamp/action/source entries in sessionStorage under
  `onebiz:fnb-buyer-popup:v1`. No customer, employee, search, bill, branch, token
  or other business payload is captured. No network requests or timers are added.
  Closing the browser session clears this trace. Storage failure is ignored.

## Validation

- Buyer lifecycle + existing contact picker + shared popup guard: 38 tests.
- Existing F&B POS, shift/catalog guards and payment lock: 112 tests.
- New cases include search/tab-switch then X without a save; late reads aborted
  after Escape; repeated F4 after X; synthetic/modified keys; other modal owning
  focus; twenty simulated idle minutes; remount; bounded/unavailable storage.
- No database migration, production bill writes, print job or stock changes.

## Device follow-up

If Premium repeats the report after this release, inspect only this trace on
that device to identify the source: `shortcut`, `customer-button`, `send-kitchen`,
`payment`, or `payment-customer`, and its close/ignored sequence. Do not retrieve
the full browser storage or increase database polling to investigate a UI event.
