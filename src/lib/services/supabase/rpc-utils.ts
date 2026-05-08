export function isRpcUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { code?: string; message?: string; details?: string };
  const text = `${maybeError.message ?? ""} ${maybeError.details ?? ""}`.toLowerCase();

  return (
    maybeError.code === "42883" ||
    maybeError.code === "PGRST202" ||
    text.includes("could not find the function") ||
    text.includes("function public.") && text.includes("does not exist")
  );
}
