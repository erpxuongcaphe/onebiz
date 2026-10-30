// Only explicitly marked business logos; receipt HTML and payment QR are never cached.
const logos = new Map<string, { expires: number; value: Promise<string> }>();
const TTL = 60000;
const MAX_ENTRIES = 4;
const MAX_BYTES = 256 * 1024;

async function load(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Không tải được logo/QR cho bản in.");
  const blob = await response.blob();
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Không đọc được ảnh in."));
    reader.readAsDataURL(blob);
  });
  return data;
}

export function printImageData(url: string, cacheLogo = false): Promise<string> {
  if (!cacheLogo) return load(url);
  const now = Date.now();
  for (const [key, entry] of logos) if (entry.expires <= now) logos.delete(key);
  const existing = logos.get(url);
  if (existing) return existing.value;
  while (logos.size >= MAX_ENTRIES) logos.delete(logos.keys().next().value!);
  const value = load(url);
  const entry = { expires: now + TTL, value };
  logos.set(url, entry);
  // Failures/large assets do not stay cached. Do not evict a newer request.
  void value.then(data => {
    if (data.length > MAX_BYTES * 4 / 3 + 128 && logos.get(url) === entry) logos.delete(url);
  }, () => { if (logos.get(url) === entry) logos.delete(url); });
  return value;
}
