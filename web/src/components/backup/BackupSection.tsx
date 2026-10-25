import { useTranslation } from "react-i18next";
import type { BackupScope } from "@/lib/backup";
import { BackupExportPanel } from "./BackupExportPanel";
import { BackupImportPanel } from "./BackupImportPanel";

/**
 * Shared 导出 / 导入 block, used by both entry points:
 * - personal scope (`scope="user"`) in Settings → 备份与恢复
 * - instance scope (`scope="instance"`) in Admin → 备份与恢复
 */
export function BackupSection({ scope }: { scope: BackupScope }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-title text-foreground">{t("backup.title")}</h2>
        <p className="text-body-sm text-muted-foreground mt-1">
          {t(
            scope === "instance"
              ? "backup.instanceDescription"
              : "backup.userDescription",
          )}
        </p>
      </div>

      <BackupExportPanel scope={scope} />
      <BackupImportPanel scope={scope} />
    </div>
  );
}
