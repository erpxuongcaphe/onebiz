export const AUTH_REQUEST_TIMEOUT_MS = 15_000;

export class AuthRequestTimeoutError extends Error {
  constructor() {
    super("AUTH_REQUEST_TIMEOUT");
    this.name = "AuthRequestTimeoutError";
  }
}

export async function withAuthRequestTimeout<T>(
  request: PromiseLike<T>,
  timeoutMs = AUTH_REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new AuthRequestTimeoutError()), timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(request), timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function getAuthRequestErrorMessage(error: unknown): string {
  if (error instanceof AuthRequestTimeoutError) {
    return "Kết nối quá lâu. Vui lòng kiểm tra mạng và thử lại.";
  }

  return "Không thể xử lý yêu cầu lúc này. Vui lòng thử lại.";
}
