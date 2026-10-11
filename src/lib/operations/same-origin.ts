/** Next.js can normalize the local hostname in nextUrl; compare the browser-facing Host instead. */
export function isOperationsSameOrigin(request: {
  headers: Headers;
  nextUrl: { origin: string; protocol: string };
}): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  const host = request.headers.get("host");
  if (!host) return origin === request.nextUrl.origin;
  if (/[\s,/@\\?#]/.test(host)) return false;
  try {
    const expected = new URL(`${request.nextUrl.protocol}//${host}`);
    const actual = new URL(origin);
    return actual.origin === expected.origin && origin === actual.origin;
  } catch {
    return false;
  }
}
