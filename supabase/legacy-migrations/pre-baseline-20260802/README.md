# Pre-baseline ShopOps migrations

This directory preserves the original ShopOps migration chain through
`20260731120000`. The archived SQL files are retained byte-for-byte for audit
and provenance, but the chain is not safe to replay as an active Supabase
migration history.

The legacy chain is unreplayable for two independent reasons:

- Supabase identifies migrations by the filename version prefix, but this
  chain contains duplicate versions: `20260527` appears twice, `20260601`
  appears twice, and `20260618` appears three times.
- The linked project's recorded migration history is incomplete: it contains
  only version `20260727120000`, rather than the preceding local chain that
  produced the reviewed remote schema.

The reviewed schema confirms the structural result of the legacy chain, but
four data backfills cannot be verified from a schema-only dump:

1. `20260708200000_add_staff_identity_mapping.sql` backfilled staff people and
   identity aliases.
2. `20260711200000_staff_centered_access.sql` backfilled identity aliases and
   person-based access relationships.
3. `20260725120000_remove_automatic_cogs_fallback.sql` rewrote stored COGS
   values and sources.
4. `20260731120000_dashboard_memberships_and_reporting_locations.sql`
   backfilled reporting locations, dashboard memberships, and access links.

The active migration directory retains a SQL-comment-only
`20260727120000_remote_history_anchor.sql`. That no-op file preserves alignment
with the version already present in remote migration history; the original
July 27 RPC migration remains archived here.

Archived files in this directory must never be placed back into
`supabase/migrations`. New environments must start from the reviewed baseline
and continue through the active migrations.
