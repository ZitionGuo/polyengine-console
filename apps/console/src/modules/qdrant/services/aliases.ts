import type { AliasSummary, AliasUpdatePayload } from "./api";

export interface AliasEditValues {
  aliasName: string;
  collectionName: string;
}

export const buildAliasUpdatePayload = (
  current: AliasSummary,
  values: AliasEditValues,
): AliasUpdatePayload => {
  const aliasName = values.aliasName.trim();
  const collectionName = values.collectionName.trim();
  if (!aliasName || !collectionName) {
    throw new Error("Alias and collection are required.");
  }

  const payload: AliasUpdatePayload = {};
  if (aliasName !== current.alias_name) {
    payload.new_alias_name = aliasName;
  }
  if (collectionName !== current.collection_name) {
    payload.collection_name = collectionName;
  }
  if (!payload.new_alias_name && !payload.collection_name) {
    throw new Error("No alias changes to save.");
  }
  return payload;
};
