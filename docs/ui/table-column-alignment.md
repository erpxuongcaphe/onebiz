# Column alignment

Shared DataTable, ReportDataTable and DetailItemsTable use one alignment for
the heading, values and subtotal/summary of a column. Numeric source values
default to right; text and identifiers default to left. Explicit alignment wins.
Do not parse formatted strings or labels to guess a number.

For TanStack columns use `meta: { align: "right" }` for money/quantities, including
empty/loading states and accessor functions that return formatted strings.
For ReportDataTable and DetailItemsTable use `align: "right"` on the column.
Use `align: "center"` for centered badges/controls; codes and phone numbers stay left.

Custom HTML tables must use the same alignment on `th`, `td`, and subtotal cells.
In right-aligned sortable headings the sort icon goes before the text, so it
does not occupy the right edge where numeric values end. Do not globally force
all headings right; that would misalign text columns.
