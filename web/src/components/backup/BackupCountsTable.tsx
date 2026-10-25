import { useTranslation } from "react-i18next";
import { BACKUP_TABLES, type BackupCounts } from "@/lib/backup";

/**
 * Per-table row counts. `secondary` adds the third column used by the
 * preflight view ("rows in file" vs "rows that will be written").
 */
export function BackupCountsTable({
  counts,
  secondary,
  countLabel,
}: {
  counts: BackupCounts;
  secondary?: BackupCounts;
  /** Overrides the first numeric column header (the import result reuses this
   * table for "rows written"). */
  countLabel?: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-body-sm">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">
              {t("backup.tableLabel")}
            </th>
            <th className="px-3 py-2 text-right font-medium">
              {countLabel ?? t("backup.countLabel")}
            </th>
            {secondary && (
              <th className="px-3 py-2 text-right font-medium">
                {t("backup.writeLabel")}
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y">
          {BACKUP_TABLES.map((table) => (
            <tr key={table}>
              <td className="px-3 py-2">
                {t(`backup.tables.${table}`)}
                <span className="ml-2 font-mono text-caption text-muted-foreground">
                  {table}
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {counts?.[table] ?? 0}
              </td>
              {secondary && (
                <td className="px-3 py-2 text-right tabular-nums">
                  {secondary[table] ?? 0}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
