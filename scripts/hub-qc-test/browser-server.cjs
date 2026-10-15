// Local synthetic acceptance only. No Supabase credentials, .env loading or upstream proxy.
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");
const { PGlite } = require(
  process.env.HUB_PGLITE_DIR || "@electric-sql/pglite",
);
const { bootstrap } = require("./run.cjs");
const root = path.resolve(__dirname, "../..");
const ids = {
  branch: "20000000-0000-4000-8000-000000000001",
  owner: "30000000-0000-4000-8000-000000000001",
  manager: "30000000-0000-4000-8000-000000000002",
  qc: "30000000-0000-4000-8000-000000000004",
  operator: "30000000-0000-4000-8000-000000000005",
  accounting: "30000000-0000-4000-8000-000000000007",
};
(async () => {
  const db = new PGlite();
  await bootstrap(db);
  await require("./acceptance.cjs")(db);
  await db.query("update ops_q_grants set active=true");
  let actor = ids.owner;
  const req = createRequire(root + "/package.json");
  const { createServer } = await import(
    pathToFileURL(req.resolve("vite")).href
  );
  const { qualityReadSchema, qualityCommandSchema } = await (async () => {
    const ts = req("typescript");
    const source = fs.readFileSync(
      root + "/src/lib/operations/quality-contracts.ts",
      "utf8",
    );
    const code = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText;
    const m = { exports: {} };
    new Function("require", "module", "exports", code)(req, m, m.exports);
    return m.exports;
  })();
  const server = await createServer({
    root: __dirname,
    configFile: false,
    envFile: false,
    publicDir: root + "/public",
    resolve: {
      alias: {
        "@": root + "/src",
        "next/link": path.join(__dirname, "link.tsx"),
      },
      dedupe: ["react", "react-dom"],
    },
    css: { postcss: root + "/postcss.config.mjs" },
    server: {
      host: "127.0.0.1",
      port: 3315,
      strictPort: true,
      fs: { allow: [root] },
    },
    plugins: [
      {
        name: "isolated-database-api",
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (
              !req.url.startsWith("/api/") &&
              !req.url.startsWith("/__test__/")
            )
              return next();
            const url = new URL(req.url, "http://127.0.0.1:3315");
            let body = "";
            for await (const chunk of req) {
              body += chunk;
              if (body.length > 200000) {
                res.writeHead(413);
                return res.end();
              }
            }
            const reply = (data, status = 200) => {
              res.writeHead(status, {
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
              });
              res.end(JSON.stringify(data));
            };
            try {
              if (url.pathname === "/__test__/actor") {
                const nextActor = JSON.parse(body).actor;
                if (!ids[nextActor]) throw Error("Unknown fixture actor");
                actor = ids[nextActor];
                return reply({ actor });
              }
              await db.query("select set_config('test.actor',$1,false)", [
                actor,
              ]);
              await db.exec("set role authenticated");
              let value;
              if (url.pathname === "/api/operations/quality") {
                if (req.method === "GET") {
                  const v = qualityReadSchema.parse(
                    Object.fromEntries(url.searchParams),
                  );
                  const { branch, period, kind, ...filters } = v;
                  value = (
                    await db.query(
                      "select ops_quality_read($1,$2,$3,$4) value",
                      [branch, period, kind, JSON.stringify(filters)],
                    )
                  ).rows[0].value;
                } else {
                  const c = qualityCommandSchema.parse(JSON.parse(body));
                  value = {
                    result: (
                      await db.query(
                        "select ops_quality_execute($1,$2,$3) value",
                        [c.action, JSON.stringify(c.payload), c.requestId],
                      )
                    ).rows[0].value,
                  };
                }
              } else if (url.pathname === "/api/operations") {
                if (req.method === "GET")
                  value = (
                    await db.query("select ops_workspace($1,$2) value", [
                      url.searchParams.get("branch") || null,
                      url.searchParams.get("period"),
                    ])
                  ).rows[0].value;
                else {
                  const c = JSON.parse(body);
                  value = {
                    result: (
                      await db.query("select ops_execute($1,$2,$3) value", [
                        c.action,
                        JSON.stringify(c.payload),
                        c.requestId,
                      ])
                    ).rows[0].value,
                  };
                }
              } else if (url.pathname === "/api/operations/history")
                value = (
                  await db.query(
                    "select ops_history($1,$2,$3,$4,$5) value",
                    [url.searchParams.get("branch"), url.searchParams.get("period"), url.searchParams.get("kind") || "audit", url.searchParams.get("cursorAt"), url.searchParams.get("cursorId")],
                  )
                ).rows[0].value;
              else if (url.pathname === "/api/operations/inbox")
                value = { rows: [] };
              else if (url.pathname === "/api/operations/evidence")
                value = { rows: [] };
              else if (url.pathname.includes("/mkt-links"))
                value = { links: [], candidates: [] };
              else
                return reply(
                  { error: "Fixture endpoint not implemented" },
                  404,
                );
              return reply(value);
            } catch (e) {
              console.error(
                "FIXTURE API",
                url.pathname,
                e.message,
                e.where ?? "",
              );
              return reply({ error: e.message }, 400);
            } finally {
              await db.exec("reset role");
            }
          });
        },
      },
    ],
  });
  await server.listen();
  console.log("ISOLATED_HUB_READY http://127.0.0.1:3315");
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      await server.close();
      await db.close();
      process.exit(0);
    });
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
