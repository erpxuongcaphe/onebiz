import { createHash, randomBytes } from "node:crypto";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createMktAuditAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isValidMktAuditAccessToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export function hashMktAuditAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readMktAuditBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim() ?? "";
  return isValidMktAuditAccessToken(token) ? token : null;
}

export async function readMktAuditRequestToken(
  request: Request,
): Promise<string | null> {
  const bearer = readMktAuditBearerToken(request);
  if (bearer) return bearer;

  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const token = String((await request.formData()).get("token") ?? "").trim();
      return isValidMktAuditAccessToken(token) ? token : null;
    }
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { token?: unknown };
      const token = typeof body.token === "string" ? body.token.trim() : "";
      return isValidMktAuditAccessToken(token) ? token : null;
    }
  } catch {
    return null;
  }
  return null;
}
export const MKT_AUDIT_PUBLIC_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;