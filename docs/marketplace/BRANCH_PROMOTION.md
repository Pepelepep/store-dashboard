# Custom to Marketplace promotion

## Branch roles

- `custom/local-friend-deployment` is the active integration branch. New work
  lands here first and is validated against the real Custom app.
- `marketplace/stable-prep` is the Marketplace release-candidate branch. Render
  deploys this branch.
- Both branches contain the same application code at each completed promotion.
  Their Shopify TOML files remain intentionally distinct because the Custom and
  Marketplace registrations use different credentials, hosts, and databases.

GitHub's default branch is `custom/local-friend-deployment`. The old feature
branch must never be used as the base for new work.

## Normal release flow

1. Work on a short-lived branch created from
   `custom/local-friend-deployment`.
2. Merge the change into `custom/local-friend-deployment` and push it.
3. Wait for the GitHub `quality-gate` check to pass.
4. Run `npm run release:marketplace:check` for a non-mutating fast-forward
   preflight.
5. Run `npm run release:marketplace` to repeat the complete verification and
   promote the exact Custom SHA to `marketplace/stable-prep`.
6. Confirm Render is live for that SHA and check `/healthz` plus operational
   queue health.

The promotion command refuses dirty worktrees, unpushed commits, the wrong
source branch, and divergent histories. It never force-pushes.

## Hotfix rule

Do not commit a hotfix only to `marketplace/stable-prep`. Apply it to a branch
from `custom/local-friend-deployment`, merge it back to Custom, validate it,
then use the same promotion flow. This prevents Marketplace-only fixes from
being lost in the next release.

