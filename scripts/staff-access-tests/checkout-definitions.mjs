import { readFile } from "node:fs/promises";
import { functionFromMigration } from "./inventory.mjs";

export async function loadCheckoutDefinitions(db) {
  for (const [file, name] of [
    [
      "00381_allow_customer_credit_on_sales_return.sql",
      "_create_sales_return_auth_impl_00244",
    ],
    ["00434_fnb_branch_print_queue.sql", "_fnb_print_access_v1"],
    [
      "202610210003_fnb_safe_recipe_defaults.sql",
      "_fnb_resolve_order_recipe_defaults_20261021",
    ],
    ["20261029134118_fnb_buyer_employee_lookup.sql", "fnb_buyer_lookup_v1"],
    ["00370_fnb_checkout_permission.sql", "fnb_complete_payment_atomic_v3"],
    ["00429_fnb_offline_cash_occurrence.sql", "fnb_complete_payment_timed_v1"],
    [
      "00374_split_retail_fnb_open_shift_permissions.sql",
      "fnb_open_shift_atomic",
    ],
    ["00434_fnb_branch_print_queue.sql", "fnb_print_enqueue_v1"],
    ["20261105055422_fnb_saved_order_note.sql", "fnb_save_order_note_v1"],
    ["00447_fnb_order_customer_context.sql", "fnb_select_order_customer_v1"],
    [
      "202610200001_fnb_delivery_price_policy.sql",
      "get_fnb_delivery_price_policy",
    ],
    [
      "20261027005706_internal_customer_canonical_identity.sql",
      "get_pos_retail_customer_contacts_identity",
    ],
    ["00448_fnb_print_policy_and_cash_actor.sql", "stamp_fnb_cash_actor_v1"],
    [
      "00448_fnb_print_policy_and_cash_actor.sql",
      "stamp_linked_fnb_cash_actor_v1",
    ],
    ["00274_fnb_split_table_payment_guard.sql", "fnb_complete_payment_atomic"],
    [
      "00255_harden_fnb_checkout_benefits.sql",
      "fnb_complete_payment_atomic_v2",
    ],
  ])
    await db.exec(await functionFromMigration(file, name));
  await db.exec(
    (
      await readFile(
        new URL(
          "../../supabase/migrations/00421_fnb_sales_return_checkout_permission.sql",
          import.meta.url,
        ),
        "utf8",
      )
    ).replaceAll("\r\n", "\n"),
  );
  await db.exec(
    (
      await functionFromMigration(
        "00298_fix_shift_open_close_reconcile_flow.sql",
        "open_shift_atomic",
      )
    ).replace(
      "public.open_shift_atomic(",
      "public._open_shift_checkout_impl_00298(",
    ),
  );
  await db.exec(
    await readFile(
      new URL("./checkout-contract-fixtures.sql", import.meta.url),
      "utf8",
    ),
  );
}
