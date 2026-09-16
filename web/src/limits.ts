// Mirrors api/src/limits.ts. The backend enforces the same budgets
// independently; these client-side checks only fail fast with a clear
// message instead of sending a request that cannot succeed.
export const REQUEST_BODY_BUDGET_BYTES = 4_000_000;
export const SINGLE_FILE_LIMIT_BYTES = 3_500_000;

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function isFileTooLarge(file: File | null | undefined): boolean {
  return !!file && file.size > SINGLE_FILE_LIMIT_BYTES;
}

export function isJsonTooLarge(value: unknown): boolean {
  return utf8Bytes(JSON.stringify(value)) > REQUEST_BODY_BUDGET_BYTES;
}
