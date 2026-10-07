/** Shared by the setup UI and the downloaded agent. No DNS or public hosts. */
export function parseDestination(value) {
  const printer = String(value ?? '').trim();
  if (!printer || printer.length > 200) throw new Error('Chưa chọn máy in.');
  if (printer.startsWith('windows://')) {
    const match = /^windows:\/\/([^?]+)\?cut=0$/.exec(printer);
    if (!match) throw new Error('Kết nối USB không hợp lệ.');
    const name = decodeURIComponent(match[1]);
    if (!name.trim() || name.length > 200) throw new Error('Tên máy không hợp lệ.');
    return { type: 'windows', printer: name, cut: false };
  }
  if (!printer.startsWith('tcp://')) {
    if (/^[a-z]+:\/\//i.test(printer)) throw new Error('Kết nối máy in không hợp lệ.');
    return { type: 'windows', printer };
  }
  const match = /^tcp:\/\/(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})(\?cut=0)?$/.exec(printer);
  if (!match) throw new Error('Nhập IP IPv4 và cổng máy in hợp lệ.');
  const octets = match[1].split('.').map(Number);
  const port = Number(match[2]);
  const privateIp = octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168);
  if (octets.some(n => n > 255) || !privateIp || octets[3] === 0 || octets[3] === 255 || port < 1 || port > 65535) throw new Error('Dùng IP máy in trong mạng nội bộ và cổng từ 1 đến 65535.');
  return { type: 'tcp', host: octets.join('.'), port, ...(match[3] ? { cut: false } : {}) };
}

export function networkDestination(host, port = '9100') {
  const value = `tcp://${String(host).trim()}:${String(port).trim()}`;
  const parsed = parseDestination(value);
  return `tcp://${parsed.host}:${parsed.port}`;
}

// Exact control payload; old agents reject it without sending anything.
export const CONNECTION_PROBE = [27,64,27,97,1,...new TextEncoder().encode('ONEBIZ_CONNECTION_V2')];
export function isConnectionProbe(bytes) {
  return bytes.length === CONNECTION_PROBE.length && CONNECTION_PROBE.every((n,i) => bytes[i] === n);
}

export function withPrinterCut(printer, cut) {
  const destination = parseDestination(printer);
  if (destination.type === 'tcp') return `tcp://${destination.host}:${destination.port}${cut ? '' : '?cut=0'}`;
  return cut ? destination.printer : `windows://${encodeURIComponent(destination.printer)}?cut=0`;
}

export function describeDestination(printer) {
  try {
    const d = parseDestination(printer);
    return `${d.type === 'tcp' ? `LAN/Wi-Fi · ${d.host}:${d.port}` : d.printer}${d.cut === false ? ' · không cắt giấy' : ''}`;
  } catch { return printer; }
}
