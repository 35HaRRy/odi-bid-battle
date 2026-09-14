import { useRef } from "react";
import { t, type Lang } from "./i18n";
import { useImagePreview } from "./use-image-preview";
import { ImagePreview } from "./image-preview";

export function ImageField({
  lang,
  label,
  accept,
  file,
  savedSrc,
  savedAlt,
  unsaved = false,
  busy = false,
  busyLabel,
  error = null,
  emptyLabel,
  onSelect,
}: {
  lang: Lang;
  label: string;
  accept: string;
  file: File | null;
  savedSrc: string | null;
  savedAlt: string;
  unsaved?: boolean;
  busy?: boolean;
  busyLabel?: string;
  error?: string | null;
  emptyLabel?: string;
  onSelect: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedUrl = useImagePreview(file);
  const src = selectedUrl ?? savedSrc;
  const showUnsaved = unsaved && !!selectedUrl;

  return (
    <div className="image-field">
      <div className="image-field-head">
        <span>{label}</span>
        <button
          type="button"
          className="secondary small-btn"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {savedSrc || selectedUrl ? t(lang, "changeImage") : t(lang, "uploadImage")}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        aria-label={label}
        hidden
        disabled={busy}
        onChange={(e) => {
          onSelect(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      <ImagePreview lang={lang} src={src} alt={savedAlt} emptyLabel={emptyLabel} />
      <div className="image-status-row" aria-live="polite">
        {busy && <span className="image-status">{busyLabel ?? t(lang, "imagePreparing")}</span>}
        {!busy && showUnsaved && <span className="image-status">{t(lang, "imageUnsaved")}</span>}
        {!busy && error && (
          <span className="image-status error" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
