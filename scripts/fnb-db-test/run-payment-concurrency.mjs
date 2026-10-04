import { spawn } from "node:child_process";

if (process.env.PGDATABASE !== "fnb_payment_concurrency_test" || process.env.PGHOST !== "localhost") {
  throw new Error("Dedicated local CI database required; no production connections accepted");
}
const actor = "select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);";
function start(sql, name) {
  const child = spawn("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    env: { ...process.env, PGAPPNAME: name, PGCONNECT_TIMEOUT: "5" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { output += data; });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve(output) : reject(new Error(`${name} failed (${code}): ${output}`)));
  });
  // Avoid unhandled rejection while polling another live connection.
  done.catch(() => {});
  child.stdin.end(sql);
  return { child, done };
}
async function observe(predicate) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const result = await start(`select count(*) from pg_stat_activity where ${predicate};`, "uat-observer").done;
    if (result.trim() === "1") return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Concurrency barrier not observed: ${predicate}`);
}
const first = start(`begin; ${actor} insert into test_payment_results values ('A',test_pay()); select pg_sleep(6); commit;`, "uat-payment-A");
let second;
try {
  await observe("application_name = 'uat-payment-A' and wait_event = 'PgSleep'");
  second = start(`${actor} insert into test_payment_results values ('B',test_pay());`, "uat-payment-B");
  await observe("application_name = 'uat-payment-B' and wait_event_type = 'Lock'");
  await Promise.all([first.done, second.done]);
  console.log("PASS: two actual PostgreSQL sessions overlap; second payment waits for first transaction.");
} finally {
  first.child.kill();
  second?.child.kill();
  await Promise.allSettled([first.done, ...(second ? [second.done] : [])]);
}
