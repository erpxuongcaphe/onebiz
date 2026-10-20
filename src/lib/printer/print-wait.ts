/** Bound read-only/preparation work. Never wrap a write: it may finish after timeout. */
export async function waitForPrint<T>(work: PromiseLike<T>, message: string, timeoutMs = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}
