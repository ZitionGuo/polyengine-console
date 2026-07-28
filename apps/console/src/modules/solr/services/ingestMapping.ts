import type { IngestVectorTarget } from "./api";

const preferredSourceNames = [
  "title",
  "content",
  "text",
  "body",
  "description",
  "summary",
  "name",
];

export const suggestTextFields = (
  vectorField: string,
  uploadFields: string[],
  idField?: string,
) => {
  const candidates = uploadFields.filter((field) => field !== idField);
  const normalizedVector = vectorField.toLowerCase();
  const hinted = candidates.filter(
    (field) =>
      field.length > 2
      && normalizedVector.includes(field.toLowerCase()),
  );
  if (hinted.length) return hinted.slice(0, 2);

  const preferred = preferredSourceNames.filter((field) => candidates.includes(field));
  return (preferred.length ? preferred : candidates).slice(0, 2);
};

export const reconcileVectorTargets = (
  vectorFields: string[],
  uploadFields: string[],
  idField: string | undefined,
  current: IngestVectorTarget[] = [],
) => {
  const available = new Set(vectorFields);
  const retained = current
    .filter((target) => available.has(target.vector_field))
    .filter(
      (target, index, targets) =>
        targets.findIndex((item) => item.vector_field === target.vector_field) === index,
    )
    .map((target) => {
      const textFields = target.text_fields.filter(
        (field) => uploadFields.includes(field) && field !== idField,
      );
      return {
        vector_field: target.vector_field,
        text_fields: textFields.length
          ? textFields
          : suggestTextFields(target.vector_field, uploadFields, idField),
      };
    });

  if (retained.length || !vectorFields.length) return retained;
  return [
    {
      vector_field: vectorFields[0],
      text_fields: suggestTextFields(vectorFields[0], uploadFields, idField),
    },
  ];
};

export const addMissingVectorTargets = (
  vectorFields: string[],
  uploadFields: string[],
  idField: string | undefined,
  current: IngestVectorTarget[] = [],
) => {
  const reconciled = reconcileVectorTargets(
    vectorFields,
    uploadFields,
    idField,
    current,
  );
  const selected = new Set(reconciled.map((target) => target.vector_field));
  return [
    ...reconciled,
    ...vectorFields
      .filter((field) => !selected.has(field))
      .map((field) => ({
        vector_field: field,
        text_fields: suggestTextFields(field, uploadFields, idField),
      })),
  ];
};
