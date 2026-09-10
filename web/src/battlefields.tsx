import { useEffect, useState, useRef } from "react";
import { api, type BattlefieldSummary, type Auction } from "./api";
import { t, type Lang } from "./i18n";

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
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    initial ? api.battlefieldImageUrl(initial.id) : null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  return (
    <dialog
      open
      aria-labelledby="battlefield-editor-title"
      onClose={onClose}
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
          <label>
            <span>{t(lang, "image")}</span>
            <input
              aria-label={t(lang, "image")}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              disabled={saving}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {previewUrl && (
            <div style={{ maxHeight: "150px", overflow: "hidden", background: "#e9ddbe", border: "1px solid var(--line)" }}>
              <img src={previewUrl} alt="Preview" style={{ width: "100%", height: "140px", objectFit: "contain" }} />
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
            <button type="button" className="secondary" disabled={saving} onClick={onClose}>
              {t(lang, "cancel")}
            </button>
            <button type="submit" disabled={saving}>
              {saving ? "..." : t(lang, "save")}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}

export function BattlefieldLibrary({ lang }: { lang: Lang }) {
  const [battlefields, setBattlefields] = useState<BattlefieldSummary[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<BattlefieldSummary | null | boolean>(false);
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
        <button onClick={() => setEditing(null)}>{t(lang, "newBattlefield")}</button>
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
              <img src={api.battlefieldImageUrl(b.id)} alt={b.name} />
              <h3>{b.name}</h3>
              <p style={{ fontSize: "13px", color: "var(--muted)", overflowWrap: "anywhere" }}>{b.geography}</p>
              <div className="battle-entry-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "auto" }}>
                <button className="secondary small-btn" onClick={() => setEditing(b)}>
                  {t(lang, "edit")}
                </button>
                <button
                  className="quiet"
                  onClick={async () => {
                    if (confirm(t(lang, "archiveTitle"))) {
                      try {
                        await api.archiveBattlefield(b.id);
                        await load();
                      } catch {
                        setError(t(lang, "persistFail"));
                      }
                    }
                  }}
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
  const [selectedBf, setSelectedBf] = useState<BattlefieldSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bgRev, setBgRev] = useState(0);
  const bgFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const list = await api.battlefields();
        if (!live) return;
        setBattlefields(list);
        if (auction.battlefieldId) {
          const found = list.find((b) => b.id === auction.battlefieldId);
          if (found) {
            setSelectedBf(found);
          } else {
            // direct lookup if archived / missing from active list
            const single = await api.getBattlefield(auction.battlefieldId).catch(() => null);
            if (live && single) setSelectedBf(single);
          }
        } else {
          setSelectedBf(null);
        }
      } catch {
        if (live) setError(t(lang, "persistFail"));
      }
    })();
    return () => {
      live = false;
    };
  }, [auction.battlefieldId]);

  const handleSelect = async (id: string | null) => {
    setPending(true);
    setError(null);
    try {
      const updated = await api.setAuctionBattlefield(auction.id, id);
      onAuctionChange(updated);
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

  const isDraft = auction.status === "draft";

  return (
    <div className="battle-layout" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px", padding: "28px 34px" }}>
      <div>
        <h3 style={{ marginBottom: "16px", fontFamily: "var(--serif)" }}>{t(lang, "battlefields")}</h3>
        {error && <div style={{ color: "var(--red)", marginBottom: "12px" }}>{error}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" }}>
          {auction.battlefieldId && (
            <button
              className="secondary"
              disabled={pending || !isDraft}
              onClick={() => handleSelect(null)}
            >
              {t(lang, "clearSelection")}
            </button>
          )}
          {battlefields.map((b) => (
            <button
              key={b.id}
              className="battle-option"
              aria-pressed={auction.battlefieldId === b.id}
              disabled={pending || !isDraft}
              onClick={() => handleSelect(b.id)}
              style={{
                textAlign: "left",
                padding: "14px",
                background: auction.battlefieldId === b.id ? "var(--pale)" : "var(--page)",
                border: "1px solid var(--line)",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <strong>{b.name}</strong>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>{b.geography}</span>
            </button>
          ))}
        </div>

        <h3 style={{ marginBottom: "12px", fontFamily: "var(--serif)" }}>{t(lang, "initialBackground")}</h3>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            ref={bgFileInputRef}
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleBgUpload(file);
            }}
          />
          <button
            className="secondary"
            disabled={pending || !isDraft}
            onClick={() => bgFileInputRef.current?.click()}
          >
            {t(lang, "changeBackground")}
          </button>
          <button
            className="quiet"
            disabled={pending || !isDraft}
            onClick={handleBgReset}
          >
            {t(lang, "resetBackground")}
          </button>
        </div>
      </div>

      <div className="map-wrap" style={{ background: "var(--page)", border: "1px solid var(--line)", padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <h3 style={{ fontFamily: "var(--serif)" }}>{selectedBf ? selectedBf.name : t(lang, "initialBackground")}</h3>
        <div style={{ maxHeight: "300px", background: "#e9ddbe", border: "1px solid var(--line)", overflow: "hidden" }}>
          <img
            src={api.auctionBackgroundUrl(auction.id, bgRev)}
            alt="Background"
            style={{ width: "100%", height: "280px", objectFit: "contain" }}
          />
        </div>
        {selectedBf ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ maxHeight: "150px", overflow: "hidden" }}>
              <img
                src={api.battlefieldImageUrl(selectedBf.id)}
                alt={selectedBf.name}
                style={{ width: "100%", height: "130px", objectFit: "contain" }}
              />
            </div>
            <p style={{ fontSize: "13px", color: "var(--muted)" }}><strong>{t(lang, "geography")}:</strong> {selectedBf.geography}</p>
            <p style={{ fontSize: "13px", color: "var(--muted)" }}><strong>{t(lang, "history")}:</strong> {selectedBf.history}</p>
            {selectedBf.archivedAt && (
              <span className="state-tag" style={{ color: "var(--red)", borderColor: "var(--red)" }}>
                {t(lang, "archived")}
              </span>
            )}
          </div>
        ) : (
          <p style={{ color: "var(--muted)", fontStyle: "italic" }}>{t(lang, "noBattlefields")}</p>
        )}
      </div>
    </div>
  );
}
