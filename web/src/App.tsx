import { useEffect, useState } from "react";
import { ApiError, api, type Auction, type Candidate, type CandidateList } from "./api";
import { getLang, setLang, t, type Lang } from "./i18n";

function Banner({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div role="alert" style={{ background: "#7f1d1d", color: "#fff", padding: 8 }}>
      {msg}
    </div>
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
    <section>
      <h2>{t(lang, "catalog")}</h2>
      <div>
        <input
          aria-label={t(lang, "name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t(lang, "name")}
        />
        <input
          aria-label={t(lang, "image")}
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button onClick={create}>{t(lang, "create")}</button>
      </div>
      <ul>
        {items.map((c) => (
          <li key={c.id}>
            <img src={api.imageUrl(c.id)} alt="" width={48} height={48} />
            <span>{c.name}</span>{" "}
            <button onClick={() => archive(c.id)}>{t(lang, "archive")}</button>
          </li>
        ))}
      </ul>
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
  const [addId, setAddId] = useState("");
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

  return (
    <section>
      <h2>{t(lang, "lists")}</h2>
      <div>
        <input
          aria-label={t(lang, "name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t(lang, "newList")}
        />
        <button onClick={createList}>{t(lang, "saveList")}</button>
      </div>
      <div>
        {lists.map((l) => (
          <button
            key={l.id}
            onClick={() => setActiveId(l.id)}
            style={{ fontWeight: l.id === activeId ? "bold" : "normal" }}
          >
            {l.name || t(lang, "draft")}
          </button>
        ))}
      </div>
      {active && (
        <div>
          <h3>
            {active.name || t(lang, "draft")} — {t(lang, "entries")}:{" "}
            {active.entries.length}
          </h3>
          <div>
            <select
              aria-label={t(lang, "addExisting")}
              value={addId}
              onChange={(e) => setAddId(e.target.value)}
            >
              <option value="">{t(lang, "addExisting")}</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              disabled={!addId}
              onClick={() => mutate(api.addEntry(active.id, addId))}
            >
              {t(lang, "add")}
            </button>
          </div>
          <div>
            <input
              aria-label={t(lang, "name")}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t(lang, "createAndAdd")}
            />
            <input
              aria-label={t(lang, "image")}
              type="file"
              accept="image/*"
              onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
            />
            <button onClick={createAndAdd}>{t(lang, "create")}</button>
          </div>
          <ol>
            {active.entries.map((cid, idx) => (
              <li key={cid}>
                <img src={api.imageUrl(cid)} alt="" width={40} height={40} />
                {candidates.find((c) => c.id === cid)?.name ?? cid}
                <button
                  onClick={() =>
                    mutate(api.reorder(active.id, cid, idx - 1))
                  }
                >
                  {t(lang, "up")}
                </button>
                <button
                  onClick={() =>
                    mutate(api.reorder(active.id, cid, idx + 1))
                  }
                >
                  {t(lang, "down")}
                </button>
                <button
                  onClick={() => mutate(api.removeEntry(active.id, cid))}
                >
                  {t(lang, "remove")}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function Auctions({
  lang,
  candidates,
  onError,
}: {
  lang: Lang;
  candidates: Candidate[];
  onError: (m: string | null) => void;
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
  const [addId, setAddId] = useState("");
  const active = auctions.find((a) => a.id === activeId) ?? null;

  useEffect(() => {
    api
      .lists()
      .then(setLists)
      .catch(() => onError(t(lang, "persistFail")));
    api
      .auctions()
      .then(async (as) => {
        // resume selected draft after restart; refresh from server truth
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
    <section>
      <h2>{t(lang, "auctions")}</h2>
      <div>
        <input
          aria-label={t(lang, "searchAuctions")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t(lang, "searchAuctions")}
        />
      </div>
      <div>
        <input
          aria-label={t(lang, "draftName")}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t(lang, "draftName")}
        />
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
        <button onClick={create}>{t(lang, "createDraft")}</button>
      </div>
      <div>
        {visible.map((a) => (
          <button
            key={a.id}
            onClick={() => open(a.id)}
            style={{ fontWeight: a.id === activeId ? "bold" : "normal" }}
          >
            {a.name || t(lang, "draft")}
          </button>
        ))}
      </div>
      {active && (
        <div>
          <h3>
            {active.name || t(lang, "draft")} — {t(lang, "entries")}:{" "}
            {active.entries.length}
            {active.followsSource ? "" : ""}
          </h3>
          <div>
            <input
              aria-label={t(lang, "draftName")}
              value={rename}
              onChange={(e) => setRename(e.target.value)}
              placeholder={t(lang, "draftName")}
            />
            <button onClick={() => mutate(api.renameAuction(active.id, rename))}>
              {t(lang, "rename")}
            </button>
          </div>
          <div>
            <select
              aria-label={t(lang, "addExisting")}
              value={addId}
              onChange={(e) => setAddId(e.target.value)}
            >
              <option value="">{t(lang, "addExisting")}</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              disabled={!addId}
              onClick={() => mutate(api.addAuctionEntry(active.id, addId))}
            >
              {t(lang, "add")}
            </button>
          </div>
          <ol>
            {active.entries.map((cid, idx) => (
              <li key={cid}>
                <img src={api.imageUrl(cid)} alt="" width={40} height={40} />
                {candidates.find((c) => c.id === cid)?.name ?? cid}
                <button
                  onClick={() =>
                    mutate(api.reorderAuction(active.id, cid, idx - 1))
                  }
                >
                  {t(lang, "up")}
                </button>
                <button
                  onClick={() =>
                    mutate(api.reorderAuction(active.id, cid, idx + 1))
                  }
                >
                  {t(lang, "down")}
                </button>
                <button
                  onClick={() => mutate(api.removeAuctionEntry(active.id, cid))}
                >
                  {t(lang, "remove")}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

export default function App() {
  const [lang, setL] = useState<Lang>(() => getLang());
  const [tab, setTab] = useState<"catalog" | "lists" | "auctions">("catalog");
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);

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

  return (
    <div>
      <header>
        <h1>ODI Bid Battle</h1>
        <nav>
          <button onClick={() => setTab("auctions")}>
            {t(lang, "auctions")}
          </button>
          <button onClick={() => setTab("catalog")}>
            {t(lang, "catalog")}
          </button>
          <button onClick={() => setTab("lists")}>{t(lang, "lists")}</button>
          <button disabled>
            {t(lang, "battlefields")} ({t(lang, "comingSoon")})
          </button>
        </nav>
        <label>
          {t(lang, "language")}:{" "}
          <select
            aria-label={t(lang, "language")}
            value={lang}
            onChange={(e) => switchLang(e.target.value as Lang)}
          >
            <option value="tr">Türkçe</option>
            <option value="en">English</option>
          </select>
        </label>
      </header>
      <Banner msg={error} />
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
      ) : (
        <Auctions lang={lang} candidates={candidates} onError={setError} />
      )}
    </div>
  );
}
