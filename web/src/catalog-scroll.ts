import type { Candidate } from "./api";
import type { Lang } from "./i18n";

export function applyCatalogEdit(
  items: Candidate[],
  editingId: string,
  updated: Candidate,
): { items: Candidate[]; scrollId: string | null } {
  if (updated.id === editingId) {
    return {
      items: items.map((c) => (c.id === updated.id ? updated : c)),
      scrollId: null,
    };
  }
  return {
    items: [...items.filter((c) => c.id !== editingId), updated],
    scrollId: updated.id,
  };
}

export function applyCatalogCreate(
  items: Candidate[],
  created: Candidate,
): { items: Candidate[]; scrollId: string } {
  return { items: [...items, created], scrollId: created.id };
}

export function searchForVisibleRecord(
  search: string,
  name: string,
  lang: Lang,
): string {
  if (!search) return search;
  return name.toLocaleLowerCase(lang).includes(search.toLocaleLowerCase(lang))
    ? search
    : "";
}
