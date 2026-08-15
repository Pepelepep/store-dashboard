# Branch workflow

## Long-lived branches

- `marketplace/stable-prep` is the only active development and release branch.
  It is GitHub's default branch and Render deploys it automatically.
- `main` is retained only for the legacy app that still depends on it. Do not
  merge Marketplace changes into `main` without explicit approval.

No other long-lived branch should remain in the repository.

## Normal change flow

1. Start from the latest `marketplace/stable-prep`.
2. For a non-trivial change, create a short-lived branch and open a pull
   request back to `marketplace/stable-prep`.
3. Wait for the GitHub `quality-gate` check to pass.
4. Merge with a linear history and delete the short-lived branch immediately.
5. Confirm Render is live for the merged SHA and check `/healthz` plus
   operational queue health.

Small authorized operational changes may be committed directly only when the
protected branch accepts them and the same quality gate has already validated
the exact commit.

## Hotfix rule

Create hotfixes from `marketplace/stable-prep` and merge them back into that
same branch. Never use `main` as the hotfix source for Marketplace.
