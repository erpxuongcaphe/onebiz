#!/usr/bin/env python3
"""Small external monitor. GET only, no credentials or paid service required."""
import argparse
import json
import os
import shutil
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

CHECKS = (
    ("onebiz_database", "https://onebiz.com.vn/api/health", True),
    ("onebiz_login", "https://onebiz.com.vn/dang-nhap", False),
    ("xuongcaphe_home", "https://www.xuongcaphe.com/", False),
)


def probe_disk(path="/", usage=shutil.disk_usage):
    """Warn before an existing disk needs expansion; never provision storage."""
    try:
        disk = usage(path)
        used_percent = round((disk.total - disk.free) * 100 / disk.total, 1)
        return {"ok": used_percent < 80 and disk.free >= 5 * 1024**3,
                "status": 0, "elapsed_ms": 0, "used_percent": used_percent,
                "free_bytes": disk.free, "immediate_alert": True}
    except OSError:
        return {"ok": False, "status": 0, "elapsed_ms": 0, "immediate_alert": True}


def probe(url, database=False, opener=urllib.request.urlopen):
    started = time.monotonic()
    status = 0
    ok = False
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "Onebiz-Ops-Monitor/1.0"})
        with opener(request, timeout=8) as response:
            status = response.status
            # Limit response bytes; never store HTML, SQL errors, or user data.
            if database:
                payload = json.loads(response.read(8193))
                ok = status == 200 and payload.get("status") == "ok" and payload.get("db") == "connected"
            else:
                ok = status == 200
    except urllib.error.HTTPError as error:
        status = error.code
    except (OSError, ValueError):
        pass
    return {"ok": ok, "status": status, "elapsed_ms": round((time.monotonic() - started) * 1000)}


def sample(previous, results, timestamp):
    old_checks = previous.get("checks", {})
    checks = {}
    for name, result in results.items():
        failures = 0 if result["ok"] else old_checks.get(name, {}).get("consecutive_failures", 0) + 1
        checks[name] = {**result, "consecutive_failures": failures}
    history = previous.get("history", [])[-287:]
    history.append({"at": timestamp, "checks": results})
    return {
        "checked_at": timestamp,
        "healthy": all(item["ok"] for item in checks.values()),
        "alert": any(item["consecutive_failures"] >= (1 if item.get("immediate_alert") else 2) for item in checks.values()),
        "checks": checks,
        "history": history,
    }


def send_telegram(config, message):
    try:
        request = urllib.request.Request(
            "https://api.telegram.org/bot" + config["token"] + "/sendMessage",
            data=json.dumps({"chat_id": config["chat_id"], "text": message}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read(8192)).get("ok") is True
    except (OSError, ValueError, KeyError):
        return False


def notify(state, previous, config, sender=send_telegram):
    incident = previous.get("notified_incident", False)
    state["notified_incident"] = incident
    issues = sorted(name for name, check in state["checks"].items()
                    if check["consecutive_failures"] >= (1 if check.get("immediate_alert") else 2))
    previous_issues = previous.get("notified_issues", [])
    state["notified_issues"] = previous_issues
    message = None
    if state["alert"] and (not incident or set(issues) - set(previous_issues)):
        names = ", ".join(issues)
        message = "ONEBIZ: cần kiểm tra: " + names + ". Không tự nâng gói hoặc mua dung lượng. Kiểm tra kết nối và quán đang bán; không tự in lại phiếu chưa rõ kết quả."
    elif state["healthy"] and incident:
        message = "ONEBIZ: các kiểm tra web, database và dung lượng đã bình thường trở lại. Đây là kiểm tra kỹ thuật; cần xác nhận giấy tại quán nếu trước đó có phiếu in lỗi."
    if message:
        sent = sender(config, message)
        state["notification_failed"] = not sent
        if sent:
            state["notified_incident"] = state["alert"]
            state["notified_issues"] = issues if state["alert"] else []


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-dir", default="/var/lib/onebiz-ops")
    args = parser.parse_args()
    directory = Path(args.state_dir)
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / "monitor.json"
    try:
        previous = json.loads(path.read_text())
    except (OSError, ValueError):
        previous = {}
    results = {name: probe(url, database) for name, url, database in CHECKS}
    results["hetzner_disk"] = probe_disk()
    state = sample(previous, results, datetime.now(timezone.utc).isoformat())
    credentials = Path(os.environ.get("CREDENTIALS_DIRECTORY", "/nonexistent")) / "telegram"
    if credentials.exists():
        notify(state, previous, json.loads(credentials.read_text()))
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, separators=(",", ":")))
    os.chmod(temporary, 0o600)
    temporary.replace(path)
    print(json.dumps({key: value for key, value in state.items() if key != "history"}))


if __name__ == "__main__":
    main()
