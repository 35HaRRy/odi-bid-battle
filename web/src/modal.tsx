import { useEffect, useRef, type ReactNode } from "react";

const openModals: Array<() => void> = [];

export function Modal({
  titleId,
  onClose,
  children,
  nested = false,
}: {
  titleId: string;
  onClose: () => void;
  children: ReactNode;
  nested?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<Element | null>(null);

  useEffect(() => {
    prevFocus.current = document.activeElement;
    const el = boxRef.current?.querySelector<HTMLElement>(
      "input,textarea,select,button",
    );
    el?.focus();
    openModals.push(onClose);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openModals[openModals.length - 1] === onClose) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const idx = openModals.lastIndexOf(onClose);
      if (idx >= 0) openModals.splice(idx, 1);
      (prevFocus.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className={`modal-overlay${nested ? " nested" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-box"
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {children}
      </div>
    </div>
  );
}
