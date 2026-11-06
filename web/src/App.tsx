import { useEffect, useRef, useState } from "react";
import { ApiError, api, type Auction, type Candidate, type CandidateList, type CandidateContext } from "./api";
import { getLang, t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ImageField } from "./image-field";
import { ImagePreview } from "./image-preview";
import { BattlefieldLibrary, BattlefieldPreparation } from "./battlefields";
import { DraftTeams } from "./draft-teams";
import { DraftReview } from "./draft-review";
import { LiveCouncil } from "./live-council";
import {
  applyCatalogCreate,
  applyCatalogEdit,
  searchForVisibleRecord,
} from "./catalog-scroll";
import type { FieldError } from "./api";
import { PublicFilter, ShareField, canEdit } from "./sharing";
import { StatisticsPage } from "./statistics";

type Tab = "auctions" | "catalog" | "lists" | "draft" | "live" | "result" | "battlefields" | "statistics";

const TABS: readonly Tab[] = [
  "auctions",
  "catalog",
  "lists",
  "draft",
  "live",
  "result",
  "battlefields",
  "statistics",
];

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as readonly string[]).includes(value);
}

function readTabFromUrl(): Tab {
  if (typeof window === "undefined" || !window.location?.search) return "auctions";
  try {
    const tab = new URLSearchParams(window.location.search).get("tab");
    return isTab(tab) ? tab : "auctions";
  } catch {
    return "auctions";
  }
}

function nameOf(
  candidates: Candidate[],
  id: string,
  extra?: Record<string, string>,
): string {
  return (
    candidates.find((c) => c.id === id)?.name ?? extra?.[id] ?? id
  );
}

function useMissingCandidateNames(
  candidates: Candidate[],
  references: { id: string; context: CandidateContext }[],
  onResolved: (c: Candidate[]) => void,
) {
  const [extra, setExtra] = useState<Record<string, string>>({});
  useEffect(() => {
    const known = new Set(candidates.map((c) => c.id));
    const missing = [...new Map(references.map(ref => [ref.id, ref])).values()]
      .filter(({ id }) => !known.has(id) && !extra[id]);
    if (missing.length === 0) return;
    let live = true;
    (async () => {
      const found: Candidate[] = [];
      for (const { id, context } of missing.slice(0, 20)) {
        try {
          found.push(await api.getCandidate(id, context));
        } catch {
          // keep raw id fallback; existing reference stays visible
        }
      }
      if (!live || found.length === 0) return;
      setExtra((prev) => {
        const next = { ...prev };
        for (const c of found) next[c.id] = c.name;
        return next;
      });
      onResolved(found);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(references), candidates.length]);
  return extra;
}

function Status({ msg }: { msg: string | null }) {
  return (
    <div className={msg ? "status error" : "status"} role="alert">
      {msg ?? ""}
    </div>
  );
}

function CandidateEditDialog({
  lang,
  title,
  description,
  initialName,
  previewUrl,
  onClose,
  onSave,
  initialPublic,
}: {
  lang: Lang;
  title: string;
  description: string;
  initialName: string;
  previewUrl: string;
  onClose: () => void;
  onSave: (name: string, file: File | null, isPublic?: boolean) => void;
  initialPublic?: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [file, setFile] = useState<File | null>(null);
  const [isPublic, setPublic] = useState(initialPublic ?? false);
  return (
    <Modal titleId="editor-title" onClose={onClose}>
      <dialog aria-labelledby="editor-title">
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onSave(name, file, initialPublic === undefined ? undefined : isPublic);
          }}
        >
          <h2 id="editor-title">{title}</h2>
          <p className="description">{description}</p>
          <div className="dialog-fields">
            <label>
              <span>{t(lang, "candidateName")}</span>
              <input
                aria-label={t(lang, "candidateName")}
                value={name}
                maxLength={200}
                required
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <ImageField
              lang={lang}
              label={t(lang, "candidateImage")}
              accept="image/*"
              file={file}
              savedSrc={previewUrl}
              savedAlt={name}
              unsaved
              emptyLabel={t(lang, "noImage")}
              onSelect={setFile}
            />
            <p className="description">{t(lang, "keepImage")}</p>
            {initialPublic !== undefined && <ShareField lang={lang} checked={isPublic} onChange={setPublic} />}
          </div>
          <div className="dialog-actions">
            <button type="button" className="secondary" onClick={onClose}>
              {t(lang, "cancel")}
            </button>
            <button type="submit" className="primary">
              {t(lang, "save")}
            </button>
          </div>
        </form>
      </dialog>
    </Modal>
  );
}

function ConfirmDialog({
  lang,
  title,
  body,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  lang: Lang;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal titleId="app-dialog-title" onClose={onCancel}>
      <dialog aria-labelledby="app-dialog-title">
        <h2 id="app-dialog-title">{title}</h2>
        <p>{body}</p>
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onCancel} autoFocus>
            {t(lang, "cancel")}
          </button>
          <button
            type="button"
            className={danger ? "danger" : "primary"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </dialog>
    </Modal>
  );
}

function AppHeading({
  title,
  intro,
  action,
  headingRef,
}: {
  title: string;
  intro: string;
  action?: React.ReactNode;
  headingRef?: React.RefObject<HTMLHeadingElement>;
}) {
  return (
    <div className="app-heading">
      <div>
        <h1 ref={headingRef}>{title}</h1>
        <p>{intro}</p>
      </div>
      {action && <div className="header-tools">{action}</div>}
    </div>
  );
}

function Steps({
  lang,
  current,
  onSelect,
}: {
  lang: Lang;
  current: number;
  onSelect?: (step: number) => void;
}) {
  const keys = ["stepGeneral", "stepBattle", "stepList", "stepTeams", "stepReview"];
  return (
    <div className="steps" role="list" aria-label={t(lang, "stepList")}>
      {keys.map((k, i) => (
        <button
          key={k}
          role="listitem"
          className="step"
          aria-current={i === current ? "step" : undefined}
          onClick={() => {
            if (onSelect) onSelect(i);
          }}
        >
          <span className="step-num">{i + 1}</span>
          {t(lang, k)}
        </button>
      ))}
    </div>
  );
}

const DRAFT_STEP_KEYS = ["stepGeneral", "stepBattle", "stepList", "stepTeams", "stepReview"] as const;

function DraftStepFooter({
  lang,
  step,
  onGo,
  teamsSaveRef,
  teamsSaveDisabled,
  startDisabled,
  startPending,
  onStart,
}: {
  lang: Lang;
  step: number;
  onGo: (step: number) => void;
  teamsSaveRef: { current: (() => void) | null };
  teamsSaveDisabled: boolean;
  startDisabled: boolean;
  startPending: boolean;
  onStart: () => void;
}) {
  const prevName = step > 0 ? t(lang, DRAFT_STEP_KEYS[step - 1]) : null;
  const nextName = step < 4 ? t(lang, DRAFT_STEP_KEYS[step + 1]) : null;
  return (
    <div className="footer draft-step-footer">
      <div className="draft-foot-side left">
        {step === 0 ? (
          <p className="footer-note align-left nowrap">{t(lang, "footerNote")}</p>
        ) : (
          prevName && (
            <button
              type="button"
              className="secondary small-btn step-nav"
              onClick={() => onGo(step - 1)}
              aria-label={prevName}
            >
              ← {prevName}
            </button>
          )
        )}
      </div>
      <div className="draft-foot-center">
        {step === 1 || step === 2 ? (
          <p className="footer-note nowrap">{t(lang, "footerNote")}</p>
        ) : step === 3 ? (
          <button
            type="button"
            className="primary step-nav"
            disabled={teamsSaveDisabled}
            onClick={() => teamsSaveRef.current?.()}
          >
            {t(lang, "save")}
          </button>
        ) : null}
      </div>
      <div className="draft-foot-side right">
        {step < 4 && nextName ? (
          <button
            type="button"
            className="secondary small-btn step-nav"
            onClick={() => onGo(step + 1)}
            aria-label={nextName}
          >
            {nextName} →
          </button>
        ) : step === 4 ? (
          <button
            type="button"
            className="primary step-nav"
            disabled={startDisabled || startPending}
            title={startDisabled ? t(lang, "startDisabledNote") : undefined}
            onClick={onStart}
          >
            {t(lang, "start")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function CatalogPane({
  lang,
  candidates: ownCandidates,
  userId,
  addedIds,
  onAdd,
  onEdit,
}: {
  lang: Lang;
  userId: string;
  candidates: Candidate[];
  addedIds: string[];
  onAdd: (id: string) => void;
  onEdit?: (id: string, candidate: Candidate) => void;
}) {
  const [search, setSearch] = useState("");
  const [includePublic, setIncludePublic] = useState(false);
  const [candidates, setCandidates] = useState(() => ownCandidates.filter(c => canEdit(c, userId)));
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let live = true;
    setLoadError(false);
    api.candidates(includePublic)
      .then(items => { if (live) setCandidates(items); })
      .catch(() => {
        if (!live) return;
        setCandidates(ownCandidates.filter(c => canEdit(c, userId)));
        setLoadError(true);
      });
    return () => { live = false; };
  }, [includePublic, ownCandidates, userId]);
  const q = search.toLocaleLowerCase(lang);
  const selectable = candidates.filter(c => canEdit(c, userId) || (includePublic && c.isPublic));
  const shown = selectable.filter((c) =>
    c.name.toLocaleLowerCase(lang).includes(q),
  );
  return (
    <section className="catalog-pane">
      <div className="panel-title">
        <h3>{t(lang, "catalog")}</h3>
        <span>
          {selectable.length} {t(lang, "candidates")}
        </span>
      </div>
      <div className="catalog-tools">
        <PublicFilter lang={lang} checked={includePublic} onChange={setIncludePublic} />
        <input
          type="search"
          aria-label={t(lang, "search")}
          placeholder={t(lang, "search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {loadError && <p className="error" role="alert">{t(lang, "persistFail")}</p>}
      <div className="catalog-scroll" tabIndex={0} aria-label={t(lang, "catalog")}>
        <div className="catalog-grid">
          {shown.map((c) => (
            <article className="candidate" key={c.id}>
              <ImagePreview
                lang={lang}
                src={api.imageUrl(c.id)}
                alt={c.name}
                className="candidate-image card-embed"
              />
              <h4>{c.name}</h4>
              <span className="mini-label">{t(lang, canEdit(c, userId) ? (c.isPublic ? "publicRecord" : "privateRecord") : "sharedRecord")}</span>
              <div className="candidate-controls">
                <button
                  className="secondary small-btn"
                  disabled={addedIds.includes(c.id)}
                  onClick={() => onAdd(c.id)}
                >
                  {addedIds.includes(c.id) ? t(lang, "added") : t(lang, "add")}
                </button>
                {onEdit && canEdit(c, userId) && (
                  <button
                    className="quiet"
                    aria-label={`${c.name}: ${t(lang, "edit")}`}
                    onClick={() => onEdit(c.id, c)}
                  >
                    {t(lang, "edit")}
                  </button>
                )}
              </div>
            </article>
          ))}
          {shown.length === 0 && (
            <p className="empty" style={{ gridColumn: "1/-1" }}>
              {t(lang, "noResults")}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function OrderedEntries({
  lang,
  entries,
  candidates,
  onReorder,
  onRemove,
  onEdit,
  emptyText,
  resolveName,
  context,
  readOnly = false,
  onAdd,
  addedIds = [],
  adding = false,
}: {
  lang: Lang;
  entries: string[];
  candidates: Candidate[];
  onReorder: (id: string, to: number) => void;
  onRemove: (id: string) => void;
  onEdit?: (id: string) => void;
  emptyText: string;
  resolveName?: (id: string) => string;
  context: CandidateContext;
  readOnly?: boolean;
  onAdd?: (id: string) => void;
  addedIds?: string[];
  adding?: boolean;
}) {
  const label = (cid: string) =>
    resolveName ? resolveName(cid) : nameOf(candidates, cid);
  return (
    <ol className="ordered-list" aria-label={t(lang, "entries")} tabIndex={0}>
      {entries.map((cid, idx) => (
        <li className="ordered-item" key={cid}>
          <span className="order-number">{idx + 1}</span>
          <ImagePreview lang={lang} src={api.imageUrl(cid, context)} alt={label(cid)} enlargeLabel={label(cid)} className="ordered-thumb" />
          <span className="ordered-name">{label(cid)}</span>
          {onAdd && <button className="secondary small-btn" aria-label={`${label(cid)}: ${t(lang, "addToOwnList")}`} disabled={adding || addedIds.includes(cid)} onClick={() => onAdd(cid)}>{t(lang, addedIds.includes(cid) ? "added" : "addToOwnList")}</button>}
          {!readOnly && <div className="ordered-actions">
            {onEdit && (
              <button
                className="icon-button"
                aria-label={`${label(cid)}: ${t(lang, "edit")}`}
                onClick={() => onEdit(cid)}
              >
                ✎
              </button>
            )}
            <button
              className="icon-button"
              aria-label={`${label(cid)}: ${t(lang, "up")}`}
              disabled={idx === 0}
              onClick={() => onReorder(cid, idx - 1)}
            >
              ↑
            </button>
            <button
              className="icon-button"
              aria-label={`${label(cid)}: ${t(lang, "down")}`}
              disabled={idx === entries.length - 1}
              onClick={() => onReorder(cid, idx + 1)}
            >
              ↓
            </button>
            <button
              className="icon-button"
              aria-label={`${label(cid)}: ${t(lang, "remove")}`}
              onClick={() => onRemove(cid)}
            >
              ✕
            </button>
          </div>}
        </li>
      ))}
      {entries.length === 0 && <li className="empty">{emptyText}</li>}
    </ol>
  );
}

export function Catalog({
  lang,
  items: ownItems,
  onItems: onOwnItems,
  userId,
  onError,
}: {
  lang: Lang;
  userId: string;
  items: Candidate[];
  onItems: (c: Candidate[]) => void;
  onError: (m: string | null) => void;
}) {
  const [items, setItems] = useState(ownItems);
  const [loadError, setLoadError] = useState(false);
  const [includePublic, setIncludePublic] = useState(false);
  const [isPublic, setPublic] = useState(false);
  useEffect(() => {
    let live = true;
    api.candidates(includePublic).then(records => { if (live) { setItems(records); setLoadError(false); } }).catch(() => { if (live) setLoadError(true); });
    return () => { live = false; };
  }, [includePublic, lang, onError]);
  function onItems(records: Candidate[]) {
    setItems(records);
    onOwnItems(records.filter(record => canEdit(record, userId)));
  }
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const pendingScrollId = useRef<string | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const q = search.toLocaleLowerCase(lang);
  const visibleItems = items.filter(c => canEdit(c, userId) || (includePublic && c.isPublic));
  const shown = visibleItems.filter((c) =>
    c.name.toLocaleLowerCase(lang).includes(q),
  );
  const editing = editingId ? items.find((c) => c.id === editingId) ?? null : null;

  useEffect(() => {
    if (!pendingScrollId.current) return;
    const id = pendingScrollId.current;
    pendingScrollId.current = null;
    requestAnimationFrame(() => {
      cardRefs.current
        .get(id)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [items]);

  async function create() {
    if (!name.trim() || !file) return;
    try {
      const c = await api.createCandidate(name, file, isPublic);
      const r = applyCatalogCreate(items, c);
      pendingScrollId.current = r.scrollId;
      setSearch((s) => searchForVisibleRecord(s, c.name, lang));
      onItems(r.items);
      setName("");
      setFile(null);
      setShowCreate(false);
      setPublic(false);
      onError(null);
    } catch (e) {
      onError(
        e instanceof ApiError && e.status === 413
          ? t(lang, "tooLarge")
          : t(lang, "persistFail"),
      );
    }
  }

  function closeCreate() {
    setShowCreate(false);
    setName("");
    setFile(null);
    setPublic(false);
  }

  async function archive(id: string) {
    setConfirmId(id);
  }

  async function confirmArchive() {
    if (!confirmId) return;
    const id = confirmId;
    setConfirmId(null);
    try {
      await api.archiveCandidate(id);
      onItems(items.filter((c) => c.id !== id));
      onError(null);
    } catch {
      onError(t(lang, "persistFail"));
    }
  }

  async function saveEdit(name: string, file: File | null, isPublic?: boolean) {
    if (!editing) return;
    try {
      const updated = await api.editCatalogCandidate(editing.id, name, file, isPublic);
      if (file) api.bumpCandidateImage(updated.id);
      const r = applyCatalogEdit(items, editing.id, updated);
      if (r.scrollId) {
        pendingScrollId.current = r.scrollId;
        setSearch((s) => searchForVisibleRecord(s, updated.name, lang));
      }
      onItems(r.items);
      setEditingId(null);
      onError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        onError(t(lang, "duplicate"));
      else if (e instanceof ApiError && e.status === 413)
        onError(t(lang, "tooLarge"));
      else onError(t(lang, "persistFail"));
    }
  }

  return (
    <section className="route-catalog">
      <Status msg={loadError ? t(lang, "persistFail") : null} />
      <AppHeading
        title={t(lang, "catalog")}
        intro={t(lang, "catalogIntro")}
        action={
          <button className="primary" onClick={() => setShowCreate(true)}>
            {t(lang, "newCandidate")}
          </button>
        }
      />
      <div className="library-tools">
        <PublicFilter lang={lang} checked={includePublic} onChange={setIncludePublic} />
        <input
          type="search"
          aria-label={t(lang, "search")}
          placeholder={t(lang, "search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span>
          {visibleItems.length} {t(lang, "candidates")}
        </span>
      </div>
      {showCreate && (
        <Modal titleId="candidate-create-title" onClose={closeCreate}>
          <dialog aria-labelledby="candidate-create-title">
            <form
              method="dialog"
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <h2 id="candidate-create-title">{t(lang, "newCandidate")}</h2>
              <p className="description">{t(lang, "newCandidateDescription")}</p>
              <div className="modal-form">
                <label>
                  {t(lang, "name")}
                  <input
                    aria-label={t(lang, "name")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t(lang, "newCandidate")}
                    maxLength={200}
                    required
                    autoFocus
                  />
                </label>
                <ImageField
                  lang={lang}
                  label={t(lang, "image")}
                  accept="image/*"
                  file={file}
                  savedSrc={null}
                  savedAlt={name}
                  emptyLabel={t(lang, "noImage")}
                  onSelect={setFile}
                />
                <ShareField lang={lang} checked={isPublic} onChange={setPublic} />
              </div>
              <div className="dialog-actions">
                <button type="button" className="secondary" onClick={closeCreate}>
                  {t(lang, "cancel")}
                </button>
                <button type="submit" className="primary">
                  {t(lang, "create")}
                </button>
              </div>
            </form>
          </dialog>
        </Modal>
      )}
      <div className="full-catalog-scroll" tabIndex={0} aria-label={t(lang, "catalog")}>
        <div className="full-catalog">
          {shown.map((c) => (
            <article
              className="candidate"
              key={c.id}
              data-candidate-id={c.id}
              ref={(el) => {
                if (el) cardRefs.current.set(c.id, el);
                else cardRefs.current.delete(c.id);
              }}
            >
              <ImagePreview
                lang={lang}
                src={api.imageUrl(c.id)}
                alt={c.name}
                className="candidate-image card-embed"
              />
              <h4>{c.name}</h4>
              <span className="mini-label">{t(lang, canEdit(c, userId) ? (c.isPublic ? "publicRecord" : "privateRecord") : "sharedRecord")}</span>
              {canEdit(c, userId) && <div className="candidate-controls">
                <button
                  className="secondary small-btn"
                  aria-label={`${c.name}: ${t(lang, "edit")}`}
                  onClick={() => setEditingId(c.id)}
                >
                  {t(lang, "edit")}
                </button>
                <button className="quiet" onClick={() => archive(c.id)}>
                  {t(lang, "archive")}
                </button>
              </div>}
            </article>
          ))}
        </div>
      </div>
      {shown.length === 0 && <p className="empty">{t(lang, "noResults")}</p>}
      {editing && (
        <CandidateEditDialog
          lang={lang}
          title={t(lang, "editCandidate")}
          description={t(lang, "candidateCopy")}
          initialName={editing.name}
          initialPublic={editing.isPublic}
          previewUrl={api.imageUrl(editing.id)}
          onClose={() => setEditingId(null)}
          onSave={saveEdit}
        />
      )}
      {confirmId && (
        <ConfirmDialog
          lang={lang}
          title={t(lang, "archiveTitle")}
          body={t(lang, "archiveText")}
          confirmLabel={t(lang, "archive")}
          danger
          onCancel={() => setConfirmId(null)}
          onConfirm={confirmArchive}
        />
      )}
    </section>
  );
}

export function Lists({
  lang,
  userId,
  candidates,
  onCandidates,
  onError,
}: {
  lang: Lang;
  userId: string;
  candidates: Candidate[];
  onCandidates: (c: Candidate[]) => void;
  onError: (m: string | null) => void;
}) {
  const [lists, setLists] = useState<CandidateList[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [includePublic, setIncludePublic] = useState(false);
  const [isPublic, setPublic] = useState(false);
  const [entryPublic, setEntryPublic] = useState(false);
  const [editingList, setEditingList] = useState<CandidateList | null>(null);
  const [retainedList, setRetainedList] = useState<CandidateList | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [newName, setNewName] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [showCreateList, setShowCreateList] = useState(false);
  const [showCreateEntry, setShowCreateEntry] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingScope, setEditingScope] = useState<"entry" | "catalog">("entry");
  const [editingRoot, setEditingRoot] = useState<Candidate | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [targetListId, setTargetListId] = useState("");
  const [adding, setAdding] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const selectionCleared = useRef(false);
  const active = lists.find((l) => l.id === activeId) ?? (retainedList?.id === activeId ? retainedList : null);
  const editable = !!active && canEdit(active, userId);
  const ownLists = lists.filter(l => canEdit(l, userId));
  const targetList = ownLists.find(l => l.id === targetListId) ?? ownLists.find(l => !l.isPublic) ?? ownLists[0];
  const entryList = editable ? active : targetList;
  const visibleLists = lists.filter(l => canEdit(l, userId) || (includePublic && l.isPublic));
  const references = [...lists, ...(active ? [active] : [])].flatMap((l) => l.entries.map((id) => ({ id, context: { listId: l.id } })));
  const extraNames = useMissingCandidateNames(candidates, references, () => {});
  const resolveName = (id: string) => nameOf(candidates, id, extraNames);
  const editingCandidate =
    editingRoot ?? (editingId ? candidates.find((c) => c.id === editingId) : null);
  const editingName =
    editingCandidate?.name ?? (editingId ? extraNames[editingId] : undefined) ?? "";

  useEffect(() => {
    let live = true;
    api
      .lists(includePublic)
      .then((ls) => {
        if (!live) return;
        setLists(ls);
        setLoadError(false);
        setActiveId((a) => selectionCleared.current ? a : a ?? ls[0]?.id ?? null);
      })
      .catch(() => { if (live) setLoadError(true); });
    return () => { live = false; };
  }, [lang, onError, includePublic]);

  useEffect(() => { if (active) setRetainedList(active); }, [active]);

  async function createList() {
    try {
      const l = await api.createList(name, true, isPublic);
      setLists((p) => [...p, l]);
      setActiveId(l.id);
      setName("");
      setShowCreateList(false);
      setPublic(false);
    } catch {
      onError(t(lang, "persistFail"));
    }
  }

  function closeCreateList() {
    setShowCreateList(false);
    setName("");
    setPublic(false);
  }

  function scrollToEditor() {
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function cloneList(sourceId: string) {
    setCloningId(sourceId);
    try {
      const copy = await api.cloneList(sourceId);
      setLists((p) => [...p, copy]);
      setActiveId(copy.id);
      onError(null);
      scrollToEditor();
    } catch {
      onError(t(lang, "persistFail"));
    } finally {
      setCloningId(null);
    }
  }

  async function mutate(p: Promise<CandidateList>) {
    try {
      const updated = await p;
      setRetainedList(previous => previous?.id === updated.id ? updated : previous);
      setLists((ls) => ls.map((l) => (l.id === updated.id ? updated : l)));
      onError(null);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        onError(t(lang, "duplicate"));
      else onError(t(lang, "persistFail"));
      return false;
    }
  }

  async function createAndAdd() {
    if (!entryList || !newName.trim() || !newFile) return;
    try {
      const c = await api.createCandidate(newName, newFile, entryPublic);
      onCandidates([...candidates, c]);
      setNewName("");
      setNewFile(null);
      setShowCreateEntry(false);
      setEntryPublic(false);
      await mutate(api.addEntry(entryList.id, c.id));
    } catch {
      onError(t(lang, "persistFail"));
    }
  }

  function closeCreateEntry() {
    setShowCreateEntry(false);
    setNewName("");
    setNewFile(null);
    setEntryPublic(false);
  }

  async function confirmArchiveList() {
    if (!confirmArchiveId) return;
    const id = confirmArchiveId;
    setConfirmArchiveId(null);
    try {
      await api.archiveList(id);
      setLists((ls) => ls.filter((l) => l.id !== id));
      setActiveId((a) => (a === id ? null : a));
      onError(null);
    } catch {
      onError(t(lang, "persistFail"));
    }
  }

  async function saveEntryEdit(name: string, file: File | null) {
    if (!entryList || !editingId) return;
    try {
      const { candidate, list } = await api.editListEntry(
        entryList.id,
        editingId,
        name,
        file,
      );
      onCandidates(
        candidates.some((c) => c.id === candidate.id)
          ? candidates.map((c) => (c.id === candidate.id ? candidate : c))
          : [...candidates, candidate],
      );
      setLists((ls) => ls.map((l) => (l.id === list.id ? list : l)));
      setEditingId(null);
      onError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        onError(t(lang, "duplicate"));
      else onError(t(lang, "persistFail"));
    }
  }

  async function saveCatalogEdit(name: string, file: File | null, isPublic?: boolean) {
    if (!editingId) return;
    try {
      const updated = await api.editCatalogCandidate(editingId, name, file, isPublic);
      if (file) api.bumpCandidateImage(updated.id);
      if (updated.id === editingId) {
        onCandidates(candidates.map((c) => (c.id === updated.id ? updated : c)));
      } else {
        onCandidates([
          ...candidates.filter((c) => c.id !== editingId),
          updated,
        ]);
      }
      setEditingId(null);
      onError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        onError(t(lang, "duplicate"));
      else onError(t(lang, "persistFail"));
    }
  }

  const valid =
    !!entryList && entryList.entries.length >= 4 && entryList.entries.length % 2 === 0;

  return (
    <section className="route-lists">
      <Status msg={loadError ? t(lang, "persistFail") : null} />
      <AppHeading
        title={t(lang, "lists")}
        headingRef={headingRef}
        intro={t(lang, "listsIntro")}
        action={
          <button className="primary" onClick={() => setShowCreateList(true)}>
            {t(lang, "newList")}
          </button>
        }
      />
      <PublicFilter lang={lang} checked={includePublic} onChange={setIncludePublic} />
      {showCreateList && (
        <Modal titleId="list-create-title" onClose={closeCreateList}>
          <dialog aria-labelledby="list-create-title">
            <form
              method="dialog"
              onSubmit={(e) => {
                e.preventDefault();
                createList();
              }}
            >
              <h2 id="list-create-title">{t(lang, "newList")}</h2>
              <ShareField lang={lang} checked={isPublic} onChange={setPublic} />
              <div className="modal-form">
                <label>
                  {t(lang, "name")}
                  <input
                    aria-label={t(lang, "name")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t(lang, "newList")}
                    maxLength={200}
                    autoFocus
                  />
                </label>
              </div>
              <div className="dialog-actions">
                <button type="button" className="secondary" onClick={closeCreateList}>
                  {t(lang, "cancel")}
                </button>
                <button type="submit" className="primary">
                  {t(lang, "saveList")}
                </button>
              </div>
            </form>
          </dialog>
        </Modal>
      )}
      <div className="list-library">
        {visibleLists.map((l) => (
          <section
            className="list-entry"
            key={l.id}
            aria-current={l.id === activeId ? "true" : undefined}
          >
            <div className="panel-title">
              <h2>{l.name || t(lang, "draft")}</h2>
              <span className="mini-label">{t(lang, canEdit(l, userId) ? (l.isPublic ? "publicRecord" : "privateRecord") : "sharedRecord")}</span>
              <span>
                {l.entries.length} {t(lang, "candidates")}
              </span>
            </div>
            <div className="review-candidates" tabIndex={0} aria-label={t(lang, "entries")}>
              {l.entries.map((cid) => (
                <ImagePreview
                  key={cid}
                  lang={lang}
                  src={api.imageUrl(cid, { listId: l.id })}
                  alt={resolveName(cid)}
                  enlargeLabel={resolveName(cid)}
                  className="list-thumb"
                />
              ))}
            </div>
            <p>{t(lang, "savedSource")}</p>
            <div className="battle-entry-actions">
              <button
                className="secondary small-btn"
                onClick={() => {
                  if (!editable || !canEdit(l, userId)) {
                    closeCreateEntry();
                    setEditingId(null);
                  }
                  selectionCleared.current = false;
                  setActiveId(l.id);
                  scrollToEditor();
                }}
              >
                {t(lang, "selectList")}
              </button>
              <button
                className="quiet"
                disabled={cloningId === l.id}
                onClick={() => cloneList(l.id)}
              >
                {t(lang, "useList")}
              </button>
              {canEdit(l, userId) && <button className="quiet" onClick={() => setEditingList({ ...l })}>{t(lang, "edit")}</button>}
              {canEdit(l, userId) && <button className="quiet" onClick={() => setConfirmArchiveId(l.id)}>
                {t(lang, "archive")}
              </button>}
            </div>
          </section>
        ))}
      </div>
      {visibleLists.length === 0 && <p className="empty">{t(lang, "noLists")}</p>}
      {active && (
        <div className="split" ref={editorRef}>
          {editable && <CatalogPane
            key={active.id}
            lang={lang}
            userId={userId}
            candidates={candidates}
            addedIds={active.entries}
            onAdd={(cid) => mutate(api.addEntry(active.id, cid))}
            onEdit={(cid, candidate) => {
              setEditingId(cid);
              setEditingRoot(candidate);
              setEditingScope("catalog");
            }}
          />}
          {!editable && <section>
            <div className="selected-head">
              <h3>{active.name || t(lang, "draft")}</h3>
              <span className="mini-label">{active.entries.length} {t(lang, "candidates")}</span>
              <button
                type="button"
                className="icon-button clear-list-selection"
                title={t(lang, "clearSelection")}
                aria-label={t(lang, "clearSelection")}
                onClick={() => {
                  selectionCleared.current = true;
                  setActiveId(null);
                  setRetainedList(null);
                  closeCreateEntry();
                  setEditingId(null);
                  requestAnimationFrame(() => headingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </div>
            <p className="source">{t(lang, "savedSource")}</p>
            <OrderedEntries
              lang={lang}
              context={{ listId: active.id }}
              readOnly
              onAdd={targetList ? async cid => {
                setAdding(true);
                try { await mutate(api.addEntry(targetList.id, cid, active.id)); }
                finally { setAdding(false); }
              } : undefined}
              addedIds={targetList?.entries}
              adding={adding}
              entries={active.entries}
              candidates={candidates}
              onReorder={() => {}}
              onRemove={() => {}}
              emptyText={t(lang, "emptyList")}
              resolveName={resolveName}
            />
          </section>}
          <section>
            {!editable && <label>{t(lang, "targetOwnList")}
              <select aria-label={t(lang, "targetOwnList")} value={targetList?.id ?? ""} disabled={adding || !targetList} onChange={event => {
                closeCreateEntry();
                setEditingId(null);
                setTargetListId(event.target.value);
              }}>
                {!targetList && <option value="">{t(lang, "noLists")}</option>}
                {ownLists.map(list => <option key={list.id} value={list.id}>{list.name || t(lang, "draft")} — {t(lang, list.isPublic ? "publicRecord" : "privateRecord")}</option>)}
              </select>
            </label>}
            {entryList && <>
            <div className="selected-head">
              <h3>{entryList.name || t(lang, "draft")}</h3>
              <span className="mini-label">
                {entryList.entries.length} {t(lang, "candidates")}
              </span>
            </div>
            <p className="source">{t(lang, "savedSource")}</p>
            <div className="create-row">
              <button className="secondary" onClick={() => setShowCreateEntry(true)}>
                {t(lang, "createAndAdd")}
              </button>
            </div>
            {showCreateEntry && (
              <Modal titleId="entry-create-title" onClose={closeCreateEntry}>
                <dialog aria-labelledby="entry-create-title">
                  <form
                    method="dialog"
                    onSubmit={(e) => {
                      e.preventDefault();
                      createAndAdd();
                    }}
                  >
                    <h2 id="entry-create-title">{t(lang, "createAndAdd")}</h2>
                    <ShareField lang={lang} checked={entryPublic} onChange={setEntryPublic} />
                    <p className="description">{t(lang, "newCandidateDescription")}</p>
                    <div className="modal-form">
                      <label>
                        {t(lang, "name")}
                        <input
                          aria-label={t(lang, "name")}
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          placeholder={t(lang, "createAndAdd")}
                          maxLength={200}
                          required
                          autoFocus
                        />
                      </label>
                      <ImageField
                        lang={lang}
                        label={t(lang, "image")}
                        accept="image/*"
                        file={newFile}
                        savedSrc={null}
                        savedAlt={newName}
                        emptyLabel={t(lang, "noImage")}
                        onSelect={setNewFile}
                      />
                    </div>
                    <div className="dialog-actions">
                      <button type="button" className="secondary" onClick={closeCreateEntry}>
                        {t(lang, "cancel")}
                      </button>
                      <button type="submit" className="primary">
                        {t(lang, "create")}
                      </button>
                    </div>
                  </form>
                </dialog>
              </Modal>
            )}
            <OrderedEntries
              lang={lang}
              context={{ listId: entryList.id }}
              entries={entryList.entries}
              candidates={candidates}
              onReorder={(cid, to) => mutate(api.reorder(entryList.id, cid, to))}
              onRemove={(cid) => mutate(api.removeEntry(entryList.id, cid))}
              onEdit={(cid) => {
                setEditingId(cid);
                setEditingRoot(null);
                setEditingScope("entry");
              }}
              emptyText={t(lang, "emptyList")}
              resolveName={resolveName}
            />
            <p className={`validation-note ${valid ? "" : "error"}`}>
              {t(lang, valid ? "validList" : "invalidList")}
            </p>
            </>}
          </section>
        </div>
      )}
      {editingId && (
        <CandidateEditDialog
          lang={lang}
          title={t(lang, "editCandidate")}
          description={t(lang, "candidateCopy")}
          initialName={editingName}
          initialPublic={editingScope === "catalog" ? editingCandidate?.isPublic : undefined}
          previewUrl={api.imageUrl(editingId, editingScope === "entry" && entryList ? { listId: entryList.id } : undefined)}
          onClose={() => setEditingId(null)}
          onSave={editingScope === "entry" ? saveEntryEdit : saveCatalogEdit}
        />
      )}
      {editingList && (
        <Modal titleId="list-edit-title" onClose={() => setEditingList(null)}>
          <dialog aria-labelledby="list-edit-title">
            <form onSubmit={async event => {
              event.preventDefault();
              if (await mutate(api.editList(editingList.id, editingList.name, editingList.isPublic))) setEditingList(null);
            }}>
              <h2 id="list-edit-title">{t(lang, "editList")}</h2>
              <label>{t(lang, "name")}<input value={editingList.name} maxLength={200} onChange={event => setEditingList({ ...editingList, name: event.target.value })} /></label>
              <ShareField lang={lang} checked={editingList.isPublic} onChange={value => setEditingList({ ...editingList, isPublic: value })} />
              <div className="dialog-actions">
                <button type="button" className="secondary" onClick={() => setEditingList(null)}>{t(lang, "cancel")}</button>
                <button type="submit" className="primary">{t(lang, "save")}</button>
              </div>
            </form>
          </dialog>
        </Modal>
      )}
      {confirmArchiveId && (
        <ConfirmDialog
          lang={lang}
          title={t(lang, "archiveTitle")}
          body={t(lang, "archiveText")}
          confirmLabel={t(lang, "archive")}
          danger
          onCancel={() => setConfirmArchiveId(null)}
          onConfirm={confirmArchiveList}
        />
      )}
    </section>
  );
}

function stateKey(status: string): string {
  if (status === "ongoing") return "liveState";
  if (status === "completed") return "endedState";
  return "draftState";
}

export function AuctionWorkspace({
  lang,
  userId,
  candidates,
  onError,
  view,
  onOpenDraft,
  onOpenLive,
  onOpenResult,
  onBackToAuctions,
  onCandidates,
}: {
  lang: Lang;
  userId: string;
  candidates: Candidate[];
  onError: (m: string | null) => void;
  view: "auctions" | "draft" | "live" | "result";
  onOpenDraft: () => void;
  onOpenLive: () => void;
  onOpenResult: () => void;
  onBackToAuctions: () => void;
  onCandidates: (c: Candidate[]) => void;
}) {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() =>
    localStorage.getItem("obb-selected-auction"),
  );
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [newTemplate, setNewTemplate] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [showCreateDraft, setShowCreateDraft] = useState(false);
  const [lists, setLists] = useState<CandidateList[]>([]);
  const [includePublicLists, setIncludePublicLists] = useState(false);
  const sourceLists = lists.filter(l => canEdit(l, userId) || (includePublicLists && l.isPublic));
  const [rename, setRename] = useState("");
  const [templateDraft, setTemplateDraft] = useState("");
  const [generalSaving, setGeneralSaving] = useState(false);
  const [generalSaved, setGeneralSaved] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingRoot, setEditingRoot] = useState<Candidate | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [cloneSourceId, setCloneSourceId] = useState<string | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [clonePending, setClonePending] = useState(false);
  const [deletedNote, setDeletedNote] = useState(false);
  const [draftStep, setDraftStep] = useState<number>(0);
  const teamsSaveRef = useRef<(() => void) | null>(null);
  const [teamsSaveDisabled, setTeamsSaveDisabled] = useState(true);
  const [reviewReady, setReviewReady] = useState(false);
  const [startPending, setStartPending] = useState(false);
  const [startErrors, setStartErrors] = useState<FieldError[]>([]);
  const rawActive = auctions.find((a) => a.id === activeId) ?? null;
  const active =
    view === "draft"
      ? (rawActive?.status === "draft"
          ? rawActive
          : (auctions.find((a) => a.status === "draft") ?? null))
      : view === "live"
        ? (rawActive && rawActive.status !== "draft"
            ? rawActive
            : (auctions.find((a) => a.status !== "draft") ?? null))
        : view === "result"
          ? (rawActive && rawActive.status !== "draft"
              ? rawActive
              : (auctions.find((a) => a.status === "completed") ?? null))
          : rawActive;
  const draftReferences = active ? active.entries.map((id) => ({ id, context: { auctionId: active.id } })) : [];
  const draftExtra = useMissingCandidateNames(candidates, draftReferences, () => {});
  const resolveDraftName = (id: string) => nameOf(candidates, id, draftExtra);
  const editingDraftName =
    editingRoot?.name ?? (editingId ? candidates.find((c) => c.id === editingId)?.name : undefined) ??
    (editingId ? draftExtra[editingId] : undefined) ??
    "";

  useEffect(() => {
    let live = true;
    api
      .lists(includePublicLists)
      .then(records => { if (live) setLists(records); })
      .catch(() => { if (live) onError(t(lang, "persistFail")); });
    return () => { live = false; };
  }, [includePublicLists, lang, onError]);

  useEffect(() => {
    api
      .auctions()
      .then(async (as) => {
        const stored = localStorage.getItem("obb-selected-auction");
        if (stored) {
          try {
            const one = await api.getAuction(stored);
            setAuctions((prev) =>
              prev.some((a) => a.id === one.id) ? prev : [...prev, one],
            );
            setActiveId(one.id);
          } catch {
            // stored id gone; fall through to list
          }
        }
        setAuctions((prev) => {
          const ids = new Set(prev.map((a) => a.id));
          return [...prev, ...as.filter((a) => !ids.has(a.id))];
        });
        setActiveId((a) => a ?? as[0]?.id ?? null);
      })
      .catch(() => onError(t(lang, "persistFail")));
  }, [lang, onError]);

  useEffect(() => {
    setSourceId((prev) =>
      prev && lists.some((l) => l.id === prev) ? prev : lists[0]?.id ?? "",
    );
  }, [lists]);

  useEffect(() => {
    setRename(active?.name ?? "");
  }, [active?.id, active?.name]);

  useEffect(() => {
    setTemplateDraft(active?.simulationPromptTemplate ?? "");
  }, [active?.id, active?.simulationPromptTemplate]);

  useEffect(() => {
    setReviewReady(false);
    setStartErrors([]);
    setStartPending(false);
    setGeneralSaved(false);
    setGeneralError(null);
  }, [active?.id]);

  async function create() {
    try {
      const a = await api.createAuction(newName, sourceLists.some(l => l.id === sourceId) ? sourceId : null, newTemplate);
      setAuctions((p) => [a, ...p]);
      setActiveId(a.id);
      localStorage.setItem("obb-selected-auction", a.id);
      setNewName("");
      setNewTemplate("");
      setShowCreateDraft(false);
      onError(null);
      onOpenDraft();
    } catch {
      onError(t(lang, "persistFail"));
    }
  }

  function closeCreateDraft() {
    setShowCreateDraft(false);
    setNewName("");
    setNewTemplate("");
  }

  function open(id: string) {
    setActiveId(id);
    localStorage.setItem("obb-selected-auction", id);
    const target = auctions.find((a) => a.id === id);
    if (target?.status === "completed") onOpenResult();
    else if (target && target.status !== "draft") onOpenLive();
    else onOpenDraft();
  }

  async function confirmDeleteDraft() {
    if (!pendingDeleteId) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    try {
      await api.deleteAuction(id);
      setAuctions((ls) => ls.filter((x) => x.id !== id));
      if (activeId === id) {
        setActiveId(null);
        localStorage.removeItem("obb-selected-auction");
        onBackToAuctions();
      }
      setDeletedNote(true);
      onError(null);
    } catch {
      onError(t(lang, "persistFail"));
    }
  }

  function openClone(id: string) {
    setCloneSourceId(id);
    setCloneName("");
  }

  function closeClone() {
    if (clonePending) return;
    setCloneSourceId(null);
    setCloneName("");
  }

  async function confirmClone() {
    if (!cloneSourceId || clonePending) return;
    setClonePending(true);
    try {
      const clone = await api.cloneAuction(cloneSourceId, cloneName);
      setAuctions((ls) => [clone, ...ls.filter((auction) => auction.id !== clone.id)]);
      setActiveId(clone.id);
      localStorage.setItem("obb-selected-auction", clone.id);
      setCloneSourceId(null);
      setCloneName("");
      onError(null);
      onOpenDraft();
    } catch {
      onError(t(lang, "persistFail"));
    } finally {
      setClonePending(false);
    }
  }

  async function mutate(p: Promise<Auction>) {
    try {
      const updated = await p;
      setAuctions((ls) => ls.map((x) => (x.id === updated.id ? updated : x)));
      onError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        onError(t(lang, "duplicate"));
      else onError(t(lang, "persistFail"));
    }
  }

  async function saveGeneral() {
    if (!active || generalSaving) return;
    setGeneralSaving(true);
    setGeneralSaved(false);
    setGeneralError(null);
    try {
      const updated = await api.saveGeneralInfo(active.id, rename, templateDraft);
      setAuctions((ls) => ls.map((x) => (x.id === updated.id ? updated : x)));
      setGeneralSaved(true);
      onError(null);
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 409
          ? t(lang, "duplicate")
          : t(lang, "persistFail");
      setGeneralError(msg);
      onError(msg);
    } finally {
      setGeneralSaving(false);
    }
  }

  async function handleStart() {
    if (!active || startPending) return;
    setStartPending(true);
    setStartErrors([]);
    try {
      const updated = await api.startAuction(active.id);
      setAuctions((ls) => ls.map((x) => (x.id === updated.id ? updated : x)));
      setStartErrors([]);
      onError(null);
      onOpenLive();
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        const details = (e.details ?? {}) as { fieldErrors?: FieldError[] };
        setStartErrors(Array.isArray(details.fieldErrors) ? details.fieldErrors : []);
      } else {
        setStartErrors([]);
      }
      onError(t(lang, "startFailed"));
    } finally {
      setStartPending(false);
    }
  }

  async function saveDraftEntryEdit(name: string, file: File | null, isPublic?: boolean) {
    if (!active || !editingId) return;
    try {
      if (active.entries.includes(editingId)) {
        const { candidate, auction } = await api.editAuctionEntry(
          active.id,
          editingId,
          name,
          file,
        );
        onCandidates(
          candidates.some((c) => c.id === candidate.id)
            ? candidates.map((c) => (c.id === candidate.id ? candidate : c))
            : [...candidates, candidate],
        );
        setAuctions((ls) => ls.map((x) => (x.id === auction.id ? auction : x)));
      } else {
        const updated = await api.editCatalogCandidate(editingId, name, file, isPublic);
        onCandidates(
          updated.id === editingId
            ? candidates.map((c) => (c.id === updated.id ? updated : c))
            : [
                ...candidates.filter((c) => c.id !== editingId),
                updated,
              ],
        );
      }
      setEditingId(null);
      onError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        onError(t(lang, "duplicate"));
      else onError(t(lang, "persistFail"));
    }
  }

  const visible = auctions.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase()),
  );

  if (view === "draft") {
    return (
      <section className="route-home">
        <AppHeading title={t(lang, "currentDraft")} intro={t(lang, "homeIntro")} />
        {!active ? (
          <>
            <p className="empty">{t(lang, "noAuctions")}</p>
            <button className="secondary" onClick={onBackToAuctions}>
              {t(lang, "auctions")}
            </button>
          </>
        ) : (
          <section aria-label={active.name || t(lang, "draft")}>
            <div className="section-title">
              <div>
                <h2>{active.name || t(lang, "draft")}</h2>
                <p className="description">
                  {active.entries.length} {t(lang, "candidates")}
                </p>
              </div>
            </div>
            <Steps lang={lang} current={draftStep} onSelect={setDraftStep} />
            {draftStep === 0 ? (
              <>
                <div className="create-row">
                  <label>
                    {t(lang, "draftName")}
                    <input
                      aria-label={t(lang, "draftName")}
                      value={rename}
                      onChange={(e) => {
                        setRename(e.target.value);
                        setGeneralSaved(false);
                        setGeneralError(null);
                      }}
                      placeholder={t(lang, "draftName")}
                      maxLength={200}
                    />
                  </label>
                </div>
                <div className="create-row">
                  <label>
                    {t(lang, "simulationPromptTemplate")}
                    <textarea
                      aria-label={t(lang, "simulationPromptTemplate")}
                      value={templateDraft}
                      onChange={(e) => {
                        setTemplateDraft(e.target.value);
                        setGeneralSaved(false);
                        setGeneralError(null);
                      }}
                      placeholder={t(lang, "simulationPromptHint")}
                      rows={4}
                      maxLength={4000}
                    />
                  </label>
                </div>
                <p className="description">{t(lang, "simulationPromptHint")}</p>
                <div className="general-save-row">
                  <button
                    type="button"
                    className="primary step-nav"
                    disabled={generalSaving}
                    onClick={() => void saveGeneral()}
                  >
                    {t(lang, "save")}
                  </button>
                </div>
                {generalError && (
                  <p className="field-error" role="alert">
                    {generalError}
                  </p>
                )}
                {generalSaved && !generalError && (
                  <p className="save-note" role="status">
                    {t(lang, "draftSaved")}
                  </p>
                )}
              </>
            ) : draftStep === 1 ? (
              <div>
                <BattlefieldPreparation
                  key={active.id}
                  lang={lang}
                  userId={userId}
                  auction={active}
                  onAuctionChange={(updated) => {
                    setAuctions((ls) =>
                      ls.map((x) => (x.id === updated.id ? updated : x)),
                    );
                  }}
                />
              </div>
            ) : draftStep === 2 ? (
              <>
                <div className="split">
                  <CatalogPane
                    key={active.id}
                    lang={lang}
                    userId={userId}
                    candidates={candidates}
                    addedIds={active.entries}
                    onAdd={(cid) => mutate(api.addAuctionEntry(active.id, cid))}
                    onEdit={(cid, candidate) => { setEditingId(cid); setEditingRoot(candidate); }}
                  />
                  <section>
                    <div className="selected-head">
                      <h3>{active.name || t(lang, "draft")}</h3>
                      <span className="mini-label">
                        {active.entries.length} {t(lang, "candidates")}
                      </span>
                    </div>
                    <p className={`source ${active.followsSource ? "" : "copy-note"}`}>
                      {t(lang, active.followsSource ? "sourceNote" : "copiedNote")}
                    </p>
                    <OrderedEntries
                      lang={lang}
                      context={{ auctionId: active.id }}
                      entries={active.entries}
                      candidates={candidates}
                      onReorder={(cid, to) =>
                        mutate(api.reorderAuction(active.id, cid, to))
                      }
                      onRemove={(cid) =>
                        mutate(api.removeAuctionEntry(active.id, cid))
                      }
                      onEdit={(cid) => { setEditingId(cid); setEditingRoot(null); }}
                      emptyText={t(lang, "emptyList")}
                      resolveName={resolveDraftName}
                    />
                  </section>
                </div>
              </>
            ) : draftStep === 3 ? (
              <DraftTeams
                lang={lang}
                auction={active}
                saveRef={teamsSaveRef}
                onSaveDisabled={setTeamsSaveDisabled}
              />
            ) : (
              <DraftReview
                lang={lang}
                auction={active}
                battlefieldId={active.battlefieldId}
                entries={active.entries}
                namesReady={active.entries.every((id) => {
                  const resolved = resolveDraftName(id);
                  return resolved !== id && resolved.trim() !== "";
                })}
                resolveName={resolveDraftName}
                onGoStep={setDraftStep}
                onReadiness={setReviewReady}
                startErrors={startErrors}
              />
            )}
            {(
              <DraftStepFooter
                lang={lang}
                step={draftStep}
                onGo={setDraftStep}
                teamsSaveRef={teamsSaveRef}
                teamsSaveDisabled={teamsSaveDisabled}
                startDisabled={!reviewReady}
                startPending={startPending}
                onStart={handleStart}
              />
            )}
          </section>
        )}
        {active && editingId && (
          <CandidateEditDialog
            lang={lang}
            title={t(lang, "editCandidate")}
            description={t(lang, "candidateCopy")}
            initialName={editingDraftName}
            initialPublic={active.entries.includes(editingId) ? undefined : editingRoot?.isPublic}
            previewUrl={api.imageUrl(editingId, active.entries.includes(editingId) ? { auctionId: active.id } : undefined)}
            onClose={() => setEditingId(null)}
            onSave={saveDraftEntryEdit}
          />
        )}
      </section>
    );
  }

  if (view === "live") {
    return (
      <section className="route-home">
        <AppHeading title={t(lang, "ongoingAuction")} intro={t(lang, "homeIntro")} />
        {!active ? (
          <>
            <p className="empty">{t(lang, "noAuctions")}</p>
            <button className="secondary" onClick={onBackToAuctions}>
              {t(lang, "auctions")}
            </button>
          </>
        ) : (
          <LiveCouncil
            lang={lang}
            auction={active}
            mode="live"
            onOpenResult={onOpenResult}
          />
        )}
      </section>
    );
  }

  if (view === "result") {
    return (
      <section className="route-home">
        {!active ? (
          <>
            <p className="empty">{t(lang, "noResult")}</p>
            <button className="secondary" onClick={onBackToAuctions}>
              {t(lang, "auctions")}
            </button>
          </>
        ) : active.status === "draft" ? (
          <>
            <p className="empty">{t(lang, "resultPending")}</p>
            <button className="secondary" onClick={onOpenDraft}>
              {t(lang, "openDraft")}
            </button>
          </>
        ) : (
          <LiveCouncil
            lang={lang}
            auction={active}
            mode="result"
            onBackToLive={onOpenLive}
          />
        )}
      </section>
    );
  }

  return (
    <section className="route-home">
      <AppHeading
        title={t(lang, "homeTitle")}
        intro={t(lang, "homeIntro")}
        action={
          <button className="primary" onClick={() => setShowCreateDraft(true)}>
            {t(lang, "createDraft")}
          </button>
        }
      />
      {showCreateDraft && (
        <Modal titleId="draft-create-title" onClose={closeCreateDraft}>
          <dialog aria-labelledby="draft-create-title">
            <form
              method="dialog"
              onSubmit={(e) => {
                e.preventDefault();
                create();
              }}
            >
              <h2 id="draft-create-title">{t(lang, "createDraft")}</h2>
              <div className="modal-form">
                <label>
                  {t(lang, "draftName")}
                  <input
                    aria-label={t(lang, "draftName")}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={t(lang, "draftName")}
                    maxLength={200}
                    autoFocus
                  />
                </label>
                <PublicFilter lang={lang} checked={includePublicLists} onChange={setIncludePublicLists} />
                <label>
                  {t(lang, "fromList")}
                  <select
                    aria-label={t(lang, "fromList")}
                    value={sourceLists.some(l => l.id === sourceId) ? sourceId : ""}
                    onChange={(e) => setSourceId(e.target.value)}
                  >
                    <option value="">{t(lang, "emptyList")}</option>
                    {sourceLists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name || t(lang, "draft")}{!canEdit(l, userId) ? ` · ${t(lang, "sharedRecord")}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t(lang, "simulationPromptTemplate")}
                  <textarea
                    aria-label={t(lang, "simulationPromptTemplate")}
                    value={newTemplate}
                    onChange={(e) => setNewTemplate(e.target.value)}
                    placeholder={t(lang, "simulationPromptHint")}
                    rows={4}
                    maxLength={4000}
                  />
                </label>
              </div>
              <div className="dialog-actions">
                <button type="button" className="secondary" onClick={closeCreateDraft}>
                  {t(lang, "cancel")}
                </button>
                <button type="submit" className="primary">
                  {t(lang, "createDraft")}
                </button>
              </div>
            </form>
          </dialog>
        </Modal>
      )}
      {cloneSourceId && (
        <Modal titleId="auction-clone-title" onClose={closeClone}>
          <dialog aria-labelledby="auction-clone-title">
            <form
              method="dialog"
              onSubmit={(e) => {
                e.preventDefault();
                void confirmClone();
              }}
            >
              <h2 id="auction-clone-title">{t(lang, "cloneAuction")}</h2>
              <div className="modal-form">
                <label>
                  {t(lang, "draftName")}
                  <input
                    aria-label={t(lang, "draftName")}
                    value={cloneName}
                    onChange={(e) => setCloneName(e.target.value)}
                    maxLength={200}
                    autoFocus
                    disabled={clonePending}
                  />
                </label>
              </div>
              <div className="dialog-actions">
                <button type="button" className="secondary" onClick={closeClone} disabled={clonePending}>
                  {t(lang, "cancel")}
                </button>
                <button type="submit" className="primary" disabled={clonePending}>
                  {clonePending ? "..." : t(lang, "cloneAuction")}
                </button>
              </div>
            </form>
          </dialog>
        </Modal>
      )}
      <div className="home-filter">
        <input
          type="search"
          aria-label={t(lang, "searchAuctions")}
          placeholder={t(lang, "searchAuctions")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="table-scroll">
        <table className="auction-table">
          <thead>
            <tr>
              <th>{t(lang, "recordName")}</th>
              <th>{t(lang, "recordState")}</th>
              <th>{t(lang, "recordCandidates")}</th>
              <th>
                <span className="file-hidden">{t(lang, "actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => (
              <tr key={a.id}>
                <td>{a.name || t(lang, "draft")}</td>
                <td>
                  <span
                    className={`state-tag ${a.status === "ongoing" ? "running" : a.status === "completed" ? "ended" : ""}`}
                  >
                    {t(lang, stateKey(a.status))}
                  </span>
                </td>
                <td>{a.entries.length}</td>
                <td>
                  <div className="record-actions">
                    <button
                      className="secondary small-btn"
                      onClick={() => open(a.id)}
                    >
                      {t(lang, a.status === "draft" ? "openDraft" : a.status === "completed" ? "resultTitle" : "resume")}
                    </button>
                    <button className="secondary small-btn" onClick={() => openClone(a.id)}>
                      {t(lang, "cloneAuction")}
                    </button>
                    {a.status === "draft" && (
                      <button className="secondary small-btn" onClick={() => setPendingDeleteId(a.id)}>
                        {t(lang, "delete")}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && <p className="empty">{t(lang, "noAuctions")}</p>}
      {deletedNote && <p className="save-note">{t(lang, "deleted")}</p>}
      {pendingDeleteId && (
        <ConfirmDialog
          lang={lang}
          title={t(lang, "deleteDraftTitle")}
          body={t(lang, "deleteDraftText")}
          confirmLabel={t(lang, "delete")}
          danger
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={confirmDeleteDraft}
        />
      )}
      <div className="home-guide">
        <section>
          <h3>{t(lang, "homeHelpTitle")}</h3>
          <p>{t(lang, "homeHelp")}</p>
        </section>
        <section>
          <h3>{t(lang, "homeLibraryTitle")}</h3>
          <p>{t(lang, "homeLibrary")}</p>
        </section>
      </div>
    </section>
  );
}

export default function App({ userId }: { userId: string }) {
  const [lang, setL] = useState<Lang>(() => getLang());
  const [tab, setTab] = useState<Tab>(() => readTabFromUrl());
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  useEffect(() => {
    const syncLanguage = () => setL(getLang());
    window.addEventListener("obb-language", syncLanguage);
    return () => window.removeEventListener("obb-language", syncLanguage);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    let active = true;
    api
      .candidates()
      .then(items => { if (active) setCandidates(items); })
      .catch(() => { if (active) setError(t(lang, "persistFail")); });
    return () => { active = false; };
  }, [lang]);

  useEffect(() => {
    function onPopState() {
      setTab(readTabFromUrl());
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigateToTab(next: Tab) {
    if (next === tab) return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.pushState(null, "", url);
    setTab(next);
  }

  return (
      <div className="shell">
        <nav className="app-nav">
          <button
            onClick={() => navigateToTab("auctions")}
            aria-current={tab === "auctions" ? "page" : undefined}
          >
            {t(lang, "auctions")}
          </button>
          <button
            onClick={() => navigateToTab("catalog")}
            aria-current={tab === "catalog" ? "page" : undefined}
          >
            {t(lang, "catalog")}
          </button>
          <button
            onClick={() => navigateToTab("lists")}
            aria-current={tab === "lists" ? "page" : undefined}
          >
            {t(lang, "lists")}
          </button>
          <button
            onClick={() => navigateToTab("battlefields")}
            aria-current={tab === "battlefields" ? "page" : undefined}
          >
            {t(lang, "battlefields")}
          </button>
          <button
            onClick={() => navigateToTab("draft")}
            aria-current={tab === "draft" ? "page" : undefined}
          >
            {t(lang, "currentDraft")}
          </button>
          <button
            onClick={() => navigateToTab("live")}
            aria-current={tab === "live" ? "page" : undefined}
          >
            {t(lang, "ongoingAuction")}
          </button>
          <button
            onClick={() => navigateToTab("result")}
            aria-current={tab === "result" ? "page" : undefined}
          >
            {t(lang, "resultTitle")}
          </button>
          <button
            onClick={() => navigateToTab("statistics")}
            aria-current={tab === "statistics" ? "page" : undefined}
          >
            {t(lang, "statistics")}
          </button>
        </nav>
        <Status msg={error} />
        <main className="content">
          {tab === "catalog" ? (
            <Catalog
              lang={lang}
              userId={userId}
              items={candidates}
              onItems={setCandidates}
              onError={setError}
            />
          ) : tab === "lists" ? (
            <Lists
              lang={lang}
              userId={userId}
              candidates={candidates}
              onCandidates={setCandidates}
              onError={setError}
            />
          ) : tab === "battlefields" ? (
            <BattlefieldLibrary lang={lang} userId={userId} />
          ) : tab === "statistics" ? (
            <StatisticsPage key={userId} lang={lang} />
          ) : (
            <AuctionWorkspace
              lang={lang}
              userId={userId}
              candidates={candidates}
              onError={setError}
              view={
                tab === "draft"
                  ? "draft"
                  : tab === "live"
                    ? "live"
                    : tab === "result"
                      ? "result"
                      : "auctions"
              }
              onOpenDraft={() => navigateToTab("draft")}
              onOpenLive={() => navigateToTab("live")}
              onOpenResult={() => navigateToTab("result")}
              onBackToAuctions={() => navigateToTab("auctions")}
              onCandidates={setCandidates}
            />
          )}
        </main>
      </div>
  );
}
