import { execFileSync } from "node:child_process";
import process from "node:process";

const base = process.env.CHANGE_BASE ?? "origin/marketplace/stable-prep";
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
