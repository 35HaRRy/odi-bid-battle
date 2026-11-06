import type { Visibility } from "./api";
import { t, type Lang } from "./i18n";

export function canEdit(record: Visibility, userId: string): boolean {
  return record.ownerUserId === userId;
}

export function PublicFilter({ checked, onChange, lang }: { checked: boolean; onChange: (checked: boolean) => void; lang: Lang }) {
  return <label className="sharing-field"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />{t(lang, "includePublic")}</label>;
}

export function ShareField({ checked, onChange, lang }: { checked: boolean; onChange: (checked: boolean) => void; lang: Lang }) {
  return <label className="sharing-field"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />{t(lang, "shareRecord")}</label>;
}
