export const MKT_AUDIT_SCENARIOS = [
  {
    key: "TEST-01",
    name: "B\u1eaft \u0111\u1ea7u vi\u1ec7c tr\u01b0\u1edbc khi nh\u1eadn",
    expected: "H\u1ec7 th\u1ed1ng t\u1eeb ch\u1ed1i chuy\u1ec3n sang \u0111ang l\u00e0m",
  },
  {
    key: "TEST-02",
    name: "B\u1eaft \u0111\u1ea7u khi vi\u1ec7c ph\u1ee5 thu\u1ed9c ch\u01b0a xong",
    expected: "H\u1ec7 th\u1ed1ng ch\u1eb7n v\u00ec c\u00f2n ph\u1ee5 thu\u1ed9c",
  },
  {
    key: "TEST-03",
    name: "N\u1ed9p n\u1ed9i dung thi\u1ebfu li\u00ean k\u1ebft",
    expected: "H\u1ec7 th\u1ed1ng t\u1eeb ch\u1ed1i b\u1ea3n n\u1ed9p thi\u1ebfu",
  },
  {
    key: "TEST-04",
    name: "\u0110\u0103ng tr\u01b0\u1edbc khi n\u1ed9i dung \u0111\u01b0\u1ee3c duy\u1ec7t",
    expected: "H\u1ec7 th\u1ed1ng ch\u1eb7n \u0111\u0103ng n\u1ed9i dung",
  },
  {
    key: "TEST-05",
    name: "Leader ho\u00e0n t\u1ea5t c\u01b0\u1ee1ng b\u1ee9c kh\u00f4ng n\u00eau l\u00fd do",
    expected: "H\u1ec7 th\u1ed1ng y\u00eau c\u1ea7u l\u00fd do",
  },
  {
    key: "TEST-06",
    name: "Ng\u01b0\u1eddi kh\u00f4ng c\u00f3 quy\u1ec1n thay ng\u01b0\u1eddi duy\u1ec7t",
    expected: "H\u1ec7 th\u1ed1ng t\u1eeb ch\u1ed1i do thi\u1ebfu quy\u1ec1n",
  },
  {
    key: "TEST-07",
    name: "B\u00e1o b\u1ecb ch\u1eb7n nh\u01b0ng thi\u1ebfu \u0111\u1ea7u v\u00e0o b\u00ean ngo\u00e0i",
    expected: "H\u1ec7 th\u1ed1ng y\u00eau c\u1ea7u ghi r\u00f5 \u0111\u1ea7u v\u00e0o",
  },
  {
    key: "TEST-08",
    name: "Chuy\u1ec3n ng\u01b0\u1eddi l\u00e0m v\u00e0 ghi nh\u1eadt k\u00fd",
    expected: "Cho ph\u00e9p v\u00e0 c\u00f3 nh\u1eadt k\u00fd ki\u1ec3m so\u00e1t",
  },
  {
    key: "TEST-09",
    name: "Ch\u1ea1y chi\u1ebfn d\u1ecbch khi m\u1ee9c s\u1eb5n s\u00e0ng d\u01b0\u1edbi 100%",
    expected: "H\u1ec7 th\u1ed1ng ch\u1eb7n kh\u1edfi ch\u1ea1y",
  },
  {
    key: "TEST-10",
    name: "Y\u00eau c\u1ea7u s\u1eeda nh\u01b0ng kh\u00f4ng ghi nh\u1eadn x\u00e9t",
    expected: "H\u1ec7 th\u1ed1ng y\u00eau c\u1ea7u nh\u1eadn x\u00e9t",
  },
] as const;

export type MktAuditScenarioKey = (typeof MKT_AUDIT_SCENARIOS)[number]["key"];

export type MktAuditResult = {
  scenarioKey: string;
  expected: string;
  actual: string;
  errorCode: string | null;
  auditRecorded: boolean;
  result: "PASS" | "FAIL" | "ERROR";
  durationMs?: number;
};

export type MktAuditRun = {
  id: string;
  status: "running" | "completed" | "failed";
  totalCount: number;
  passedCount: number;
  failedCount: number;
  startedAt: string;
  completedAt: string | null;
  results: MktAuditResult[];
};

export type MktAuditSandboxState = {
  ready: boolean;
  sandboxId?: string;
  sandboxTenantId?: string;
  actorCount?: number;
  latestRun?: MktAuditRun | null;
};
