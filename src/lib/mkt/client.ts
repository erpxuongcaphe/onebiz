// Helper client-side gọi API MKT: chuẩn hoá lỗi (message tiếng Việt từ server).

export async function mktPost<T = unknown>(
  url: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as
    | { success?: boolean; error?: { message?: string } }
    | T;
  if (!res.ok || (data as { success?: boolean })?.success === false) {
    const message =
      (data as { error?: { message?: string } })?.error?.message ?? "Thao tác thất bại";
    throw new Error(message);
  }
  return data as T;
}

export async function mktGet<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { method: "GET" });
  const data = (await res.json().catch(() => ({}))) as
    | { success?: boolean; error?: { message?: string } }
    | T;
  if (!res.ok || (data as { success?: boolean })?.success === false) {
    throw new Error((data as { error?: { message?: string } })?.error?.message ?? "Không tải được dữ liệu");
  }
  return data as T;
}

export async function mktPatch<T = unknown>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } } | T;
  if (!res.ok || (data as { success?: boolean })?.success === false) {
    throw new Error((data as { error?: { message?: string } })?.error?.message ?? "Thao tác thất bại");
  }
  return data as T;
}

export async function mktDelete<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { method: "DELETE" });
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } } | T;
  if (!res.ok || (data as { success?: boolean })?.success === false) {
    throw new Error((data as { error?: { message?: string } })?.error?.message ?? "Thao tác thất bại");
  }
  return data as T;
}
