/**
 * Remove modifier text that older POS builds also copied into the free-text
 * note. Modifier snapshots remain the authoritative structured display.
 */
export function getFnbFreeTextNote(
  note: string | null | undefined,
  modifierLabels: readonly string[] | null | undefined,
): string | undefined {
  const trimmedNote = note?.trim();
  if (!trimmedNote) return undefined;

  const labels = (modifierLabels ?? []).map((label) => label.trim()).filter(Boolean);
  if (labels.length === 0) return trimmedNote;

  const generatedPrefixes = [labels.join(", "), labels.join(" • ")];
  for (const prefix of generatedPrefixes) {
    if (trimmedNote === prefix) return undefined;

    for (const separator of [" — ", " • "]) {
      const fullPrefix = `${prefix}${separator}`;
      if (trimmedNote.startsWith(fullPrefix)) {
        return trimmedNote.slice(fullPrefix.length).trim() || undefined;
      }
    }
  }

  return trimmedNote;
}

export function buildFnbStoredItemNote(
  freeText: string | null | undefined,
  legacyModifierTags: readonly string[],
  hasStructuredModifiers: boolean,
): string | undefined {
  const trimmedFreeText = freeText?.trim();
  if (hasStructuredModifiers) return trimmedFreeText || undefined;

  const legacyText = legacyModifierTags.map((tag) => tag.trim()).filter(Boolean).join(", ");
  return [legacyText, trimmedFreeText].filter(Boolean).join(" — ") || undefined;
}
