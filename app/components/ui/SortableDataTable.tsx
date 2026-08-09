import { useMemo, useState, type ReactNode } from "react";

type SortDirection = "asc" | "desc";
type SortValue = string | number | null | undefined;

export type SortableDataTableColumn<Row> = {
  key: string;
  label: string;
  align?: "left" | "right";
  minWidth?: number;
  render: (row: Row, index: number) => ReactNode;
  sortValue?: (row: Row) => SortValue;
};

type SortableDataTableProps<Row> = {
  ariaLabel?: string;
  columns: readonly SortableDataTableColumn<Row>[];
  defaultSort?: { key: string; direction: SortDirection };
  emptyMessage?: ReactNode;
  getRowKey: (row: Row, index: number) => string;
  getRowTitle?: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  rows: readonly Row[];
  selectedRowKey?: string | null;
  tableClassName?: string;
};

function compareValues(left: SortValue, right: SortValue) {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function SortableDataTable<Row>({
  ariaLabel,
  columns,
  defaultSort,
  emptyMessage = "No data for this selection.",
  getRowKey,
  getRowTitle,
  onRowClick,
  rows,
  selectedRowKey,
  tableClassName = "",
}: SortableDataTableProps<Row>) {
  const [sort, setSort] = useState(defaultSort ?? null);
  const sortedRows = useMemo(() => {
    if (!sort) return [...rows];
    const column = columns.find((candidate) => candidate.key === sort.key);
    if (!column?.sortValue) return [...rows];
    const direction = sort.direction === "asc" ? 1 : -1;

    return rows
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const result = compareValues(
          column.sortValue?.(left.row),
          column.sortValue?.(right.row),
        );
        return result === 0 ? left.index - right.index : result * direction;
      })
      .map(({ row }) => row);
  }, [columns, rows, sort]);

  const toggleSort = (column: SortableDataTableColumn<Row>) => {
    if (!column.sortValue) return;
    setSort((current) =>
      current?.key === column.key
        ? {
            key: column.key,
            direction: current.direction === "asc" ? "desc" : "asc",
          }
        : { key: column.key, direction: "asc" },
    );
  };

  return (
    <div className="shopops-data-table-scroll">
      <table
        aria-label={ariaLabel}
        className={`shopops-data-table ${tableClassName}`.trim()}
      >
        <thead>
          <tr>
            {columns.map((column) => {
              const activeDirection =
                sort?.key === column.key ? sort.direction : null;
              return (
                <th
                  aria-sort={
                    activeDirection
                      ? activeDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                  data-align={column.align ?? "left"}
                  key={column.key}
                  style={{ minWidth: column.minWidth }}
                >
                  {column.sortValue ? (
                    <button
                      aria-label={`Sort by ${column.label}${
                        activeDirection === "asc"
                          ? ", descending"
                          : ", ascending"
                      }`}
                      className="shopops-data-table__sort"
                      onClick={() => toggleSort(column)}
                      type="button"
                    >
                      <span>{column.label}</span>
                      <span
                        aria-hidden="true"
                        className="shopops-data-table__sort-indicator"
                        data-active={activeDirection ? "true" : "false"}
                      >
                        {activeDirection === "asc"
                          ? "↑"
                          : activeDirection === "desc"
                            ? "↓"
                            : "↕"}
                      </span>
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length > 0 ? (
            sortedRows.map((row, index) => {
              const rowKey = getRowKey(row, index);
              const isSelected = selectedRowKey === rowKey;
              return (
                <tr
                  data-selectable={onRowClick ? "true" : "false"}
                  data-selected={isSelected ? "true" : "false"}
                  key={rowKey}
                  onClick={() => onRowClick?.(row)}
                  onKeyDown={(event) => {
                    if (!onRowClick) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onRowClick(row);
                    }
                  }}
                  role={onRowClick ? "button" : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  title={getRowTitle?.(row)}
                >
                  {columns.map((column) => (
                    <td
                      data-align={column.align ?? "left"}
                      key={column.key}
                      style={{ minWidth: column.minWidth }}
                    >
                      {column.render(row, index)}
                    </td>
                  ))}
                </tr>
              );
            })
          ) : (
            <tr>
              <td
                className="shopops-data-table__empty"
                colSpan={columns.length}
              >
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
