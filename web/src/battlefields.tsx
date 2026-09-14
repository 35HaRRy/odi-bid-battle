import { useEffect, useState, useRef } from "react";
import { api, type BattlefieldSummary, type Auction, type DraftBattlefield } from "./api";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ImageField } from "./image-field";
import { ImagePreview } from "./image-preview";

export function BattlefieldEditor({
  lang,
  initial,
  onSave,
  onClose,
}: {
  lang: Lang;
  initial: BattlefieldSummary | null;
  onSave: (fields: { name: string; geography: string; history: string }, file: File | null) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [geography, setGeography] = useState(initial?.geography ?? "");
  const [history, setHistory] = useState(initial?.history ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedUrl = initial ? api.battlefieldImageUrl(initial.id) : null;

  return (
    <Modal titleId="battlefield-editor-title" onClose={onClose}>
    <dialog
      aria-labelledby="battlefield-editor-title"
      style={{
        background: "var(--page)",
        border: "1px solid var(--line)",
        padding: "24px",
        maxWidth: "500px",
        width: "100%",
        borderRadius: "4px",
      }}
    >
      <form
        method="dialog"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || !geography.trim() || !history.trim()) return;
          if (!initial && !file) {
            setError(t(lang, "persistFail"));
            return;
          }
          setSaving(true);
          setError(null);
          try {
            await onSave({ name, geography, history }, file);
            onClose();
          } catch (err) {
            setError((err as Error).message || t(lang, "persistFail"));
          } finally {
            setSaving(false);
          }
        }}
      >
        <h2 id="battlefield-editor-title" style={{ marginBottom: "12px", fontFamily: "var(--serif)" }}>
          {initial ? t(lang, "editBattlefield") : t(lang, "newBattlefield")}
        </h2>
        {error && <div style={{ color: "var(--red)", marginBottom: "12px", fontSize: "12px" }}>{error}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <label>
            <span>{t(lang, "name")}</span>
            <input
              aria-label={t(lang, "name")}
              value={name}
              maxLength={200}
              required
              autoFocus
              disabled={saving}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            <span>{t(lang, "geography")}</span>
            <textarea
              aria-label={t(lang, "geography")}
              value={geography}
              required
              rows={3}
              disabled={saving}
              onChange={(e) => setGeography(e.target.value)}
            />
          </label>
          <label>
            <span>{t(lang, "history")}</span>
            <textarea
              aria-label={t(lang, "history")}
              value={history}
              required
              rows={3}
              disabled={saving}
              onChange={(e) => setHistory(e.target.value)}
            />
          </label>
          <ImageField
            lang={lang}
            label={t(lang, "image")}
            accept="image/png,image/jpeg,image/gif,image/webp"
            file={file}
            savedSrc={savedUrl}
            savedAlt={name}
            unsaved
            busy={saving}
            busyLabel={t(lang, "imageUploading")}
            emptyLabel={t(lang, "noImage")}
            onSelect={setFile}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
            <button type="button" className="secondary" disabled={saving} onClick={onClose}>
              {t(lang, "cancel")}
            </button>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? "..." : t(lang, "save")}
            </button>
          </div>
        </div>
      </form>
    </dialog>
    </Modal>
  );
}

export function BattlefieldLibrary({ lang }: { lang: Lang }) {
  const [battlefields, setBattlefields] = useState<BattlefieldSummary[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<BattlefieldSummary | null | boolean>(false);
  const [pendingArchive, setPendingArchive] = useState<BattlefieldSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const list = await api.battlefields();
      setBattlefields(list);
    } catch {
      setError(t(lang, "persistFail"));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = battlefields.filter(
    (b) =>
      b.name.toLowerCase().includes(query.toLowerCase()) ||
      b.geography.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div style={{ padding: "34px" }}>
      <div className="app-heading">
        <div>
          <h1>{t(lang, "battlefields")}</h1>
          <p>{t(lang, "battlefieldIntro")}</p>
        </div>
        <button className="primary" onClick={() => setEditing(null)}>{t(lang, "newBattlefield")}</button>
      </div>

      <div className="library-tools">
        <input
          aria-label={t(lang, "search")}
          placeholder={t(lang, "search") + "..."}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span>{filtered.length} {t(lang, "candidates")}</span>
      </div>

      {error && <div style={{ color: "var(--red)", marginBottom: "16px" }}>{error}</div>}

      {filtered.length === 0 ? (
        <p style={{ color: "var(--muted)", fontStyle: "italic" }}>{t(lang, "noBattlefields")}</p>
      ) : (
        <div className="battle-library">
          {filtered.map((b) => (
            <section className="battle-entry" key={b.id} style={{ background: "var(--page)", border: "1px solid var(--line)", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <ImagePreview lang={lang} src={api.battlefieldImageUrl(b.id)} alt={b.name} />
              <h3>{b.name}</h3>
              <p style={{ fontSize: "13px", color: "var(--muted)", overflowWrap: "anywhere" }}>{b.geography}</p>
              <div className="battle-entry-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "auto" }}>
                <button className="secondary small-btn" onClick={() => setEditing(b)}>
                  {t(lang, "edit")}
                </button>
                <button
                  className="quiet"
                  onClick={() => setPendingArchive(b)}
                >
                  {t(lang, "archive")}
                </button>
              </div>
            </section>
          ))}
        </div>
      )}

      {editing !== false && (
        <BattlefieldEditor
          lang={lang}
          initial={typeof editing === "object" ? editing : null}
          onClose={() => setEditing(false)}
          onSave={async (fields, file) => {
            if (editing && typeof editing === "object") {
              await api.editBattlefield(editing.id, fields, file);
            } else {
              if (!file) throw new Error("image required");
              await api.createBattlefield(fields, file);
            }
            await load();
          }}
        />
      )}

      {pendingArchive && (
        <Modal titleId="battlefield-archive-title" onClose={() => setPendingArchive(null)}>
          <dialog aria-labelledby="battlefield-archive-title">
            <h2 id="battlefield-archive-title">{t(lang, "archiveTitle")}</h2>
            <p>{t(lang, "archiveText")}</p>
            <div className="dialog-actions">
              <button type="button" className="secondary" autoFocus onClick={() => setPendingArchive(null)}>
                {t(lang, "cancel")}
              </button>
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  const target = pendingArchive;
                  setPendingArchive(null);
                  try {
                    await api.archiveBattlefield(target.id);
                    await load();
                  } catch {
                    setError(t(lang, "persistFail"));
                  }
                }}
              >
                {t(lang, "archive")}
              </button>
            </div>
          </dialog>
        </Modal>
      )}
    </div>
  );
}

export function BattlefieldPreparation({
  lang,
  auction,
  onAuctionChange,
}: {
  lang: Lang;
  auction: Auction;
  onAuctionChange: (auction: Auction) => void;
}) {
  const [battlefields, setBattlefields] = useState<BattlefieldSummary[]>([]);
  const [draft, setDraft] = useState<DraftBattlefield | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [bgRev, setBgRev] = useState(0);
  const [draftRev, setDraftRev] = useState(0);
  const [editingTexts, setEditingTexts] = useState(false);
  const [geoDraft, setGeoDraft] = useState("");
  const [histDraft, setHistDraft] = useState("");
  const [bgCustom, setBgCustom] = useState(false);
  const bgFileInputRef = useRef<HTMLInputElement>(null);
  const draftFileInputRef = useRef<HTMLInputElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [detailH, setDetailH] = useState<number | null>(null);

  // Keep the left card list exactly as tall as the right detail column.
  useEffect(() => {
    const el = detailRef.current;
    if (!el) return;
    const mq = window.matchMedia("(min-width: 801px)");
    const sync = () => setDetailH(mq.matches ? el.offsetHeight : null);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    mq.addEventListener("change", sync);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", sync);
    };
  }, []);

  const loadDraft = async (battlefieldId: string | null) => {
    if (!battlefieldId) {
      setDraft(null);
      return;
    }
    try {
      const d = await api.getDraftBattlefield(auction.id);
      setDraft(d);
      setGeoDraft(d.geography);
      setHistDraft(d.history);
    } catch {
      // Fall back to the shared record for archived selections.
      const single = await api.getBattlefield(battlefieldId).catch(() => null);
      if (single) {
        setDraft({
          auctionId: auction.id,
          battlefieldId: single.id,
          name: single.name,
          geography: single.geography,
          history: single.history,
          hasCustomImage: false,
          archivedAt: single.archivedAt,
        });
        setGeoDraft(single.geography);
        setHistDraft(single.history);
      } else {
        setDraft(null);
      }
    }
  };

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const list = await api.battlefields();
        if (!live) return;
        setBattlefields(list);
        await loadDraft(auction.battlefieldId);
      } catch {
        if (live) setError(t(lang, "persistFail"));
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auction.id, auction.battlefieldId]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch(api.auctionBackgroundUrl(auction.id), { method: "HEAD" }).catch(() => null);
        if (!live) return;
        const ct = res?.headers.get("content-type") ?? "";
        setBgCustom(!ct.includes("svg"));
      } catch {
        if (live) setBgCustom(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [auction.id, bgRev]);

  const handleSelect = async (id: string | null) => {
    if (id === auction.battlefieldId) return;
    setPending(true);
    setError(null);
    try {
      const updated = await api.setAuctionBattlefield(auction.id, id);
      onAuctionChange(updated);
      setEditingTexts(false);
      setTextError(null);
      // Selection change discards previous draft overrides server-side.
      await loadDraft(updated.battlefieldId);
      setDraftRev((r) => r + 1);
    } catch {
      setError(t(lang, "persistFail"));
    } finally {
      setPending(false);
    }
  };

  const handleBgUpload = async (file: File) => {
    setPending(true);
    setError(null);
    try {
      await api.saveAuctionBackground(auction.id, file);
      setBgRev((r) => r + 1);
    } catch {
      setError(t(lang, "persistFail"));
    } finally {
      setPending(false);
    }
  };

  const handleBgReset = async () => {
    setPending(true);
    setError(null);
    try {
      await api.deleteAuctionBackground(auction.id);
      setBgRev((r) => r + 1);
    } catch {
      setError(t(lang, "persistFail"));
    } finally {
      setPending(false);
    }
  };

  const handleDraftImage = async (file: File) => {
    if (!draft) return;
    setPending(true);
    setError(null);
    try {
      const updated = await api.saveDraftBattlefield(
        auction.id,
        { geography: draft.geography, history: draft.history },
        file,
      );
      setDraft(updated);
      setGeoDraft(updated.geography);
      setHistDraft(updated.history);
      setDraftRev((r) => r + 1);
    } catch {
      setError(t(lang, "persistFail"));
    } finally {
      setPending(false);
    }
  };

  const handleTextSave = async () => {
    if (!draft) return;
    if (!geoDraft.trim() || !histDraft.trim()) {
      setTextError(t(lang, "persistFail"));
      return;
    }
    setPending(true);
    setTextError(null);
    try {
      const updated = await api.saveDraftBattlefield(
        auction.id,
        { geography: geoDraft, history: histDraft },
        null,
      );
      setDraft(updated);
      setEditingTexts(false);
    } catch {
      setTextError(t(lang, "persistFail"));
    } finally {
      setPending(false);
    }
  };

  const isDraft = auction.status === "draft";

  return (
    <div style={{ padding: "28px 34px" }}>
      <div style={{ marginBottom: "22px" }}>
        <h2 style={{ fontFamily: "var(--serif)", fontSize: "30px", marginBottom: "6px" }}>{t(lang, "battleTitle")}</h2>
        <p style={{ color: "var(--muted)", fontSize: "13px" }}>{t(lang, "battleSubtitle")}</p>
      </div>
      {error && <div style={{ color: "var(--red)", marginBottom: "12px" }}>{error}</div>}
      <div className="battle-layout">
        <div
          className="battle-select-scroll"
          tabIndex={0}
          aria-label={t(lang, "battlefields")}
          style={detailH !== null ? { height: detailH, maxHeight: detailH, marginBottom: 0 } : undefined}
        >
          {auction.battlefieldId && (
            <button
              className="secondary"
              disabled={pending || !isDraft}
              onClick={() => handleSelect(null)}
            >
              {t(lang, "clearSelection")}
            </button>
          )}
          {battlefields.map((b) => {
            const selected = auction.battlefieldId === b.id;
            return (
              <button
                key={b.id}
                className="battle-option"
                aria-pressed={selected}
                disabled={pending || !isDraft}
                onClick={() => handleSelect(b.id)}
              >
                <img
                  src={selected && draft ? api.draftBattlefieldImageUrl(auction.id, draftRev) : api.battlefieldImageUrl(b.id)}
                  alt=""
                  style={{ width: "100%", height: "90px", objectFit: "contain", background: "#e9ddbe", border: "1px solid var(--line)" }}
                />
                <strong>{b.name}</strong>
                <span style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t(lang, "geographyFeatures")}: {selected && draft ? draft.geography : b.geography}
                </span>
                <span style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t(lang, "historyPast")}: {selected && draft ? draft.history : b.history}
                </span>
                {selected && <em>{t(lang, "selectedBattlefieldTag")}</em>}
              </button>
            );
          })}
        </div>

        <div ref={detailRef}>
          {draft ? (
            <div style={{ background: "var(--page)", border: "1px solid var(--line)", padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <div className="map-wrap">
                <ImagePreview lang={lang} src={api.draftBattlefieldImageUrl(auction.id, draftRev)} alt={draft.name} className="map-embed" />
                <span className="map-caption">{draft.name}</span>
              </div>

              <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
                <div>
                  <h4 style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "8px" }}>{t(lang, "geographyFeatures")}</h4>
                  {editingTexts ? (
                    <textarea
                      aria-label={t(lang, "geographyFeatures")}
                      value={geoDraft}
                      rows={3}
                      disabled={pending}
                      onChange={(e) => setGeoDraft(e.target.value)}
                      style={{ width: "100%" }}
                    />
                  ) : (
                    <p style={{ fontSize: "13px" }}>{draft.geography}</p>
                  )}
                </div>
                <div>
                  <h4 style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "8px" }}>{t(lang, "historyPast")}</h4>
                  {editingTexts ? (
                    <textarea
                      aria-label={t(lang, "historyPast")}
                      value={histDraft}
                      rows={3}
                      disabled={pending}
                      onChange={(e) => setHistDraft(e.target.value)}
                      style={{ width: "100%" }}
                    />
                  ) : (
                    <p style={{ fontSize: "13px" }}>{draft.history}</p>
                  )}
                </div>
                {!editingTexts && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={pending || !isDraft}
                    onClick={() => setEditingTexts(true)}
                    style={{ position: "absolute", top: 0, right: 0 }}
                  >
                    {t(lang, "editTexts")}
                  </button>
                )}
              </div>
              {textError && <div style={{ color: "var(--red)", fontSize: "12px" }}>{textError}</div>}
              {editingTexts && (
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                  <button type="button" className="secondary" disabled={pending} onClick={() => {
                    setEditingTexts(false);
                    setGeoDraft(draft.geography);
                    setHistDraft(draft.history);
                    setTextError(null);
                  }}>
                    {t(lang, "cancel")}
                  </button>
                    <button type="button" className="primary" disabled={pending || !isDraft} onClick={handleTextSave}>
                      {t(lang, "save")}
                    </button>
                </div>
              )}
              {draft.archivedAt && (
                <span className="state-tag" style={{ color: "var(--red)", borderColor: "var(--red)", alignSelf: "flex-start" }}>
                  {t(lang, "archived")}
                </span>
              )}

              <div style={{ borderTop: "1px solid var(--line)", paddingTop: "16px", display: "flex", gap: "16px", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                  <h4 style={{ fontFamily: "var(--serif)", marginBottom: "4px" }}>{t(lang, "firstHalfBackground")}</h4>
                  <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "10px" }}>
                    {bgCustom ? t(lang, "firstHalfDesc") : t(lang, "firstHalfDefaultDesc")}
                  </p>
                  <div className="bg-box">
                    <ImagePreview lang={lang} src={api.auctionBackgroundUrl(auction.id, bgRev)} alt={t(lang, "firstHalfBackground")} className="bg-embed" />
                  </div>
                </div>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                    ref={bgFileInputRef}
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleBgUpload(file);
                      e.target.value = "";
                    }}
                  />
                  <button
                    className="secondary"
                    disabled={pending || !isDraft}
                    onClick={() => bgFileInputRef.current?.click()}
                  >
                    {pending ? t(lang, "imageUploading") : t(lang, "changeImage")}
                  </button>
                </div>
              </div>

              <div style={{ borderTop: "1px solid var(--line)", paddingTop: "16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                <span style={{ fontSize: "13px", color: "var(--muted)" }}>{t(lang, "selectedBattlefield")}: {draft.name}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  ref={draftFileInputRef}
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleDraftImage(file);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="quiet"
                  style={{ textDecoration: "underline" }}
                  disabled={pending || !isDraft}
                  onClick={() => draftFileInputRef.current?.click()}
                >
                  {pending ? t(lang, "imageUploading") : t(lang, "changeImage")}
                </button>
              </div>
            </div>
          ) : (
            <p style={{ color: "var(--muted)", fontStyle: "italic" }}>{t(lang, "noBattlefields")}</p>
          )}

          <div style={{ marginTop: "24px", borderTop: "1px solid var(--line)", paddingTop: "16px", display: "flex", justifyContent: "flex-start" }}>
            <button
              className="quiet"
              disabled={pending || !isDraft}
              onClick={handleBgReset}
            >
              {t(lang, "resetBackground")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
