import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import process from "node:process";

const base = process.env.CHANGE_BASE ?? "origin/marketplace/stable-prep";

// CI checkouts (actions/checkout) only fetch the ref being built, so a remote-tracking
// branch like origin/marketplace/stable-prep may not exist locally yet even with
// fetch-depth: 0. Make sure it's resolvable before diffing against it.
try {
  execFileSync("git", ["rev-parse", "--verify", "--quiet", base], { stdio: "ignore" });
} catch {
  const [remote, ...branchParts] = base.split("/");
  const branch = branchParts.join("/");
  if (branch) {
    execFileSync(
      "git",
      ["fetch", remote, `${branch}:refs/remotes/${remote}/${branch}`],
      { stdio: "ignore" },
    );
  }
}

const output = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
  encoding: "utf8",
});
const files = output.split("\n").filter(Boolean);

const categories = {
  shopify: /(^shopify\.|shopify\.server|\/shopify\/|\/webhooks\.|billing|entitlement)/,
  data: /(^supabase\/|^prisma\/|\/db\/|\.server\.)/,
  authorization: /(auth|permission|access|role|scope)/,
  ui: /(^app\/components\/|^app\/routes\/.*\.tsx$|^app\/styles\/)/,
  delivery: /(^\.github\/|^tests\/|^scripts\/delivery\/|AGENTS\.md|CLAUDE\.md)/,
};

const matched = Object.fromEntries(
  Object.entries(categories).map(([name, pattern]) => [
    name,
    files.filter((file) => pattern.test(file)),
  ]),
);

console.log(JSON.stringify({ base, fileCount: files.length, files, matched }, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    "## Delivery risk classification",
    "",
    `Diff base: \`${base}\` (${files.length} file(s) changed)`,
    "",
    "| Surface | Files |",
    "| --- | --- |",
    ...Object.entries(matched).map(
      ([name, matchedFiles]) =>
        `| ${name} | ${matchedFiles.length ? matchedFiles.map((f) => `\`${f}\``).join("<br>") : "—"} |`,
    ),
    "",
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
}
