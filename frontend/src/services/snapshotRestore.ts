import type { SnapshotPriority, SnapshotRestoreOptions } from "./api";

export interface SnapshotRestoreValues {
  priority: SnapshotPriority;
  checksum?: string;
  confirmation: string;
}

export const buildSnapshotRestoreOptions = (
  collectionName: string,
  values: SnapshotRestoreValues,
): SnapshotRestoreOptions => {
  if (values.confirmation.trim() !== collectionName) {
    throw new Error(`Type ${collectionName} exactly to confirm the restore.`);
  }

  const checksum = values.checksum?.trim().toLowerCase();
  if (checksum && !/^[a-f0-9]{64}$/.test(checksum)) {
    throw new Error("Checksum must be a 64-character SHA-256 value.");
  }

  return {
    priority: values.priority,
    ...(checksum ? { checksum } : {}),
  };
};
