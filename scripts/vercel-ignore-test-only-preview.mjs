import { execFileSync } from "node:child_process";

const { VERCEL_ENV, VERCEL_GIT_COMMIT_REF, VERCEL_GIT_PREVIOUS_SHA } = process.env;
const testDirectories = ["src/__tests__/", "scripts/staff-access-tests/"];

function getBuildDecision() {
  if (VERCEL_ENV !== "preview" || VERCEL_GIT_COMMIT_REF !== "codex/preview-build-filter-pilot") {
    return "Outside the preview pilot";
  }
  if (!/^[a-f0-9]{40}$/.test(VERCEL_GIT_PREVIOUS_SHA ?? "")) {
    return "No previous successful deployment SHA";
  }

  try {
    execFileSync("git", ["merge-base", "--is-ancestor", VERCEL_GIT_PREVIOUS_SHA, "HEAD"], {
      stdio: "ignore",
    });
    const changedFiles = execFileSync(
      "git",
      ["diff", "--name-only", "--no-renames", "-z", VERCEL_GIT_PREVIOUS_SHA, "HEAD", "--"],
      { encoding: "utf8" },
    ).split("\0").filter(Boolean);

    if (changedFiles.length === 0) return "No changed files to classify";
    if (changedFiles.every((file) => testDirectories.some((directory) => file.startsWith(directory)))) {
      return null;
    }
    return "Changes outside test directories";
  } catch {
    return "Cannot compare against the previous successful deployment";
  }
}

const buildReason = getBuildDecision();
if (buildReason === null) {
  console.log("Skipping preview build: all changes since the previous successful deployment are tests.");
  process.exitCode = 0;
} else {
  console.log(`Continuing build: ${buildReason}.`);
  process.exitCode = 1;
}
