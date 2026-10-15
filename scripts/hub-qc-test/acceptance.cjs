const assert = require("node:assert/strict");
const crypto = require("node:crypto");
module.exports = async function acceptance(db) {
  let passed = 0;
  const ids = {
    tenant: "10000000-0000-4000-8000-000000000001",
    otherTenant: "10000000-0000-4000-8000-000000000002",
    branch: "20000000-0000-4000-8000-000000000001",
    otherBranch: "20000000-0000-4000-8000-000000000002",
    branch2: "20000000-0000-4000-8000-000000000003",
    owner: "30000000-0000-4000-8000-000000000001",
    manager: "30000000-0000-4000-8000-000000000002",
    manager2: "30000000-0000-4000-8000-000000000003",
    qc: "30000000-0000-4000-8000-000000000004",
    operator: "30000000-0000-4000-8000-000000000005",
    outsider: "30000000-0000-4000-8000-000000000006",
    accounting: "30000000-0000-4000-8000-000000000007",
    other: "30000000-0000-4000-8000-000000000008",
  };
  const one = async (sql, args = []) => {
    const r = await db.query(sql, args);
    return r.rows[0];
  };
  const check = (condition, label) => {
    assert.ok(condition, label);
    passed++;
    console.log("PASS", label);
  };
  async function denied(fn, code, label) {
    try {
      await fn();
      assert.fail("Expected rejection: " + label);
    } catch (e) {
      if (e.code === "ERR_ASSERTION") throw e;
      assert.ok(e.message.includes(code), `${label}: ${e.message}`);
      passed++;
      console.log("PASS", label);
    }
  }
  const actor = async (who) => {
    await db.query("select set_config('test.actor',$1,false)", [ids[who]]);
  };
  const execute = async (
    action,
    payload = {},
    requestId = crypto.randomUUID(),
    branch = ids.branch,
  ) => {
    const r = await one(
      "select public.ops_quality_execute($1,$2::jsonb,$3::uuid) value",
      [action, JSON.stringify({ branchId: branch, ...payload }), requestId],
    );
    return r.value;
  };
  const read = async (kind = "work", filters = {}, branch = ids.branch) => {
    const r = await one(
      "select public.ops_quality_read($1,$2,$3,$4::jsonb) value",
      [branch, period, kind, JSON.stringify(filters)],
    );
    return r.value;
  };
  const day = (
    await one("select (now() at time zone 'Asia/Ho_Chi_Minh')::date::text d")
  ).d;
  const period = day.slice(0, 7);
  const due = day + "T17:00:00+07:00";
  await db.query("insert into tenants values($1),($2)", [
    ids.tenant,
    ids.otherTenant,
  ]);
  for (const [id, tenant, code] of [
    [ids.branch, ids.tenant, "MAIN"],
    [ids.branch2, ids.tenant, "BRANCH2"],
    [ids.otherBranch, ids.otherTenant, "OTHER"],
  ])
    await db.query(
      "insert into branches(id,tenant_id,code,name) values($1,$2,$3,$3)",
      [id, tenant, code],
    );
  for (const key of [
    "owner",
    "manager",
    "manager2",
    "qc",
    "operator",
    "outsider",
    "accounting",
    "other",
  ]) {
    await db.query(
      "insert into profiles(id,tenant_id,role,full_name,email) values($1,$2,$3,$4,$5)",
      [
        ids[key],
        key === "other" ? ids.otherTenant : ids.tenant,
        key === "owner" ? "owner" : "staff",
        key,
        key + "@test.invalid",
      ],
    );
    if (key !== "owner")
      for (const code of ["ops.view", "ops.work", "ops.verify"])
        await db.query("insert into test_permissions values($1,$2)", [
          ids[key],
          code,
        ]);
  }
  for (const [key, role] of [
    ["manager", "manager"],
    ["manager2", "manager"],
    ["qc", "reviewer"],
    ["accounting", "coordinator"],
  ])
    await db.query("insert into ops_members values($1,$2,$3,$4,'{}',true)", [
      ids.tenant,
      ids.branch,
      ids[key],
      role,
    ]);
  await db.query(
    "insert into ops_members values($1,$2,$3,'manager','{}',true)",
    [ids.tenant, ids.branch2, ids.manager],
  );
  await actor("owner");
  const criteria = [
    {
      id: "safe",
      title: "Kiem tra",
      kind: "boolean",
      operator: "eq",
      threshold: 1,
      samples: 1,
      critical: false,
      evidenceRequired: true,
    },
  ];
  const obs = (v) => [
    { criterionId: "safe", slot: "1", value: v, evidence: "kiem tra tai cho" },
  ];
  const family = crypto.randomUUID(),
    standard = crypto.randomUUID();
  await db.query(
    "insert into ops_standards(id,tenant_id,branch_id,family_id,revision,title,scope,assignee_id,frequency,due_time,effective_from,criteria,status,created_by) values($1,$2,$3,$4,1,'Ca phe sai vi','common',$5,'daily','17:00',$6,$7,'approved',$8)",
    [
      standard,
      ids.tenant,
      ids.branch,
      family,
      ids.manager,
      day,
      JSON.stringify(criteria),
      ids.owner,
    ],
  );
  // This synthetic standard existed before its first due time, regardless of test execution hour.
  await db.query("update ops_standards set created_at=$2::date::timestamp at time zone 'Asia/Ho_Chi_Minh' where id=$1", [standard,day]);
  await db.query("select ops_generate_internal($1,$2)", [ids.branch, day]);
  await db.query("select ops_generate_internal($1,$2)", [ids.branch, day]);
  check(
    (await one("select count(*)::int n from ops_runs")).n === 1,
    "M01 schedule generation is idempotent",
  );
  let run = await one("select * from ops_runs");
  check(run.quality === "unknown", "M03 schedule is never pre-passed");
  await execute("assignment", {
    familyId: family,
    managerIds: [ids.manager, ids.manager2],
  });
  await execute("qc_grant", {
    userId: ids.qc,
    canAudit: true,
    canCorrect: true,
    active: true,
  });
  await execute("qc_grant", {
    userId: ids.accounting,
    canAccounting: true,
    active: true,
  });
  const department = (
    await execute("department", { title: "Bao tri", members: [ids.operator] })
  ).id;
  const issueData = {
    title: "Ca phe sai vi lo A",
    description: "Can RD kiem tra lo A",
    assigneeId: ids.manager,
    category: "product",
    priority: "important_urgent",
    dueAt: due,
    departmentId: department,
    operatorId: ids.operator,
    collaborators: [],
  };
  await execute("catalog", {
    standardId: standard,
    code: "QC-001",
    category: "product",
    scoreType: "deduct",
    weight: 5,
    effectiveFrom: day,
    critical: false,
  });
  const rule = {
    baseScore: 100,
    minimumScore: 70,
    floorScore: 0,
    capScore: 100,
    bonusCap: 10,
    repeatMode: "once_per_issue",
    thresholdBasis: "after_bonus",
    allowAbove100: false,
    qcFundCents: 200000000,
    businessFundCents: null,
    businessThresholdBps: null,
    businessCapBps: null,
    blockBusinessOnCritical: null,
    allocations: [{ userId: ids.manager, shareBps: 10000 }],
  };
  const policy = (
    await execute("rule", { title: "Policy", effectiveFrom: day, config: rule })
  ).id;
  await execute("rule_approve", { id: policy });
  await actor("manager2");
  let workspace = await read();
  check(
    workspace.rows[0].manager_ids.length === 2,
    "M01 two managers share a schedule",
  );
  const req = crypto.randomUUID(),
    checkPayload = {
      id: run.id,
      version: run.version,
      observations: obs(0),
      issues: [issueData],
      note: "Lo A",
    };
  const saved = await execute("check", checkPayload, req);
  check(
    (await one("select count(*)::int n from ops_q_checks")).n === 1 &&
      (await one("select count(*)::int n from ops_q_issues")).n === 1,
    "M05 failure and issue commit together",
  );
  await execute("check", checkPayload, req);
  check(
    (await one("select count(*)::int n from ops_q_checks")).n === 1,
    "M12 replay does not duplicate failure",
  );
  await denied(
    () => execute("check", { ...checkPayload, note: "other" }, req),
    "OPS_REQUEST_CONFLICT",
    "M12 idempotency key cannot change body",
  );
  await denied(
    () => execute("check", checkPayload),
    "OPS_STALE",
    "M12 stale schedule refuses overwrite",
  );
  run = await one("select * from ops_runs");
  await denied(
    () =>
      execute("check", {
        id: run.id,
        version: run.version,
        observations: obs(0),
        issues: [],
      }),
    "OPS_Q_ISSUE_REQUIRED",
    "M05 failure without issue rolls back",
  );
  check(
    (await one("select count(*)::int n from ops_q_checks")).n === 1,
    "M05 rollback left no orphan check",
  );
  let issue = (await read("issues")).rows[0];
  await execute("check", {
    id: run.id,
    version: run.version,
    observations: obs(0),
    issues: [{ issueId: issue.id }],
  });
  check(
    (await one("select count(*)::int n from ops_q_issues")).n === 1 &&
      (await one("select count(*)::int n from ops_q_sources")).n === 2,
    "M06 recurring open problem links sources",
  );
  run = await one("select * from ops_runs");
  await execute("check", {
    id: run.id,
    version: run.version,
    observations: obs(0),
    issues: [{ ...issueData, title: "Lo B" }],
  });
  check(
    (await one("select count(*)::int n from ops_q_issues")).n === 2,
    "M07 same standard can have a second distinct issue",
  );
  await actor("operator");
  let operatorData = await read("issues");
  check(
    operatorData.rows.length === 2,
    "Collaborator can see assigned issues without branch browse permission",
  );
  await denied(
    () => read("work"),
    "OPS_FORBIDDEN",
    "Q11 collaborator cannot browse schedules",
  );
  await denied(
    () =>
      execute("recheck", {
        id: issue.id,
        version: issue.version,
        result: "met",
        note: "dong thay",
      }),
    "OPS_FORBIDDEN",
    "M08 office cannot close on behalf of manager",
  );
  await execute("issue_update", {
    id: issue.id,
    version: issue.version,
    state: "in_progress",
  });
  issue = (await read("issues")).rows.find((i) => i.id === issue.id);
  await execute("issue_update", {
    id: issue.id,
    version: issue.version,
    state: "pending_review",
    resolution: "Da khac phuc",
  });
  issue = (await read("issues")).rows.find((i) => i.id === issue.id);
  check(
    issue.state === "pending_review" && issue.completed_at === null,
    "M08 office completion waits for manager recheck",
  );
  await actor("manager");
  await execute("recheck", {
    id: issue.id,
    version: issue.version,
    result: "unmet",
    note: "Van sai vi",
  });
  issue = (await read("issues")).rows.find((i) => i.id === issue.id);
  check(
    issue.state === "in_progress",
    "M09 failed recheck continues same issue",
  );
  await execute("recheck", {
    id: issue.id,
    version: issue.version,
    result: "met",
    selfFix: true,
    resolution: "Tu xu ly",
    note: "Da dat",
  });
  issue = (await read("issues")).rows.find((i) => i.id === issue.id);
  check(
    issue.state === "done" &&
      (await one("select count(*)::int n from ops_q_rechecks")).n === 2,
    "M09 rechecks are append-only",
  );
  check(
    (await one("select quality from ops_runs")).quality === "unmet",
    "M09 recheck does not rewrite original check",
  );
  const recurring = (
    await execute("issue", {
      ...issueData,
      title: "Tai phat",
      recurrenceOf: issue.id,
    })
  ).id;
  check(
    (
      await one("select recurrence_of from ops_q_issues where id=$1", [
        recurring,
      ])
    ).recurrence_of === issue.id,
    "M10 recurrence is a separate linked issue",
  );
  await denied(
    () => execute("qc_create", { title: "Self audit", period }),
    "OPS_FORBIDDEN",
    "Q01 manager cannot audit own branch",
  );
  await actor("owner");
  await denied(
    () => execute("qc_create", { title: "Admin audit", period }),
    "OPS_FORBIDDEN",
    "Q01 owner configure is not implicit QC",
  );
  await actor("qc");
  const audit = (await execute("qc_create", { title: "QC 1", period })).id;
  let qcData = await read("qc", { entity: audit });
  let line = qcData.rows[0];
  check(
    line.result === "unknown" &&
      !qcData.score.official &&
      qcData.score.score === null,
    "Q02/Q03 QC independent and no certified 100 from draft",
  );
  await denied(
    () => execute("qc_complete", { id: audit, version: qcData.audit.version }),
    "OPS_Q_MISSING_RESULT",
    "Q04 incomplete audit cannot finalize",
  );
  await execute("qc_line", {
    id: line.id,
    version: line.version,
    observations: obs(0),
    issues: [{ issueId: recurring }],
    note: "QC doc lap",
  });
  qcData = await read("qc", { entity: audit });
  line = qcData.rows[0];
  const completeReq = crypto.randomUUID(),
    completePayload = { id: audit, version: qcData.audit.version };
  await execute("qc_complete", completePayload, completeReq);
  await execute("qc_complete", completePayload, completeReq);
  qcData = await read("qc", { entity: audit });
  check(
    qcData.score.score === 95 && Number(qcData.score.rewardCents) === 190000000,
    "Q12 score and QC reward come from ledger",
  );
  check(
    (await one("select count(*)::int n from ops_q_events")).n === 1,
    "Q05 completion replay posts once",
  );
  await denied(
    () =>
      execute("qc_line", {
        id: line.id,
        version: line.version,
        observations: obs(1),
      }),
    "OPS_FORBIDDEN",
    "Q09 completed audit immutable",
  );
  const original = await one(
    "select result,observations from ops_q_lines where id=$1",
    [line.id],
  );
  await execute("qc_correct", {
    id: line.id,
    version: line.version,
    observations: obs(1),
    note: "Cham nham",
    evidence: "Bien ban dieu chinh",
  });
  const corrected = await read("report");
  check(
    corrected.score.score === 100,
    "Q10 correction reverses and replaces score",
  );
  check(
    (await one("select result from ops_q_lines where id=$1", [line.id]))
      .result === original.result,
    "Q10 original audit line is preserved",
  );
  check(
    (await one("select count(*)::int n from ops_q_corrections")).n === 1 &&
      (await one("select count(*)::int n from ops_q_events")).n === 3,
    "Q10 correction has immutable record plus reversal and replacement",
  );
  await actor("manager");
  let recurrence = (await read("issues")).rows.find((i) => i.id === recurring);
  await execute("recheck", {
    id: recurring,
    version: recurrence.version,
    result: "met",
    selfFix: true,
    resolution: "Xong",
    note: "Dat",
  });
  check(
    (await read("report")).score.score === 100,
    "Q08 closing issue never refunds points again",
  );
  await actor("outsider");
  await denied(
    () => read(),
    "OPS_FORBIDDEN",
    "Q11 unrelated user cannot browse",
  );
  await actor("other");
  await denied(() => read(), "OPS_FORBIDDEN", "Q11 cross-tenant denied");
  await actor("owner");
  await execute("qc_grant", { userId: ids.qc, active: false });
  await actor("qc");
  await denied(
    () => execute("qc_create", { title: "Revoked", period }),
    "OPS_FORBIDDEN",
    "Revoked QC rejected immediately",
  );
  await actor("accounting");
  const accounting = (
    await execute("accounting", {
      period,
      title: "Hao hut thang",
      numerator: 7,
      denominator: 1000,
      unit: "kg",
      evidence: "Ke toan xac nhan",
    })
  ).id;
  await denied(
    () =>
      execute("accounting", {
        period,
        title: "Invalid",
        numerator: 1,
        denominator: 0,
        unit: "kg",
        evidence: "test",
      }),
    "check constraint",
    "Accounting rejects zero denominator",
  );
  await actor("owner");
  await execute("accounting_approve", { id: accounting, version: 1 });
  check(
    (await read("report")).accounting[0].state === "approved",
    "Accounting approval recorded independently",
  );
  await db.exec("set role authenticated");
  await denied(
    () => db.query("select * from ops_q_events"),
    "permission denied",
    "RLS no direct score reads",
  );
  await denied(
    () =>
      db.query("insert into ops_q_events(tenant_id) values(gen_random_uuid())"),
    "permission denied",
    "RLS no direct score writes",
  );
  await denied(
    () =>
      db.query("select ops_q_new_issue($1,$2)", [
        ids.branch,
        JSON.stringify(issueData),
      ]),
    "permission denied",
    "Private helper cannot be invoked",
  );
  await db.exec("reset role");
  // Repeated-issue deductions must remain valid when the earlier audit is corrected.
  await actor("owner");
  await execute("qc_grant", {
    userId: ids.qc,
    canAudit: true,
    canCorrect: true,
    active: true,
  });
  await actor("qc");
  const open = (await read("issues")).rows.find((i) => i.state === "pending");
  let firstLine = (await read("qc", { entity: audit })).rows[0];
  await execute("qc_correct", {
    id: firstLine.id,
    version: firstLine.version,
    observations: obs(0),
    issues: [{ issueId: open.id }],
    note: "Kiem lai van loi",
    evidence: "Bien ban 2",
  });
  const audit2 = (await execute("qc_create", { title: "QC 2", period })).id;
  let q2 = await read("qc", { entity: audit2 });
  await execute("qc_line", {
    id: q2.rows[0].id,
    version: q2.rows[0].version,
    observations: obs(0),
    issues: [{ issueId: open.id }],
  });
  q2 = await read("qc", { entity: audit2 });
  await execute("qc_complete", { id: audit2, version: q2.audit.version });
  check(
    (await read("report")).score.score === 95,
    "Q06 once-per-issue across two audits deducts once",
  );
  firstLine = (await read("qc", { entity: audit })).rows[0];
  await execute("qc_correct", {
    id: firstLine.id,
    version: firstLine.version,
    observations: obs(1),
    note: "Lan dau cham nham",
    evidence: "Bien ban 3",
  });
  check(
    (await read("report")).score.score === 95,
    "Q10 correction preserves genuine failure in a later audit",
  );
  await denied(
    () =>
      execute("qc_correct", {
        id: firstLine.id,
        version: firstLine.version,
        observations: obs(1),
        note: "Stale",
        evidence: "Stale",
      }),
    "OPS_STALE",
    "Q10 concurrent correction version is rejected",
  );

  await actor("owner");
  // Weekly shared calendar, numeric criteria and two samples remain server evaluated.
  const weekly = crypto.randomUUID(),
    weeklyFamily = crypto.randomUUID();
  await db.query(
    "insert into ops_standards(id,tenant_id,branch_id,family_id,revision,title,scope,assignee_id,frequency,day_number,due_time,effective_from,criteria,status,created_by) values($1,$2,$3,$4,1,'Weekly check','common',$5,'weekly',1,'17:00',$6,$7,'approved',$8)",
    [
      weekly,
      ids.tenant,
      ids.branch,
      weeklyFamily,
      ids.manager,
      day,
      JSON.stringify(criteria),
      ids.owner,
    ],
  );
  await db.query("select ops_generate_internal($1,$2)", [ids.branch, day]);
  await db.query("select ops_generate_internal($1,$2)", [ids.branch, day]);
  check(
    (
      await one("select count(*)::int n from ops_runs where standard_id=$1", [
        weekly,
      ])
    ).n <= 1,
    "M02 weekly calendar never duplicates a week",
  );
  const evaluations = (
    await one("select ops_evaluate($1,$2) value", [
      JSON.stringify([{ ...criteria[0], samples: 2 }]),
      JSON.stringify(obs(1)),
    ])
  ).value;
  check(
    evaluations.quality === "unknown",
    "M04 all required samples must be present",
  );
  // Shared actor upload path uses the same private evidence bucket.
  await actor("manager2");
  const evidence = await one(
    "select ops_evidence_reserve($1,$2,$3,$4,$5) value",
    ["run", run.id, "proof.png", "image/png", 100],
  );
  check(
    evidence.value.path.startsWith(ids.tenant + "/"),
    "Shared manager can reserve private evidence on shared schedule",
  );
  await actor("qc");
  const evQc = await one("select ops_evidence_reserve($1,$2,$3,$4,$5) value", [
    "qc_line",
    firstLine.id,
    "correct.pdf",
    "application/pdf",
    100,
  ]);
  check(
    evQc.value.entity_kind === "qc_line",
    "QC attachment uses scoped private evidence",
  );
  await actor("other");
  await denied(
    () =>
      one("select ops_evidence_reserve($1,$2,$3,$4,$5) value", [
        "qc_line",
        firstLine.id,
        "x.pdf",
        "application/pdf",
        100,
      ]),
    "OPS_FORBIDDEN",
    "Cross-tenant attachment denied",
  );
  await actor("manager");
  let reassign = (await read("issues")).rows.find((i) => i.state === "pending");
  const originalDue = reassign.original_due_at;
  await execute("issue_assign", {
    id: reassign.id,
    version: reassign.version,
    assigneeId: ids.manager2,
    dueAt: day + "T18:00:00+07:00",
    note: "Ban giao ca",
  });
  reassign = (await read("issues")).rows.find((i) => i.id === reassign.id);
  check(
    reassign.assignee_id === ids.manager2 &&
      reassign.original_due_at === originalDue,
    "M11 reassign preserves original deadline",
  );
  await denied(
    () =>
      execute("recheck", {
        id: reassign.id,
        version: reassign.version,
        result: "met",
        selfFix: true,
        note: "wrong manager",
        resolution: "x",
      }),
    "OPS_FORBIDDEN",
    "Previous manager cannot close after reassignment",
  );
  await actor("owner");
  // Real bonus and critical criteria, with independent results in another branch.
  const bonusStandard = crypto.randomUUID(),
    bonusFamily = crypto.randomUUID();
  await db.query(
    "insert into ops_standards(id,tenant_id,branch_id,family_id,revision,title,scope,assignee_id,frequency,due_time,effective_from,criteria,status,created_by) values($1,$2,$3,$4,1,'Bonus check','common',$5,'daily','17:00',$6,$7,'approved',$8)",
    [
      bonusStandard,
      ids.tenant,
      ids.branch,
      bonusFamily,
      ids.manager,
      day,
      JSON.stringify(criteria),
      ids.owner,
    ],
  );
  await execute("catalog", {
    standardId: bonusStandard,
    code: "QC-BONUS",
    category: "operations",
    scoreType: "bonus",
    weight: 5,
    effectiveFrom: day,
  });
  await actor("qc");
  const bonusAudit = (
    await execute("qc_create", { title: "Bonus audit", period })
  ).id;
  let bonusData = await read("qc", { entity: bonusAudit });
  const bonusLine = bonusData.rows.find(
    (l) => l.item_snapshot.score_type === "bonus",
  );
  const otherLine = bonusData.rows.find(
    (l) => l.item_snapshot.score_type === "deduct",
  );
  await denied(
    () =>
      execute("qc_line", {
        id: bonusLine.id,
        version: bonusLine.version,
        observations: obs(1),
      }),
    "OPS_Q_EVIDENCE_REQUIRED",
    "Q07 bonus pass needs evidence",
  );
  await execute("qc_line", {
    id: bonusLine.id,
    version: bonusLine.version,
    observations: obs(0),
    issues: [{ issueId: open.id }],
  });
  await execute("qc_line", {
    id: otherLine.id,
    version: otherLine.version,
    observations: obs(1),
  });
  bonusData = await read("qc", { entity: bonusAudit });
  await execute("qc_complete", {
    id: bonusAudit,
    version: bonusData.audit.version,
  });
  check(
    Number(
      (
        await one(
          "select delta from ops_q_events where line_id=$1 and kind='initial'",
          [bonusLine.id],
        )
      ).delta,
    ) === 0,
    "Q07 bonus fail is never a deduction",
  );
  await actor("owner");
  const beforeImport = (await one("select count(*)::int n from ops_q_catalog"))
    .n;
  await denied(
    () =>
      execute("catalog_import", {
        rows: [
          {
            standardId: bonusStandard,
            code: "VALID-NEW",
            accountingRequired: false,
            category: "operations",
            scoreType: "deduct",
            weight: 5,
            effectiveFrom: day,
          },
          {
            standardId: bonusStandard,
            code: "INVALID",
            accountingRequired: false,
            category: "operations",
            scoreType: "deduct",
            weight: -5,
            effectiveFrom: day,
          },
        ],
      }),
    "OPS_INVALID_RESULT",
    "Excel batch is atomic on invalid later row",
  );
  check(
    (await one("select count(*)::int n from ops_q_catalog")).n === beforeImport,
    "Excel invalid batch commits no valid prefix",
  );
  check(
    (await one("select count(*)::int n from stock_movements")).n === 0 &&
      (await one("select count(*)::int n from invoices")).n === 0 &&
      (await one("select count(*)::int n from cash_book")).n === 0,
    "Stock sales finance sentinels unchanged",
  );
  console.log(`Hub quality database acceptance: ${passed} assertions passed`);
  return passed;
};
