import test from "node:test";
import assert from "node:assert/strict";
import { createSessionReadFetch } from "../src/lib/supabase/session-read-fetch.ts";

const url = "https://onebiz-test.supabase.co";
const read = url + "/rest/v1/rpc/fnb_print_state_v1";
const call = (token) => ({ method: "POST", headers: { Authorization: "Bearer " + token } });

test("no user session or public bearer does not reach Supabase", async () => {
  const send = () => assert.fail("anonymous request escaped");
  const fetch = createSessionReadFetch(url, "public", send, send);
  assert.equal((await fetch(read, { method: "POST" })).status, 401);
  assert.equal((await fetch(read, call("public"))).status, 401);
});

test("a rejected bearer stops background retries, refreshes once and accepts a renewed session", async () => {
  const sent = [], recovered = [];
  const fetch = createSessionReadFetch(url, "public", async (_, init) => {
    const bearer = new Headers(init.headers).get("authorization");
    sent.push(bearer);
    return new Response(null, { status: bearer === "Bearer old" ? 401 : 200 });
  }, async token => { recovered.push(token); });
  assert.equal((await fetch(read, call("old"))).status, 401);
  for (let i = 0; i < 8; i++) assert.equal((await fetch(read, call("old"))).status, 401);
  assert.equal((await fetch(read, call("new"))).status, 200);
  assert.deepEqual(recovered, ["old"]);
  assert.deepEqual(sent, ["Bearer old", "Bearer new"]);
});

test("offline and failed transport do not invalidate a valid session", async () => {
  let online = false, calls = 0;
  const fetch = createSessionReadFetch(url, "public", async () => {
    if (++calls === 1) throw new TypeError("Failed to fetch");
    return new Response(null);
  }, () => assert.fail("network failures must not refresh credentials"), () => online);
  await assert.rejects(fetch(read, call("same")), /mất mạng/);
  assert.equal(calls, 0);
  online = true;
  await assert.rejects(fetch(read, call("same")), /Failed to fetch/);
  assert.equal((await fetch(read, call("same"))).status, 200);
});

test("print enqueue, notifications writes and other origins pass through untouched", async () => {
  let calls = 0;
  const fetch = createSessionReadFetch(url, "public", async () => {
    calls++;
    return new Response(null, { status: 401 });
  }, () => assert.fail("unrelated request must not trigger recovery"), () => false);
  await fetch(url + "/rest/v1/rpc/fnb_print_enqueue_v1", call("public"));
  await fetch(url + "/rest/v1/notifications", { method: "PATCH" });
  await fetch(read.replace(url, "https://other.example"), call("public"));
  assert.equal(calls, 3);
});
