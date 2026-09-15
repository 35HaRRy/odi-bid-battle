import { useEffect, useRef, useState } from "react";
import { ApiError, api, type Auction, type Candidate, type CandidateList } from "./api";
import { getLang, setLang, t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ImageField } from "./image-field";
import { ImagePreview } from "./image-preview";
import { BattlefieldLibrary, BattlefieldPreparation } from "./battlefields";
import { DraftTeams } from "./draft-teams";
import { DraftReview } from "./draft-review";
import { LiveCouncil } from "./live-council";
import type { FieldError } from "./api";

type Tab = "auctions" | "catalog" | "lists" | "draft" | "live" | "battlefields";

const TABS: readonly Tab[] = [
  "auctions",
  "catalog",
  "lists",
  "draft",
  "live",
  "battlefields",
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
  ids: string[],
  onResolved: (c: Candidate[]) => void,
) {
  const [extra, setExtra] = useState<Record<string, string>>({});
  useEffect(() => {
    const known = new Set(candidates.map((c) => c.id));
    const missing = [...new Set(ids)].filter((id) => !known.has(id) && !extra[id]);
    if (missing.length === 0) return;
    let live = true;
    (async () => {
      const found: Candidate[] = [];
      for (const id of missing.slice(0, 20)) {
        try {
          found.push(await api.getCandidate(id));
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
  }, [ids.join("|"), candidates.length]);
  return extra;
}

function TreeMark() {
  return (
    <svg viewBox="0 0 38 43" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 4v35M9 14l10 8 10-8M9 24l10 7 10-7" />
    </svg>
  );
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
}: {
  lang: Lang;
  title: string;
  description: string;
  initialName: string;
  previewUrl: string;
  onClose: () => void;
  onSave: (name: string, file: File | null) => void;
}) {
  const [name, setName] = useState(initialName);
  const [file, setFile] = useState<File | null>(null);
  return (
    <Modal titleId="editor-title" onClose={onClose}>
      <dialog aria-labelledby="editor-title">
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onSave(name, file);
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
}: {
  title: string;
  intro: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="app-heading">
      <div>
        <h1>{title}</h1>
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
  const keys = ["stepBattle", "stepList", "stepTeams", "stepReview"];
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

const DRAFT_STEP_KEYS = ["stepBattle", "stepList", "stepTeams", "stepReview"] as const;

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
  const nextName = step < 3 ? t(lang, DRAFT_STEP_KEYS[step + 1]) : null;
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
        {step === 1 ? (
          <p className="footer-note nowrap">{t(lang, "footerNote")}</p>
        ) : step === 2 ? (
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
        {step < 3 && nextName ? (
          <button
            type="button"
            className="secondary small-btn step-nav"
            onClick={() => onGo(step + 1)}
            aria-label={nextName}
          >
            {nextName} →
          </button>
        ) : step === 3 ? (
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

function CatalogPane({
  lang,
  candidates,
  addedIds,
  onAdd,
  onEdit,
  resolveName,
}: {
  lang: Lang;
  candidates: Candidate[];
  addedIds: string[];
  onAdd: (id: string) => void;
  onEdit?: (id: string) => void;
  resolveName?: (id: string) => string;
}) {
  const [search, setSearch] = useState("");
  const q = search.toLocaleLowerCase(lang);
  const shown = candidates.filter((c) =>
    c.name.toLocaleLowerCase(lang).includes(q),
  );
  return (
    <section className="catalog-pane">
      <div className="panel-title">
        <h3>{t(lang, "catalog")}</h3>
        <span>
          {candidates.length} {t(lang, "candidates")}
        </span>
      </div>
      <div className="catalog-tools">
        <input
          type="search"
          aria-label={t(lang, "search")}
          placeholder={t(lang, "search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="catalog-scroll" tabIndex={0} aria-label={t(lang, "catalog")}>
        <div className="catalog-grid">
          {shown.map((c) => (
            <article className="candidate" key={c.id}>
              <ImagePreview
                lang={lang}
                src={api.imageUrl(c.id)}
                alt={resolveName ? resolveName(c.id) : c.name}
                className="candidate-image card-embed"
              />
              <h4>{resolveName ? resolveName(c.id) : c.name}</h4>
              <div className="candidate-controls">
                <button
                  className="secondary small-btn"
                  disabled={addedIds.includes(c.id)}
                  onClick={() => onAdd(c.id)}
                >
                  {addedIds.includes(c.id) ? t(lang, "added") : t(lang, "add")}
                </button>
                {onEdit && (
                  <button
                    className="quiet"
                    aria-label={`${c.name}: ${t(lang, "edit")}`}
                    onClick={() => onEdit(c.id)}
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
}: {
  lang: Lang;
  entries: string[];
  candidates: Candidate[];
  onReorder: (id: string, to: number) => void;
  onRemove: (id: string) => void;
  onEdit?: (id: string) => void;
  emptyText: string;
  resolveName?: (id: string) => string;
}) {
  const label = (cid: string) =>
    resolveName ? resolveName(cid) : nameOf(candidates, cid);
  return (
    <ol className="ordered-list" aria-label={t(lang, "entries")} tabIndex={0}>
      {entries.map((cid, idx) => (
        <li className="ordered-item" key={cid}>
          <span className="order-number">{idx + 1}</span>
          <ImagePreview lang={lang} src={api.imageUrl(cid)} alt={label(cid)} enlargeLabel={label(cid)} className="ordered-thumb" />
          <span className="ordered-name">{label(cid)}</span>
          <div className="ordered-actions">
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
          </div>
        </li>
      ))}
      {entries.length === 0 && <li className="empty">{emptyText}</li>}
    </ol>
  );
}

function Catalog({
  lang,
  items,
  onItems,
  onError,
}: {
  lang: Lang;
  items: Candidate[];
  onItems: (c: Candidate[]) => void;
  onError: (m: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const q = search.toLocaleLowerCase(lang);
  const shown = items.filter((c) =>
    c.name.toLocaleLowerCase(lang).includes(q),
  );
  const editing = editingId ? items.find((c) => c.id === editingId) ?? null : null;

  async function create() {
    if (!name.trim() || !file) return;
    try {
      const c = await api.createCandidate(name, file);
      onItems([...items, c]);
      setName("");
      setFile(null);
      setShowCreate(false);
      onError(null);
    } catch {
      onError(t(lang, "persistFail"));
    }
  }

  function closeCreate() {
    setShowCreate(false);
    setName("");
    setFile(null);
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

  async function saveEdit(name: string, file: File | null) {
    if (!editing) return;
    try {
      const updated = await api.editCatalogCandidate(editing.id, name, file);
      if (updated.id === editing.id) {
        onItems(items.map((c) => (c.id === updated.id ? updated : c)));
      } else {
        onItems([...items.filter((c) => c.id !== editing.id), updated]);
      }
      setEditingId(null);
      onError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        onError(t(lang, "duplicate"));
      else onError(t(lang, "persistFail"));
    }
  }

  return (
    <section className="route-catalog">
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
        <input
          type="search"
          aria-label={t(lang, "search")}
          placeholder={t(lang, "search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span>
          {items.length} {t(lang, "candidates")}
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
            <article className="candidate" key={c.id}>
              <ImagePreview
                lang={lang}
                src={api.imageUrl(c.id)}
                alt={c.name}
                className="candidate-image card-embed"
              />
              <h4>{c.name}</h4>
              <div className="candidate-controls">
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
              </div>
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

function Lists({
  lang,
  candidates,
  onCandidates,
  onError,
}: {
  lang: Lang;
  candidates: Candidate[];
  onCandidates: (c: Candidate[]) => void;
  onError: (m: string | null) => void;
}) {
  const [lists, setLists] = useState<CandidateList[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [newName, setNewName] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [showCreateList, setShowCreateList] = useState(false);
  const [showCreateEntry, setShowCreateEntry] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingScope, setEditingScope] = useState<"entry" | "catalog">("entry");
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const active = lists.find((l) => l.id === activeId) ?? null;
  const allEntryIds = lists.flatMap((l) => l.entries);
  const extraNames = useMissingCandidateNames(candidates, allEntryIds, () => {});
  const resolveName = (id: string) => nameOf(candidates, id, extraNames);
  const editingCandidate =
    editingId ? [...candidates].find((c) => c.id === editingId) : null;
  const editingName =
    editingCandidate?.name ?? (editingId ? extraNames[editingId] : undefined) ?? "";

  useEffect(() => {
    api
      .lists()
      .then((ls) => {
        setLists(ls);
        setActiveId((a) => a ?? ls[0]?.id ?? null);
      })
      .catch(() => onError(t(lang, "persistFail")));
  }, [lang, onError]);

  async function createList() {
    try {
      const l = await api.createList(name, true);
      setLists((p) => [...p, l]);
      setActiveId(l.id);
      setName("");
      setShowCreateList(false);
    } catch {
      onError(t(lang, "persistFail"));
    }
  }

  function closeCreateList() {
    setShowCreateList(false);
    setName("");
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
      setLists((ls) => ls.map((l) => (l.id === updated.id ? updated : l)));
      onError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        onError(t(lang, "duplicate"));
      else onError(t(lang, "persistFail"));
    }
  }

  async function createAndAdd() {
    if (!active || !newName.trim() || !newFile) return;
    try {
      const c = await api.createCandidate(newName, newFile);
      onCandidates([...candidates, c]);
      setNewName("");
      setNewFile(null);
      setShowCreateEntry(false);
      await mutate(api.addEntry(active.id, c.id));
    } catch {
      onError(t(lang, "persistFail"));
    }
  }

  function closeCreateEntry() {
    setShowCreateEntry(false);
    setNewName("");
    setNewFile(null);
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
    if (!active || !editingId) return;
    try {
      const { candidate, list } = await api.editListEntry(
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
      setLists((ls) => ls.map((l) => (l.id === list.id ? list : l)));
      setEditingId(null);
      onError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409)
        onError(t(lang, "duplicate"));
      else onError(t(lang, "persistFail"));
    }
  }

  async function saveCatalogEdit(name: string, file: File | null) {
    if (!editingId) return;
    try {
      const updated = await api.editCatalogCandidate(editingId, name, file);
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
    !!active && active.entries.length >= 4 && active.entries.length % 2 === 0;

  return (
    <section className="route-lists">
      <AppHeading
        title={t(lang, "lists")}
        intro={t(lang, "listsIntro")}
        action={
          <button className="primary" onClick={() => setShowCreateList(true)}>
            {t(lang, "newList")}
          </button>
        }
      />
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
        {lists.map((l) => (
          <section
            className="list-entry"
            key={l.id}
            aria-current={l.id === activeId ? "true" : undefined}
          >
            <div className="panel-title">
              <h2>{l.name || t(lang, "draft")}</h2>
              <span>
                {l.entries.length} {t(lang, "candidates")}
              </span>
            </div>
            <div className="review-candidates" tabIndex={0} aria-label={t(lang, "entries")}>
              {l.entries.map((cid) => (
                <ImagePreview
                  key={cid}
                  lang={lang}
                  src={api.imageUrl(cid)}
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
              <button className="quiet" onClick={() => setConfirmArchiveId(l.id)}>
                {t(lang, "archive")}
              </button>
            </div>
          </section>
        ))}
      </div>
      {lists.length === 0 && <p className="empty">{t(lang, "noLists")}</p>}
      {active && (
        <div className="split" ref={editorRef}>
          <CatalogPane
            lang={lang}
            candidates={candidates}
            addedIds={active.entries}
            onAdd={(cid) => mutate(api.addEntry(active.id, cid))}
            onEdit={(cid) => {
              setEditingId(cid);
              setEditingScope("catalog");
            }}
            resolveName={resolveName}
          />
          <section>
            <div className="selected-head">
              <h3>{active.name || t(lang, "draft")}</h3>
              <span className="mini-label">
                {active.entries.length} {t(lang, "candidates")}
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
              entries={active.entries}
              candidates={candidates}
              onReorder={(cid, to) => mutate(api.reorder(active.id, cid, to))}
              onRemove={(cid) => mutate(api.removeEntry(active.id, cid))}
              onEdit={(cid) => {
                setEditingId(cid);
                setEditingScope("entry");
              }}
              emptyText={t(lang, "emptyList")}
              resolveName={resolveName}
            />
            <p className={`validation-note ${valid ? "" : "error"}`}>
              {t(lang, valid ? "validList" : "invalidList")}
            </p>
          </section>
        </div>
      )}
      {editingId && (
        <CandidateEditDialog
          lang={lang}
          title={t(lang, "editCandidate")}
          description={t(lang, "candidateCopy")}
          initialName={editingName}
          previewUrl={api.imageUrl(editingId)}
          onClose={() => setEditingId(null)}
          onSave={editingScope === "entry" ? saveEntryEdit : saveCatalogEdit}
        />
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

function AuctionWorkspace({
  lang,
  candidates,
  onError,
  view,
  onOpenDraft,
  onOpenLive,
  onBackToAuctions,
  onCandidates,
}: {
  lang: Lang;
  candidates: Candidate[];
  onError: (m: string | null) => void;
  view: "auctions" | "draft" | "live";
  onOpenDraft: () => void;
  onOpenLive: () => void;
  onBackToAuctions: () => void;
  onCandidates: (c: Candidate[]) => void;
}) {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() =>
    localStorage.getItem("obb-selected-auction"),
  );
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [showCreateDraft, setShowCreateDraft] = useState(false);
  const [lists, setLists] = useState<CandidateList[]>([]);
  const [rename, setRename] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
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
        : rawActive;
  const draftEntryIds = active ? active.entries : [];
  const draftExtra = useMissingCandidateNames(candidates, draftEntryIds, () => {});
  const resolveDraftName = (id: string) => nameOf(candidates, id, draftExtra);
  const editingDraftName =
    (editingId ? candidates.find((c) => c.id === editingId)?.name : undefined) ??
    (editingId ? draftExtra[editingId] : undefined) ??
    "";

  useEffect(() => {
    api
      .lists()
      .then(setLists)
      .catch(() => onError(t(lang, "persistFail")));
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
    if (lists.length === 0) return;
    setSourceId((prev) =>
      prev && lists.some((l) => l.id === prev) ? prev : lists[0].id,
    );
  }, [lists]);

  useEffect(() => {
    setRename(active?.name ?? "");
  }, [active?.id, active?.name]);

  useEffect(() => {
    setReviewReady(false);
    setStartErrors([]);
    setStartPending(false);
  }, [active?.id]);

  async function create() {
    try {
      const a = await api.createAuction(newName, sourceId || null);
      setAuctions((p) => [a, ...p]);
      setActiveId(a.id);
      localStorage.setItem("obb-selected-auction", a.id);
      setNewName("");
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
  }

  function open(id: string) {
    setActiveId(id);
    localStorage.setItem("obb-selected-auction", id);
    const target = auctions.find((a) => a.id === id);
    if (target && target.status !== "draft") onOpenLive();
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

  async function saveDraftEntryEdit(name: string, file: File | null) {
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
        const updated = await api.editCatalogCandidate(editingId, name, file);
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
              <div>
                <BattlefieldPreparation
                  lang={lang}
                  auction={active}
                  onAuctionChange={(updated) => {
                    setAuctions((ls) =>
                      ls.map((x) => (x.id === updated.id ? updated : x)),
                    );
                  }}
                />
              </div>
            ) : draftStep === 1 ? (
              <>
                <div className="create-row">
                  <label>
                    {t(lang, "draftName")}
                    <input
                      aria-label={t(lang, "draftName")}
                      value={rename}
                      onChange={(e) => setRename(e.target.value)}
                      placeholder={t(lang, "draftName")}
                    />
                  </label>
                  <button
                    className="secondary"
                    onClick={() => mutate(api.renameAuction(active.id, rename))}
                  >
                    {t(lang, "rename")}
                  </button>
                </div>
                <div className="split">
                  <CatalogPane
                    lang={lang}
                    candidates={candidates}
                    addedIds={active.entries}
                    onAdd={(cid) => mutate(api.addAuctionEntry(active.id, cid))}
                    onEdit={(cid) => setEditingId(cid)}
                    resolveName={resolveDraftName}
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
                      entries={active.entries}
                      candidates={candidates}
                      onReorder={(cid, to) =>
                        mutate(api.reorderAuction(active.id, cid, to))
                      }
                      onRemove={(cid) =>
                        mutate(api.removeAuctionEntry(active.id, cid))
                      }
                      onEdit={(cid) => setEditingId(cid)}
                      emptyText={t(lang, "emptyList")}
                      resolveName={resolveDraftName}
                    />
                  </section>
                </div>
              </>
            ) : draftStep === 2 ? (
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
            previewUrl={api.imageUrl(editingId)}
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
          <LiveCouncil lang={lang} auction={active} />
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
                <label>
                  {t(lang, "fromList")}
                  <select
                    aria-label={t(lang, "fromList")}
                    value={sourceId}
                    onChange={(e) => setSourceId(e.target.value)}
                  >
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name || t(lang, "draft")}
                      </option>
                    ))}
                  </select>
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
                    className={`state-tag ${a.status === "ongoing" ? "running" : ""}`}
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
                      {t(lang, a.status === "draft" ? "openDraft" : "resume")}
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

export default function App() {
  const [lang, setL] = useState<Lang>(() => getLang());
  const [tab, setTab] = useState<Tab>(() => readTabFromUrl());
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  useEffect(() => {
    document.documentElement.lang = lang;
    api
      .candidates()
      .then(setCandidates)
      .catch(() => setError(t(lang, "persistFail")));
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

  function switchLang(l: Lang) {
    setL(l);
    setLang(l);
  }

  return (
    <div>
      <div className="topstrip">
        <span>ODI Bid Battle</span>
        <span>{t(lang, "tagline")}</span>
      </div>
      <div className="shell">
        <header className="masthead">
          <div className="brand">
            <TreeMark />
            <div>
              <strong>ODI Bid Battle</strong>
              <small>{t(lang, "tagline")}</small>
            </div>
          </div>
          <div className="header-tools">
            <div className="lang-switch" role="group" aria-label={t(lang, "language")}>
              <button
                type="button"
                aria-label="Türkçe"
                title="Türkçe"
                aria-pressed={lang === "tr"}
                onClick={() => switchLang("tr")}
              >
                <span aria-hidden="true">🇹🇷</span>
              </button>
              <button
                type="button"
                aria-label="English"
                title="English"
                aria-pressed={lang === "en"}
                onClick={() => switchLang("en")}
              >
                <span aria-hidden="true">🇬🇧</span>
              </button>
            </div>
          </div>
        </header>
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
        </nav>
        <Status msg={error} />
        <main className="content">
          {tab === "catalog" ? (
            <Catalog
              lang={lang}
              items={candidates}
              onItems={setCandidates}
              onError={setError}
            />
          ) : tab === "lists" ? (
            <Lists
              lang={lang}
              candidates={candidates}
              onCandidates={setCandidates}
              onError={setError}
            />
          ) : tab === "battlefields" ? (
            <BattlefieldLibrary lang={lang} />
          ) : (
            <AuctionWorkspace
              lang={lang}
              candidates={candidates}
              onError={setError}
              view={tab === "draft" ? "draft" : tab === "live" ? "live" : "auctions"}
              onOpenDraft={() => navigateToTab("draft")}
              onOpenLive={() => navigateToTab("live")}
              onBackToAuctions={() => navigateToTab("auctions")}
              onCandidates={setCandidates}
            />
          )}
        </main>
        {tab === "draft" || tab === "live" ? null : (
          <footer className="footer">
            <p>{t(lang, "footerNote")}</p>
          </footer>
        )}
      </div>
    </div>
  );
}
