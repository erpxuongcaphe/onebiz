import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("monitor", Path(__file__).with_name("monitor.py"))
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


class Response:
    status = 200

    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, size):
        return self.body[:size]


class MonitorTests(unittest.TestCase):
    def test_disk_alerts_on_first_sample_and_new_issue_during_existing_incident(self):
        from collections import namedtuple
        Usage = namedtuple("Usage", "total used free")
        gib = 1024**3
        good = monitor.probe_disk(usage=lambda _: Usage(40*gib, 26*gib, 14*gib))
        bad = monitor.probe_disk(usage=lambda _: Usage(40*gib, 33*gib, 7*gib))
        self.assertTrue(good["ok"])
        self.assertFalse(bad["ok"])
        state = monitor.sample({}, {"hetzner_disk": bad}, "now")
        self.assertTrue(state["alert"])
        messages = []
        previous = {"notified_incident": True, "notified_issues": ["db"]}
        monitor.notify(state, previous, {}, lambda c, m: messages.append(m) or True)
        self.assertEqual(len(messages), 1)
        again = monitor.sample(state, {"hetzner_disk": bad}, "later")
        monitor.notify(again, state, {}, lambda c, m: messages.append(m) or True)
        self.assertEqual(len(messages), 1)

    def test_database_requires_healthy_payload_not_just_http_200(self):
        self.assertFalse(monitor.probe("https://example.test", True, lambda *a, **k: Response(b'<html>login</html>'))["ok"])
        self.assertFalse(monitor.probe("https://example.test", True, lambda *a, **k: Response(b'{"status":"ok","db":"error"}'))["ok"])
        self.assertTrue(monitor.probe("https://example.test", True, lambda *a, **k: Response(b'{"status":"ok","db":"connected"}'))["ok"])

    def test_transient_failure_needs_two_samples_then_recovers(self):
        failed = {"db": {"ok": False, "status": 503, "elapsed_ms": 2}}
        first = monitor.sample({}, failed, "first")
        self.assertFalse(first["alert"])
        second = monitor.sample(first, failed, "second")
        self.assertTrue(second["alert"])
        recovered = monitor.sample(second, {"db": {"ok": True, "status": 200, "elapsed_ms": 1}}, "third")
        self.assertFalse(recovered["alert"])
        self.assertEqual(recovered["checks"]["db"]["consecutive_failures"], 0)

    def test_history_is_bounded(self):
        state = monitor.sample({"history": [{}] * 1000}, {}, "now")
        self.assertEqual(len(state["history"]), 288)

    def test_notifies_once_per_incident_and_recovery_and_retries_failed_delivery(self):
        failed = {"db": {"ok": False, "status": 503, "elapsed_ms": 2}}
        first = monitor.sample({}, failed, "first")
        messages = []
        send = lambda config, message: messages.append(message) or True
        monitor.notify(first, {}, {}, send)
        self.assertEqual(messages, [])
        second = monitor.sample(first, failed, "second")
        monitor.notify(second, first, {}, lambda *args: False)
        self.assertFalse(second["notified_incident"])
        third = monitor.sample(second, failed, "third")
        monitor.notify(third, second, {}, send)
        fourth = monitor.sample(third, failed, "fourth")
        monitor.notify(fourth, third, {}, send)
        self.assertEqual(len(messages), 1)
        recovered = monitor.sample(fourth, {"db": {"ok": True, "status": 200, "elapsed_ms": 1}}, "fifth")
        monitor.notify(recovered, fourth, {}, send)
        self.assertEqual(len(messages), 2)
        self.assertFalse(recovered["notified_incident"])


if __name__ == "__main__":
    unittest.main()
