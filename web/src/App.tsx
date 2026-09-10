import { useEffect, useState } from "react";
import { ApiError, api, type Auction, type Candidate, type CandidateList } from "./api";
import { getLang, setLang, t, type Lang } from "./i18n";

type Tab = "auctions" | "catalog" | "lists";

function nameOf(candidates: Candidate[], id: string): string {
  return candidates.find((c) => c.id === id)?.name ?? id;
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

function Steps({ lang, current }: { lang: Lang; current: number }) {
  const keys = ["stepBattle", "stepList", "stepTeams", "stepReview"];
  return (
    <div className="steps" role="list" aria-label={t(lang, "stepList")}>
      {keys.map((k, i) => (
        <button
          key={k}
          role="listitem"
          className="step"
          aria-current={i === current ? "step" : undefined}
          disabled={i !== current}
          title={i !== current ? t(lang, "comingSoon") : undefined}
        >
          <span className="step-num">{i + 1}</span>
          {t(lang, k)}
        </button>
      ))}
    </div>
  );
}

function CatalogPane({
  lang,
  candidates,
  addedIds,
  onAdd,
}: {
  lang: Lang;
  candidates: Candidate[];
  addedIds: string[];
  onAdd: (id: string) => void;
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
              <div className="candidate-image">
                <img src={api.imageUrl(c.id)} alt={c.name} />
              </div>
              <h4>{c.name}</h4>
              <div className="candidate-controls">
                <button
                  className="secondary small-btn"
                  disabled={addedIds.includes(c.id)}
                  onClick={() => onAdd(c.id)}
                >
                  {addedIds.includes(c.id) ? t(lang, "added") : t(lang, "add")}
                </button>
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
  emptyText,
}: {
  lang: Lang;
  entries: string[];
  candidates: Candidate[];
  onReorder: (id: string, to: number) => void;
  onRemove: (id: string) => void;
  emptyText: string;
}) {
  return (
    <ol className="ordered-list" aria-label={t(lang, "entries")} tabIndex={0}>
      {entries.map((cid, idx) => (
        <li className="ordered-item" key={cid}>
          <span className="order-number">{idx + 1}</span>
          <img src={api.imageUrl(cid)} alt="" />
          <span className="ordered-name">{nameOf(candidates, cid)}</span>
          <div className="ordered-actions">
            <button
              className="icon-button"
              aria-label={`${nameOf(candidates, cid)}: ${t(lang, "up")}`}
              disabled={idx === 0}
              onClick={() => onReorder(cid, idx - 1)}
            >
              ↑
            </button>
            <button
              className="icon-button"
              aria-label={`${nameOf(candidates, cid)}: ${t(lang, "down")}`}
              disabled={idx === entries.length - 1}
              onClick={() => onReorder(cid, idx + 1)}
            >
              ↓
            </button>
            <button
              className="icon-button"
              aria-label={`${nameOf(candidates, cid)}: ${t(lang, "remove")}`}
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
  const q = search.toLocaleLowerCase(lang);
  const shown = items.filter((c) =>
    c.name.toLocaleLowerCase(lang).includes(q),
  );

  async function create() {
    if (!name.trim() || !file) return;
    try {
      const c = await api.createCandidate(name, file);
      onItems([...items, c]);
      setName("");
      setFile(null);
      onError(null);
    } catch {
      onError(t(lang, "persistFail"));
    }
  }

  async function archive(id: string) {
    try {
      await api.archiveCandidate(id);
      onItems(items.filter((c) => c.id !== id));
    } catch {
      onError(t(lang, "persistFail"));
    }
  }

  return (
    <section className="route-catalog">
      <AppHeading title={t(lang, "catalog")} intro={t(lang, "catalogIntro")} />
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
      <div className="create-row">
        <label>
          {t(lang, "name")}
          <input
            aria-label={t(lang, "name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t(lang, "newCandidate")}
          />
        </label>
        <label>
          {t(lang, "image")}
          <input
            aria-label={t(lang, "image")}
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button className="primary" onClick={create}>
          {t(lang, "create")}
        </button>
      </div>
      <div className="full-catalog">
        {shown.map((c) => (
          <article className="candidate" key={c.id}>
            <div className="candidate-image">
              <img src={api.imageUrl(c.id)} alt={c.name} />
            </div>
            <h4>{c.name}</h4>
            <div className="candidate-controls">
              <button className="quiet" onClick={() => archive(c.id)}>
                {t(lang, "archive")}
              </button>
            </div>
          </article>
        ))}
      </div>
      {shown.length === 0 && <p className="empty">{t(lang, "noResults")}</p>}
    </section>
  );
}

function Lists({
  lang,
  candidates,
  onCandidates,
  onError,
  onUseList,
}: {
  lang: Lang;
  candidates: Candidate[];
  onCandidates: (c: Candidate[]) => void;
  onError: (m: string | null) => void;
  onUseList: (listId: string) => void;
}) {
  const [lists, setLists] = useState<CandidateList[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [newName, setNewName] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const active = lists.find((l) => l.id === activeId) ?? null;

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
    } catch {
      onError(t(lang, "persistFail"));
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
      await mutate(api.addEntry(active.id, c.id));
    } catch {
      onError(t(lang, "persistFail"));
    }
  }

  const valid =
    !!active && active.entries.length >= 4 && active.entries.length % 2 === 0;

  return (
    <section className="route-lists">
      <AppHeading title={t(lang, "lists")} intro={t(lang, "listsIntro")} />
      <div className="create-row">
        <label>
          {t(lang, "newList")}
          <input
            aria-label={t(lang, "name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t(lang, "newList")}
          />
        </label>
        <button className="primary" onClick={createList}>
          {t(lang, "saveList")}
        </button>
      </div>
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
            <div className="review-candidates">
              {l.entries.map((cid) => (
                <img
                  key={cid}
                  src={api.imageUrl(cid)}
                  alt={nameOf(candidates, cid)}
                  title={nameOf(candidates, cid)}
                />
              ))}
            </div>
            <p>{t(lang, "savedSource")}</p>
            <div className="battle-entry-actions">
              <button
                className="secondary small-btn"
                onClick={() => setActiveId(l.id)}
              >
                {t(lang, "selectList")}
              </button>
              <button className="quiet" onClick={() => onUseList(l.id)}>
                {t(lang, "useList")}
              </button>
            </div>
          </section>
        ))}
      </div>
      {lists.length === 0 && <p className="empty">{t(lang, "noLists")}</p>}
      {active && (
        <div className="split">
          <CatalogPane
            lang={lang}
            candidates={candidates}
            addedIds={active.entries}
            onAdd={(cid) => mutate(api.addEntry(active.id, cid))}
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
              <label>
                {t(lang, "createAndAdd")}
                <input
                  aria-label={t(lang, "name")}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t(lang, "createAndAdd")}
                />
              </label>
              <label>
                {t(lang, "image")}
                <input
                  aria-label={t(lang, "image")}
                  type="file"
                  accept="image/*"
                  onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <button className="secondary" onClick={createAndAdd}>
                {t(lang, "create")}
              </button>
            </div>
            <OrderedEntries
              lang={lang}
              entries={active.entries}
              candidates={candidates}
              onReorder={(cid, to) => mutate(api.reorder(active.id, cid, to))}
              onRemove={(cid) => mutate(api.removeEntry(active.id, cid))}
              emptyText={t(lang, "emptyList")}
            />
            <p className={`validation-note ${valid ? "" : "error"}`}>
              {t(lang, valid ? "validList" : "invalidList")}
            </p>
          </section>
        </div>
      )}
    </section>
  );
}

function stateKey(status: string): string {
  if (status === "ongoing") return "liveState";
  if (status === "completed") return "endedState";
  return "draftState";
}

function Auctions({
  lang,
  candidates,
  onError,
  presetSource,
  onPresetUsed,
}: {
  lang: Lang;
  candidates: Candidate[];
  onError: (m: string | null) => void;
  presetSource: string | null;
  onPresetUsed: () => void;
}) {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() =>
    localStorage.getItem("obb-selected-auction"),
  );
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [lists, setLists] = useState<CandidateList[]>([]);
  const [rename, setRename] = useState("");
  const active = auctions.find((a) => a.id === activeId) ?? null;

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
    if (presetSource) {
      setSourceId(presetSource);
      onPresetUsed();
    }
  }, [presetSource, onPresetUsed]);

  useEffect(() => {
    setRename(active?.name ?? "");
  }, [active?.id, active?.name]);

  async function create() {
    try {
      const a = await api.createAuction(newName, sourceId || null);
      setAuctions((p) => [a, ...p]);
      setActiveId(a.id);
      localStorage.setItem("obb-selected-auction", a.id);
      setNewName("");
      onError(null);
    } catch {
      onError(t(lang, "persistFail"));
    }
  }

  function open(id: string) {
    setActiveId(id);
    localStorage.setItem("obb-selected-auction", id);
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

  const visible = auctions.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <section className="route-home">
      <AppHeading title={t(lang, "homeTitle")} intro={t(lang, "homeIntro")} />
      <div className="create-row">
        <label>
          {t(lang, "draftName")}
          <input
            aria-label={t(lang, "draftName")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t(lang, "draftName")}
          />
        </label>
        <label>
          {t(lang, "fromList")}
          <select
            aria-label={t(lang, "fromList")}
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            <option value="">{t(lang, "fromList")}</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name || t(lang, "draft")}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" onClick={create}>
          {t(lang, "createDraft")}
        </button>
      </div>
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
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && <p className="empty">{t(lang, "noAuctions")}</p>}
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
      {active && (
        <section aria-label={active.name || t(lang, "draft")}>
          <div className="section-title">
            <div>
              <h2>{active.name || t(lang, "draft")}</h2>
              <p className="description">
                {active.entries.length} {t(lang, "candidates")}
              </p>
            </div>
          </div>
          <Steps lang={lang} current={1} />
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
                emptyText={t(lang, "emptyList")}
              />
            </section>
          </div>
        </section>
      )}
    </section>
  );
}

export default function App() {
  const [lang, setL] = useState<Lang>(() => getLang());
  const [tab, setTab] = useState<Tab>("auctions");
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [presetSource, setPresetSource] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.lang = lang;
    api
      .candidates()
      .then(setCandidates)
      .catch(() => setError(t(lang, "persistFail")));
  }, [lang]);

  function switchLang(l: Lang) {
    setL(l);
    setLang(l);
  }

  function goDraft(sourceId: string) {
    setPresetSource(sourceId);
    setTab("auctions");
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
            <label>
              {t(lang, "language")}{" "}
              <select
                aria-label={t(lang, "language")}
                value={lang}
                onChange={(e) => switchLang(e.target.value as Lang)}
              >
                <option value="tr">Türkçe</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
        </header>
        <nav className="app-nav">
          <button
            onClick={() => setTab("auctions")}
            aria-current={tab === "auctions" ? "page" : undefined}
          >
            {t(lang, "auctions")}
          </button>
          <button
            onClick={() => setTab("catalog")}
            aria-current={tab === "catalog" ? "page" : undefined}
          >
            {t(lang, "catalog")}
          </button>
          <button
            onClick={() => setTab("lists")}
            aria-current={tab === "lists" ? "page" : undefined}
          >
            {t(lang, "lists")}
          </button>
          <button disabled title={t(lang, "comingSoon")}>
            {t(lang, "battlefields")}
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
              onUseList={goDraft}
            />
          ) : (
            <Auctions
              lang={lang}
              candidates={candidates}
              onError={setError}
              presetSource={presetSource}
              onPresetUsed={() => setPresetSource(null)}
            />
          )}
        </main>
        <footer className="footer">
          <p>{t(lang, "footerNote")}</p>
        </footer>
      </div>
      <p className="bottom-note">{t(lang, "footerNote")}</p>
    </div>
  );
}
