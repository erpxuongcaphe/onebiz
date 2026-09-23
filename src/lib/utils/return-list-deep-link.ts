const RETURN_LIST_PATH = "/don-hang/tra-hang";

export function buildReturnListDeepLink(returnCode: string): string {
  const code = returnCode.trim();
  if (!code) return RETURN_LIST_PATH;
  const params = new URLSearchParams({ tim: code, mo: "1" });
  return `${RETURN_LIST_PATH}?${params.toString()}`;
}
