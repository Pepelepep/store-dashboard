export type ShopifyStaffCsvRow = {
  sellerId: string;
  displayName: string;
  locations: string[];
  netSales: string[];
};

export type ShopifyStaffCsvConflict = {
  sellerId: string;
  names: string[];
};

export type ShopifyStaffCsvResult = {
  rows: ShopifyStaffCsvRow[];
  conflicts: ShopifyStaffCsvConflict[];
  ignoredRows: number;
};

const REQUIRED_COLUMNS = [
  "assisting_staff_member_id",
  "assisting_staff_member_name",
] as const;

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCsvRecords(csv: string) {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      record.push(field);
      if (record.some((value) => value.trim())) records.push(record);
      record = [];
      field = "";
    } else {
      field += character;
    }
  }

  record.push(field);
  if (record.some((value) => value.trim())) records.push(record);
  return records;
}

export function parseShopifyStaffCsv(csv: string): ShopifyStaffCsvResult {
  const records = parseCsvRecords(csv);
  if (records.length === 0) throw new Error("The CSV file is empty.");

  const headers = records[0].map(normalizeHeader);
  const columns = new Map(headers.map((header, index) => [header, index]));
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.has(column));
  if (missing.length) {
    throw new Error(
      `Missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
    );
  }

  const candidates = new Map<
    string,
    Map<string, { locations: Set<string>; netSales: Set<string> }>
  >();
  let ignoredRows = 0;
  const valueAt = (record: string[], name: string) =>
    record[columns.get(name) ?? -1]?.trim() ?? "";

  for (const record of records.slice(1)) {
    const sellerId = valueAt(record, "assisting_staff_member_id");
    const displayName = valueAt(record, "assisting_staff_member_name").replace(
      /\s+/g,
      " ",
    );
    if (!sellerId || !displayName) {
      ignoredRows += 1;
      continue;
    }
    const names = candidates.get(sellerId) ?? new Map();
    const context = names.get(displayName) ?? {
      locations: new Set<string>(),
      netSales: new Set<string>(),
    };
    const location = valueAt(record, "pos_location_name");
    const netSales = valueAt(record, "net_sales");
    if (location) context.locations.add(location);
    if (netSales) context.netSales.add(netSales);
    names.set(displayName, context);
    candidates.set(sellerId, names);
  }

  const rows: ShopifyStaffCsvRow[] = [];
  const conflicts: ShopifyStaffCsvConflict[] = [];
  for (const [sellerId, names] of candidates) {
    if (names.size > 1) {
      conflicts.push({ sellerId, names: [...names.keys()].sort() });
      continue;
    }
    const [displayName, context] = [...names.entries()][0];
    rows.push({
      sellerId,
      displayName,
      locations: [...context.locations],
      netSales: [...context.netSales],
    });
  }

  return { rows, conflicts, ignoredRows };
}
