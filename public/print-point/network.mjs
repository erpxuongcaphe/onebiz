import { createConnection } from 'node:net';
import { parseDestination } from './destination.mjs';

/** One physical send only. Socket success is not proof that paper came out. */
export function sendNetworkPrint(printer, bytes, timeoutMs = 15000) {
  const destination = parseDestination(printer);
  if (destination.type !== 'tcp') throw new Error('Không phải máy in mạng.');
  return new Promise(resolve => {
    let attempted = false, settled = false;
    const socket = createConnection({ host: destination.host, port: destination.port });
    const finish = (status, message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ status, message });
    };
    const timer = setTimeout(() => finish(attempted ? 'unknown' : 'failed', attempted ? 'Mất xác nhận sau khi gửi. Kiểm tra giấy trước khi in lại.' : 'Không kết nối được IP/cổng. Kiểm tra nguồn, dây mạng và mạng của máy quầy.'), timeoutMs);
    socket.once('error', () => finish(attempted ? 'unknown' : 'failed', attempted ? 'Kết nối ngắt sau khi bắt đầu gửi. Kiểm tra giấy trước khi in lại.' : 'Không kết nối được máy in. Kiểm tra IP, cổng và cùng mạng nội bộ.'));
    socket.once('connect', () => {
      if (bytes === null) { finish('handed_off', 'Kết nối IP/cổng thành công. Chưa gửi dữ liệu in; dùng In thử để kiểm tra giấy và dao cắt.'); return; }
      attempted = true;
      socket.end(bytes, () => finish('handed_off', 'Đã chuyển dữ liệu tới kết nối máy in LAN. Kiểm tra giấy; chưa xác nhận máy đã in xong.'));
    });
    socket.once('close', () => {
      if (!settled) finish(attempted ? 'unknown' : 'failed', 'Kết nối đóng trước khi xác nhận. Kiểm tra giấy trước khi in lại.');
    });
  });
}
