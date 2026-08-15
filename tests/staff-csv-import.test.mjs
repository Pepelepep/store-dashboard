import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseShopifyStaffCsv } from "../app/lib/staff-identity/shopify-staff-csv.ts";

test("Shopify staff CSV accepts the Analytics export headers and groups locations", () => {
  const result = parseShopifyStaffCsv(`Assisting staff member ID,Assisting staff member name,POS location name,Net sales
90229637318,Adriana Contreras Jaime,Vieux-Port,8230.09
90229637318,Adriana Contreras Jaime,CF Carrefour Laval,120.50
96766001350,Amanda Defilló,Downtown Montreal,43065.84
`);

  assert.equal(result.conflicts.length, 0);
  assert.equal(result.ignoredRows, 0);
  assert.deepEqual(result.rows, [
    {
      sellerId: "90229637318",
      displayName: "Adriana Contreras Jaime",
      locations: ["Vieux-Port", "CF Carrefour Laval"],
      netSales: ["8230.09", "120.50"],
    },
    {
      sellerId: "96766001350",
      displayName: "Amanda Defilló",
      locations: ["Downtown Montreal"],
      netSales: ["43065.84"],
    },
  ]);
});

test("staff CSV import can seed names before a seller appears in ShopOps sales", async () => {
  const route = await readFile(
    new URL("../app/routes/app.admin.staff.tsx", import.meta.url),
    "utf8",
  );
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260815130000_import_shopify_staff_csv_mappings.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(route, /const importableRows = \[\.\.\.exactRows, \.\.\.unmatchedRows\]/);
  assert.match(route, /sellerId: row\.sellerId/);
  assert.match(route, /import_shopify_staff_csv_mappings/);
  assert.match(migration, /'shopify_analytics_csv'/);
  assert.match(migration, /jsonb_array_length\(p_mappings\) > 1000/);
  assert.match(
    migration,
    /ON CONFLICT \(shop_domain, alias_type, alias_value\)[\s\S]*DO NOTHING/,
  );
});
