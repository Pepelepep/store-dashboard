import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";

const DEVELOPMENT_BRANCH = "custom/local-friend-deployment";
const RELEASE_BRANCH = "marketplace/stable-prep";
const push = process.argv.includes("--push");
const unsupportedArgs = process.argv.slice(2).filter((arg) => arg !== "--push");

if (unsupportedArgs.length > 0) {
  throw new Error(`Unsupported arguments: ${unsupportedArgs.join(", ")}`);
}

function git(args, { inherit = false } = {}) {
  const output = execFileSync("git", args, {
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });

  return typeof output === "string" ? output.trim() : "";
}

function assertAncestor(ancestor, descendant) {
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", ancestor, descendant],
    { stdio: "ignore" },
  );
  if (result.status !== 0) {
    throw new Error(
      `${RELEASE_BRANCH} has diverged from ${DEVELOPMENT_BRANCH}. Resolve the history explicitly before promoting; this command never force-pushes.`,
    );
  }
}

const currentBranch = git(["branch", "--show-current"]);
if (currentBranch !== DEVELOPMENT_BRANCH) {
  throw new Error(
    `Run this command from ${DEVELOPMENT_BRANCH}; current branch is ${currentBranch || "detached HEAD"}.`,
  );
}

if (git(["status", "--porcelain"])) {
  throw new Error("The worktree must be clean before a Marketplace promotion.");
}

git([
  "fetch",
  "origin",
  `refs/heads/${DEVELOPMENT_BRANCH}:refs/remotes/origin/${DEVELOPMENT_BRANCH}`,
  `refs/heads/${RELEASE_BRANCH}:refs/remotes/origin/${RELEASE_BRANCH}`,
]);

const head = git(["rev-parse", "HEAD"]);
const developmentRemote = git([
  "rev-parse",
  `refs/remotes/origin/${DEVELOPMENT_BRANCH}`,
]);
const releaseRemote = git([
  "rev-parse",
  `refs/remotes/origin/${RELEASE_BRANCH}`,
]);

if (head !== developmentRemote) {
  throw new Error(
    `${DEVELOPMENT_BRANCH} must be pushed before promotion. Local HEAD and origin differ.`,
  );
}

assertAncestor(releaseRemote, developmentRemote);

if (releaseRemote === developmentRemote) {
  console.log(
    `Marketplace already aligned at ${developmentRemote.slice(0, 7)}.`,
  );
  process.exit(0);
}

if (!push) {
  console.log(
    `Promotion is safe: ${RELEASE_BRANCH.slice(0)} can fast-forward from ${releaseRemote.slice(0, 7)} to ${developmentRemote.slice(0, 7)}.`,
  );
  console.log("Run npm run release:marketplace to verify and promote.");
  process.exit(0);
}

git(
  [
    "push",
    "origin",
    `${developmentRemote}:refs/heads/${RELEASE_BRANCH}`,
  ],
  { inherit: true },
);
git([
  "fetch",
  "origin",
  `refs/heads/${RELEASE_BRANCH}:refs/remotes/origin/${RELEASE_BRANCH}`,
]);

const promotedRelease = git([
  "rev-parse",
  `refs/remotes/origin/${RELEASE_BRANCH}`,
]);
if (promotedRelease !== developmentRemote) {
  throw new Error("Marketplace promotion completed without exact SHA parity.");
}

console.log(
  `Marketplace promoted successfully: both branches are ${developmentRemote}.`,
);
