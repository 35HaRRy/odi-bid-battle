import { useState } from "react";
import { createPortal } from "react-dom";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";

export function ImagePreview({
  lang,
  src,
  alt,
  className,
  imgClassName,
  emptyLabel,
  enlargeLabel,
}: {
  lang: Lang;
  src: string | null;
  alt: string;
  className?: string;
  imgClassName?: string;
  emptyLabel?: string;
  enlargeLabel?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [enlarged, setEnlarged] = useState(false);

  const frameClass = className ? `image-preview ${className}` : "image-preview";
  if (!src || failed) {
    return (
      <div className={frameClass}>
        <span
          className="image-broken"
          role="img"
          aria-label={alt || emptyLabel || t(lang, "noImage")}
          title={t(lang, "imageLoadFail")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="9" cy="10" r="1.6" />
            <path d="M4 18l5-5 3 3 3-3 5 5" />
            <path d="M4 4l16 16" />
          </svg>
        </span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className={frameClass}
        onClick={() => setEnlarged(true)}
        aria-label={enlargeLabel ?? `${t(lang, "enlargeImage")}: ${alt}`}
        title={enlargeLabel ?? t(lang, "enlargeImage")}
      >
        <img
          src={src}
          alt={alt}
          className={imgClassName}
          onError={() => setFailed(true)}
        />
      </button>
      {enlarged &&
        createPortal(
          <Modal titleId="image-enlarge-title" onClose={() => setEnlarged(false)} nested>
            <dialog aria-labelledby="image-enlarge-title" className="image-dialog">
              <h2 id="image-enlarge-title" className="sr-only">
                {alt || t(lang, "image")}
              </h2>
              <img src={src} alt={alt} className="image-full" onError={() => setFailed(true)} />
              <div className="dialog-actions">
                <button type="button" className="secondary" autoFocus onClick={() => setEnlarged(false)}>
                  {t(lang, "close")}
                </button>
              </div>
            </dialog>
          </Modal>,
          document.body,
        )}
    </>
  );
}
