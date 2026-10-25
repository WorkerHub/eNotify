import { BackupSection } from "@/components/backup/BackupSection";

/** Admin 区「备份与恢复」：全站（instance）档导出 / 导入。 */
export function AdminBackupPage() {
  return (
    <div className="max-w-2xl">
      <BackupSection scope="instance" />
    </div>
  );
}
