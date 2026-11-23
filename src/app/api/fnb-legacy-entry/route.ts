import { createHash } from "node:crypto";

const checkDraft = String.raw`
  function hasLocalWork(store, row) {
    if (store === "sync_queue") {
      return row.action !== "posCheckout" && row.status !== "completed";
    }
    if (store === "pending_orders") {
      return row.orderType !== "retail" && row.status !== "synced";
    }
    if (row.value == null) return false;
    if (row.key.startsWith("fnb-tabs:")) {
      const tabs = row.value.tabs;
      if (!Array.isArray(tabs)) return true;
      return tabs.some(tab => tab.lines?.length || tab.orderNoteDraftBase !== undefined ||
        tab.kitchenOrderId?.startsWith("local_") ||
        (!tab.kitchenOrderId && (tab.sentLines?.length || tab.orderNote || tab.orderDiscount || tab.customerId)));
    }
    if (row.key.startsWith("fnb-kitchen-request:")) return !row.value.result;
    if (row.key.startsWith("fnb-kitchen-supplement:")) return row.value.confirmed !== true;
    return false;
  }

  function readLocalWork() {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open("onebiz-fnb-offline");
      let missing = false;
      open.onupgradeneeded = event => {
        // A new browser has no POS database. Abort creation to keep this check read-only.
        missing = event.oldVersion === 0;
        open.transaction.abort();
      };
      open.onerror = () => missing ? resolve(false) : reject(open.error);
      open.onblocked = () => reject(new Error("POS storage is busy"));
      open.onsuccess = () => {
        const db = open.result;
        try {
          // Inspect all branches on this device. Every store is required on the current POS.
          const stores = ["meta", "sync_queue", "pending_orders"];
          const transaction = db.transaction(stores, "readonly");
          let hasWork = false;
          transaction.oncomplete = () => { db.close(); resolve(hasWork); };
          transaction.onabort = () => { db.close(); reject(transaction.error); };
          for (const store of stores) {
            const read = transaction.objectStore(store).openCursor();
            read.onsuccess = () => {
              const cursor = read.result;
              if (!cursor || hasWork) return;
              try {
                if (hasLocalWork(store, cursor.value)) hasWork = true;
                else cursor.continue();
              } catch {
                // Malformed records should stay accessible on the original POS.
                hasWork = true;
              }
            };
          }
        } catch (error) {
          db.close();
          reject(error);
        }
      };
    });
  }

  async function enterPos() {
    const message = document.getElementById("message");
    let timeout;
    try {
      if (navigator.onLine === false) throw new Error("Offline");
      const unavailable = new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("POS storage check timed out")), 1800);
      });
      if (await Promise.race([readLocalWork(), unavailable])) {
        message.textContent = "Thiết bị còn bill nháp, ghi chú chưa lưu hoặc lệnh chờ đồng bộ. Mở POS cũ để hoàn tất, rồi mở lại shortcut để sang bản mới.";
      } else {
        location.replace("https://fnb.onebiz.com.vn/");
      }
    } catch {
      message.textContent = "Chưa kiểm tra được bill lưu trên thiết bị. Tiếp tục ở POS cũ để giữ bill đang làm.";
    } finally {
      clearTimeout(timeout);
    }
  }

  void enterPos();
`;

const scriptHash = createHash("sha256").update(checkDraft).digest("base64");

export function GET() {
  return new Response(`<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mở POS F&B · ONEBIZ</title>
  <style>
    body{font:16px/1.5 system-ui,sans-serif;background:#f3f6fa;color:#172337;margin:0;padding:10vh 20px}
    main{max-width:28rem;margin:auto;padding:24px;background:white;border:1px solid #dde5ee;border-radius:14px}
    h1{font-size:1.35rem;margin:0} p{margin:12px 0 20px}
    a{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:8px;margin:4px 6px 0 0;color:#153879}
    .primary{background:#1649b5;color:white;text-decoration:none}
  </style>
</head>
<body>
  <main>
    <h1>Mở POS F&B</h1>
    <p id="message" role="status">Đang kiểm tra bill lưu trên thiết bị…</p>
    <noscript><p>Bật JavaScript để kiểm tra bill trước khi chuyển sang POS mới.</p></noscript>
    <a class="primary" href="/pos/fnb?fnb_legacy=1">Tiếp tục ở POS cũ</a>
    <a href="/pos/fnb">Kiểm tra lại</a>
  </main>
  <script>${checkDraft}</script>
</body>
</html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
