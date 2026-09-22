import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ApiError,
  api,
  type Auction,
  type LiveState,
  type SavedTeam,
} from "./api";
import { t, type Lang } from "./i18n";
import { buildEndAuctionClipboardText } from "./end-auction-text";
import { ImagePreview } from "./image-preview";
import { Modal } from "./modal";

export function isLiveAuction(status: string): boolean {
  return status === "ongoing" || status === "completed";
}

export function emptyLiveRound(teams: { id: string; members: unknown[] }[]): {
  activeCandidateId: string | null;
  contributions: number[][];
  acquired: string[][];
} {
  return {
    activeCandidateId: null,
    contributions: teams.map((team) => team.members.map(() => 0)),
    acquired: teams.map(() => []),
  };
}

function errorKey(message: string): string | null {
  if (/nothing to undo/.test(message)) return "nothingToUndo";
  if (/bid must|exceed|positive/.test(message)) return "bidError";
  if (/contribution/.test(message)) return "contributionError";
  if (/not your turn/.test(message)) return "notYourTurn";
  if (/team cannot bid/.test(message)) return "cannotBid";
  if (/no confirmed bid/.test(message)) return "saleError";
  if (/no active round/.test(message)) return "noActiveRound";
  if (/pass not allowed/.test(message)) return "passError";
  if (/active round must resolve/.test(message)) return "resolveFirst";
  if (/settle confirmed bid/.test(message)) return "settleFirst";
  if (/termination not ready/.test(message)) return "endNotReady";
  if (/auction completed/.test(message)) return "auctionEnded";
  if (/no eligible team/.test(message)) return "noEligible";
  if (/no remaining candidates/.test(message)) return "noRemaining";
  return null;
}

function FullscreenIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      {active ? (
        <path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5" />
      ) : (
        <path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6" />
      )}
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 5 4 10l5 5" />
      <path d="M4 10h10a6 6 0 0 1 0 12h-1" />
    </svg>
  );
}

function CrossedSwordsIcon() {
  return (
    <span className="crossed-swords" aria-hidden="true">
      ⚔
    </span>
  );
}

export function LiveCouncil({
  lang,
  auction,
  mode,
  onOpenResult,
  onBackToLive,
}: {
  lang: Lang;
  auction: Auction;
  mode?: "live" | "result";
  onOpenResult?: () => void;
  onBackToLive?: () => void;
}) {
  const [live, setLive] = useState<LiveState | null>(null);
  const [teams, setTeams] = useState<SavedTeam[] | null>(null);
  const [candidateName, setCandidateName] = useState<string>("");
  const [drafts, setDrafts] = useState<number[][]>([[], []]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [battleInfoOpen, setBattleInfoOpen] = useState(true);
  const [showResult, setShowResult] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const sceneRef = useRef<HTMLElement>(null);

  // Match the approved prototype: the live council renders inside the
  // compact live shell while mounted.
  useEffect(() => {
    const shell = document.querySelector(".shell");
    shell?.classList.add("live-shell");
    return () => shell?.classList.remove("live-shell");
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === sceneRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await sceneRef.current?.requestFullscreen();
    } catch {
      setIsFullscreen(false);
    }
  }

  const refresh = useCallback(async () => {
    const next = await api.getLive(auction.id);
    setLive(next);
    setDrafts(next.teams.map((team) => team.members.map((m) => m.contribution)));
    return next;
  }, [auction.id]);

  useEffect(() => {
    let cancelled = false;
    setLive(null);
    setTeams(null);
    setLoadError(null);
    setActionError(null);
    setBattleInfoOpen(true);
    setShowResult(false);
    refresh().then((next) => {
      if (!cancelled && mode === undefined && next.status === "completed")
        setShowResult(true);
    }).catch(() => {
      if (!cancelled) setLoadError(t(lang, "persistFail"));
    });
    api
      .getAuctionTeams(auction.id)
      .then((saved) => {
        if (!cancelled) setTeams(saved);
      })
      .catch(() => {
        if (!cancelled) setLoadError(t(lang, "persistFail"));
      });
    return () => {
      cancelled = true;
    };
  }, [auction.id, lang, refresh]);

  useEffect(() => {
    const id = live?.activeCandidateId;
    if (!id) {
      setCandidateName("");
      return;
    }
    let cancelled = false;
    api
      .getCandidate(id)
      .then((c) => {
        if (!cancelled) setCandidateName(c.name);
      })
      .catch(() => {
        if (!cancelled) setCandidateName(id);
      });
    return () => {
      cancelled = true;
    };
  }, [live?.activeCandidateId]);

  async function run(action: () => Promise<LiveState>, onSuccess?: () => void) {
    if (pending) return;
    setPending(true);
    setActionError(null);
    try {
      await refreshAfter(action);
      onSuccess?.();
    } catch (e) {
      if (e instanceof ApiError) {
        const key = errorKey(e.message);
        setActionError(key ? t(lang, key) : e.message);
      } else {
        setActionError(t(lang, "persistFail"));
      }
    } finally {
      setPending(false);
    }
  }

  async function refreshAfter(action: () => Promise<LiveState>) {
    const next = await action();
    setLive(next);
    setDrafts(next.teams.map((team) => team.members.map((m) => m.contribution)));
  }

  async function confirmSale() {
    await run(() => api.completeSale(auction.id, drafts), () => setSaleOpen(false));
  }

  async function confirmEnd() {
    await run(async () => {
      const next = await api.endAuction(auction.id);
      const meta0 = (teams ?? []).find((tm) => tm.position === 0) ?? null;
      const meta1 = (teams ?? []).find((tm) => tm.position === 1) ?? null;
      const text = buildEndAuctionClipboardText(
        lang,
        {
          name: meta0?.name ?? live?.teams[0]?.name ?? "",
          slogan: meta0?.slogan ?? null,
          members:
            meta0?.members.map((m) => m.name) ??
            live?.teams[0]?.members.map((m) => m.name) ??
            [],
        },
        {
          name: meta1?.name ?? live?.teams[1]?.name ?? "",
          slogan: meta1?.slogan ?? null,
          members:
            meta1?.members.map((m) => m.name) ??
            live?.teams[1]?.members.map((m) => m.name) ??
            [],
        },
      );
      try {
        await navigator.clipboard?.writeText(text);
      } catch {
        // Clipboard kopyası Best-effort: sonlandırma akışını engellemez.
      }
      return next;
    }, () => setEndOpen(false));
  }

  async function undoLastAction() {
    await run(() => api.undoLiveAction(auction.id));
  }

  if (!live) {
    return (
      <section className="locked" aria-label={t(lang, "liveCouncilTitle")}>
        <h2>{t(lang, "liveCouncilTitle")}</h2>
        <p>{loadError ?? t(lang, "liveWaiting")}</p>
      </section>
    );
  }

  const eligible = live.teams.map(
    (team) => team.remainingGold > 0 && team.acquiredCount < live.capacity,
  );
  const turnActive = (pos: 0 | 1) =>
    live.active && live.turn === pos && eligible[pos];

  const teamMeta = (pos: 0 | 1) =>
    (teams ?? []).find((tm) => tm.position === pos) ?? null;

  const saleTeam = live.latest ? live.teams[live.latest.team] : null;
  const saleMeta = live.latest ? teamMeta(live.latest.team) : null;

  const total = (pos: 0 | 1) =>
    (drafts[pos] ?? []).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

  const ended = live.status === "completed";
  const endReason =
    live.cursor >= auction.entries.length ? "noRemaining" : "noEligible";

  const half = live.cursor >= auction.entries.length / 2;

  const showFinal =
    mode === "result" ? ended : mode === "live" ? false : showResult && ended;

  if (mode === "result" && !ended) {
    return (
      <section className="locked" aria-label={t(lang, "resultTitle")}>
        <h2>{t(lang, "resultTitle")}</h2>
        <p>{t(lang, "resultPending")}</p>
        {onBackToLive && (
          <button type="button" className="secondary" onClick={onBackToLive}>
            {t(lang, "resume")}
          </button>
        )}
      </section>
    );
  }

  if (showFinal) {
    return (
      <FinalPresentation
        lang={lang}
        auctionId={auction.id}
        auctionName={auction.name}
        live={live}
        teams={teams}
        onBack={onBackToLive ?? (() => setShowResult(false))}
        infoOpen={battleInfoOpen}
        onToggleInfo={() => setBattleInfoOpen((open) => !open)}
      />
    );
  }

  const sceneImage = live.battlefieldVisible && live.battlefield
    ? api.draftBattlefieldImageUrl(auction.id, live.cursor)
    : api.auctionBackgroundUrl(auction.id, live.cursor);

  return (
    <section
      ref={sceneRef}
      className="live-scene"
      aria-label={t(lang, "liveCouncilTitle")}
      style={{ "--scene-image": `url("${sceneImage}")` } as CSSProperties}
    >
      <header className="live-heading">
        <div className="live-heading-main">
          <h1>{auction.name}</h1>
          <p>
            {t(lang, ended ? "endedState" : "liveCouncilTitle")} ·{" "}
            {t(lang, half ? "secondHalf" : "firstHalf")}
          </p>
        </div>
        {live.battlefieldVisible && live.battlefield && (
          <div className="live-battlefield-control">
            <strong>{live.battlefield.name}</strong>
            <button
              type="button"
              className="secondary battlefield-button"
              onClick={() => setBattleInfoOpen((open) => !open)}
              aria-expanded={battleInfoOpen}
              aria-label={t(lang, "battleInfo")}
              title={t(lang, "battleInfo")}
            >
              <CrossedSwordsIcon />
            </button>
          </div>
        )}
        <div className="live-tools">
          <button
            type="button"
            className="icon-button"
            disabled={!live.canUndo || pending}
            onClick={undoLastAction}
            aria-label={t(lang, "undo")}
            title={t(lang, "undo")}
          >
            <UndoIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => void toggleFullscreen()}
            aria-label={t(lang, "fullscreen")}
            aria-pressed={isFullscreen}
            title={t(lang, "fullscreen")}
          >
            <FullscreenIcon active={isFullscreen} />
          </button>
        </div>
      </header>
      {battleInfoOpen && live.battlefieldVisible && live.battlefield && (
        <BattlefieldInfo
          lang={lang}
          battlefield={live.battlefield}
          onClose={() => setBattleInfoOpen(false)}
        />
      )}
      <div className="live-stage">
        <LiveTeamPane
          lang={lang}
          live={live}
          pos={0}
          meta={teamMeta(0)}
          draft={drafts[0] ?? []}
          active={turnActive(0)}
          eligible={eligible[0]}
          pending={pending}
          onDraft={(member, value) =>
            setDrafts((prev) => {
              const next = prev.map((row) => [...row]);
              next[0][member] = value;
              return next;
            })
          }
          onConfirm={() => run(() => api.confirmBid(auction.id, 0, drafts[0] ?? [], drafts))}
        />
        <section className="live-center" aria-label={t(lang, "activeCandidate")}>
          {!live.active ? (
            <>
              {ended ? (
                <>
                  <div className="waiting">
                    <h2>{t(lang, "endedTitle")}</h2>
                  </div>
                  <div className="live-center-actions">
                    <button
                      type="button"
                      className="primary"
                      disabled={!teams || pending}
                      onClick={() => (onOpenResult ?? (() => setShowResult(true)))()}
                    >
                      {t(lang, "battleBegin")}
                    </button>
                  </div>
                </>
              ) : live.readyToEnd ? (
                <>
                  <div className="waiting">
                    <h2>{t(lang, "readyEnd")}</h2>
                    <p>{t(lang, endReason)}</p>
                  </div>
                  <div className="live-center-actions">
                    <button
                      type="button"
                      className="danger"
                      disabled={pending}
                      onClick={() => {
                        setActionError(null);
                        setEndOpen(true);
                      }}
                    >
                      {t(lang, "endAuction")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="waiting">
                    <h2>{t(lang, "awaitCandidate")}</h2>
                    <p>{t(lang, "awaitHint")}</p>
                  </div>
                  <div className="live-center-actions">
                    <button
                      type="button"
                      className="primary"
                      disabled={pending}
                      onClick={() => run(() => api.sendNextCandidate(auction.id))}
                    >
                      {t(lang, "sendNext")}
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <h2>{candidateName || live.activeCandidateId}</h2>
              <p className="live-hint">
                {t(lang, "activeCandidate")} · {live.cursor + 1} / {auction.entries.length}
              </p>
              {live.activeCandidateId && (
                <ImagePreview
                  lang={lang}
                  src={api.imageUrl(live.activeCandidateId)}
                  alt={candidateName || live.activeCandidateId}
                  className="candidate-image"
                />
              )}
              <div className="last-bid">
                {live.latest ? (
                  <>
                    <span>{t(lang, "latestBid")}</span>
                    <strong>
                      {live.latest.amount} <small>{t(lang, "gold")}</small>
                    </strong>
                    <p>{live.teams[live.latest.team]?.name}</p>
                  </>
                ) : (
                  <p>{t(lang, "noBid")}</p>
                )}
              </div>
              <div className="live-center-actions">
                {live.latest && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={pending}
                    onClick={() => {
                      setActionError(null);
                      setSaleOpen(true);
                    }}
                  >
                    {t(lang, "finishSale")}
                  </button>
                )}
{live.specialPass && !live.latest && (
                  <>
                    <button
                      type="button"
                      className="secondary"
                      disabled={pending}
                      onClick={() => run(() => api.passCandidate(auction.id, drafts))}
                    >
                      {t(lang, "pass")}
                    </button>
                    <p className="live-hint">{t(lang, "passHint")}</p>
                  </>
                )}
              </div>
            </>
          )}
        </section>
        <LiveTeamPane
          lang={lang}
          live={live}
          pos={1}
          meta={teamMeta(1)}
          draft={drafts[1] ?? []}
          active={turnActive(1)}
          eligible={eligible[1]}
          pending={pending}
          onDraft={(member, value) =>
            setDrafts((prev) => {
              const next = prev.map((row) => [...row]);
              next[1][member] = value;
              return next;
            })
          }
          onConfirm={() => run(() => api.confirmBid(auction.id, 1, drafts[1] ?? [], drafts))}
        />
      </div>
      {saleOpen && live.active && live.latest && saleTeam && (
        <Modal
          titleId="sale-dialog-title"
          onClose={() => {
            if (!pending) setSaleOpen(false);
          }}
        >
          <dialog className="app-dialog" aria-labelledby="sale-dialog-title">
            <h2 id="sale-dialog-title">{t(lang, "saleTitle")}</h2>
            <div className="sale-details">
              {live.activeCandidateId && (
                <img
                  src={api.imageUrl(live.activeCandidateId)}
                  alt={candidateName || live.activeCandidateId}
                />
              )}
              <h3>{candidateName || live.activeCandidateId}</h3>
              <div className="sale-team">
                {saleMeta && (
                  <img
                    src={api.teamImageUrl(saleMeta.flag)}
                    alt={saleTeam.name}
                  />
                )}
                <strong>{saleTeam.name}</strong>
              </div>
              <div className="price">
                {live.latest.amount} {t(lang, "gold")}
              </div>
            </div>
            <p>{t(lang, "saleExplain")}</p>
            {actionError && (
              <p className="field-error" role="alert">
                {actionError}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary"
                disabled={pending}
                onClick={() => setSaleOpen(false)}
                autoFocus
              >
                {t(lang, "cancel")}
              </button>
              <button
                type="button"
                className="primary"
                disabled={pending}
                onClick={confirmSale}
              >
                {t(lang, "confirmSale")}
              </button>
            </div>
          </dialog>
        </Modal>
      )}
      {endOpen && !live.active && !ended && (
        <Modal
          titleId="end-dialog-title"
          onClose={() => {
            if (!pending) setEndOpen(false);
          }}
        >
          <dialog className="app-dialog" aria-labelledby="end-dialog-title">
            <h2 id="end-dialog-title">{t(lang, "endTitle")}</h2>
            <p>{t(lang, "endExplain")}</p>
            {actionError && (
              <p className="field-error" role="alert">
                {actionError}
              </p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary"
                disabled={pending}
                onClick={() => setEndOpen(false)}
                autoFocus
              >
                {t(lang, "cancel")}
              </button>
              <button
                type="button"
                className="danger"
                disabled={pending}
                onClick={confirmEnd}
              >
                {t(lang, "endAuction")}
              </button>
            </div>
          </dialog>
        </Modal>
      )}
      {actionError && !saleOpen && !endOpen && (
        <p className="field-error" role="alert">
          {actionError}
        </p>
      )}
      <footer className="live-progress">
        <span>
          {t(lang, "processed")}: {live.cursor} / {auction.entries.length} ·{" "}
          {t(lang, "skipped")}: {live.skipped.length}
        </span>
        <span>
          {total(0)} {t(lang, "gold")} · {total(1)} {t(lang, "gold")}
        </span>
      </footer>
    </section>
  );
}

function BattlefieldInfo({
  lang,
  battlefield,
  onClose,
}: {
  lang: Lang;
  battlefield: NonNullable<LiveState["battlefield"]>;
  onClose: () => void;
}) {
  return (
    <aside className="battlefield-info" aria-label={t(lang, "battleInfo")}>
      <div className="battlefield-info-heading">
        <div>
          <h2>{battlefield.name}</h2>
        </div>
      </div>
      <div className="battlefield-info-grid">
        <section>
          <h3>{t(lang, "geographyFeatures")}</h3>
          <p>{battlefield.geography}</p>
        </section>
        <section>
          <h3>{t(lang, "historyPast")}</h3>
          <p>{battlefield.history}</p>
        </section>
      </div>
    </aside>
  );
}

function FinalPresentation({
  lang,
  auctionId,
  auctionName,
  live,
  teams,
  onBack,
  infoOpen,
  onToggleInfo,
}: {
  lang: Lang;
  auctionId: string;
  auctionName: string;
  live: LiveState;
  teams: SavedTeam[] | null;
  onBack: () => void;
  infoOpen: boolean;
  onToggleInfo: () => void;
}) {
  const acquired = live.teams.reduce((count, team) => count + team.acquiredCount, 0);
  const unpresented = Math.max(0, live.cursor - acquired - live.skipped.length);
  const sceneImage = live.battlefieldVisible && live.battlefield
    ? api.draftBattlefieldImageUrl(auctionId, live.cursor)
    : api.auctionBackgroundUrl(auctionId, live.cursor);

  return (
    <section
      className="final-presentation"
      aria-label={t(lang, "resultTitle")}
      style={{ "--result-scene-image": `url("${sceneImage}")` } as CSSProperties}
    >
      <header className="result-heading">
        <p className="eyebrow">{t(lang, "endedState")}</p>
        <h1>{t(lang, "resultTitle")}</h1>
        <p>{auctionName}{live.battlefield ? ` · ${live.battlefield.name}` : ""}</p>
      </header>
      {live.battlefield && (
        <>
          <div className="result-tools">
            <button
              type="button"
              className="secondary battlefield-button"
              onClick={onToggleInfo}
              aria-expanded={infoOpen}
              aria-label={t(lang, "battleInfo")}
              title={t(lang, "battleInfo")}
            >
              <CrossedSwordsIcon />
            </button>
          </div>
          {infoOpen && (
            <BattlefieldInfo
              lang={lang}
              battlefield={live.battlefield}
              onClose={onToggleInfo}
            />
          )}
        </>
      )}
      <div className="result-teams">
        {live.teams.map((team) => {
          const meta = teams?.find((saved) => saved.position === team.position);
          return (
            <section className="result-team" key={team.position}>
              <header>
                {meta && (
                  <img
                    src={api.teamImageUrl(meta.flag)}
                    alt={team.name}
                  />
                )}
                <h2>{team.name}</h2>
                {meta?.slogan && <p>{meta.slogan}</p>}
              </header>
              <div className="result-candidates" tabIndex={0} aria-label={`${team.name}: ${t(lang, "acquired")}`}>
                {team.acquired.length > 0 ? team.acquired.map((candidate) => (
                  <article key={candidate.candidateId}>
                    <img src={api.imageUrl(candidate.candidateId)} alt={candidate.name} />
                    <h3>{candidate.name}</h3>
                    <p>{candidate.price} {t(lang, "gold")}</p>
                  </article>
                )) : <p className="description">{t(lang, "resultEmpty")}</p>}
              </div>
            </section>
          );
        })}
      </div>
      <p className="result-incomplete">
        {t(lang, "skipped")}: {live.skipped.length} · {t(lang, "unpresented")}: {unpresented} · {t(lang, "resultNote")}
      </p>
      <div className="result-actions">
        <button type="button" className="secondary" onClick={onBack}>{t(lang, "backLive")}</button>
      </div>
    </section>
  );
}

function LiveTeamPane({
  lang,
  live,
  pos,
  meta,
  draft,
  active,
  eligible,
  pending,
  onDraft,
  onConfirm,
}: {
  lang: Lang;
  live: LiveState;
  pos: 0 | 1;
  meta: SavedTeam | null;
  draft: number[];
  active: boolean;
  eligible: boolean;
  pending: boolean;
  onDraft: (member: number, value: number) => void;
  onConfirm: () => void;
}) {
  const team = live.teams[pos];
  const full = team.acquiredCount >= live.capacity;
  const noGold = team.remainingGold === 0;
  const turnText = full
    ? "fullCapacity"
    : noGold
      ? "noGold"
      : active
        ? "turnHere"
        : "waitingTurn";
  // Match the prototype: exhausted capacity/gold stays visible between
  // rounds, and ended councils show the completed state.
  const statusText =
    live.status === "completed"
      ? "endedState"
      : live.active || full || noGold
        ? turnText
        : "awaitCandidate";
  const ACQUIRED_MIN = 40;
  const ACQUIRED_MAX = 340;
  const ACQUIRED_DEFAULT = 90;
  const [acquiredHeight, setAcquiredHeight] = useState(ACQUIRED_DEFAULT);
  const dragStart = useRef<{ y: number; h: number } | null>(null);
  const clampAcquired = (v: number) =>
    Math.min(ACQUIRED_MAX, Math.max(ACQUIRED_MIN, Math.round(v)));
  return (
    <section className="live-team" aria-label={team.name}>
      <header className="live-team-head">
        {meta && (
          <img
            src={api.teamImageUrl(meta.flag)}
            alt={team.name}
          />
        )}
        <div>
          <h2>{team.name}</h2>
          {meta?.slogan && <p>{meta.slogan}</p>}
        </div>
      </header>
      <div className="live-gold">
        <span>{t(lang, "remaining")}</span>
        <strong>
          {team.remainingGold} <small>{t(lang, "gold")}</small>
        </strong>
      </div>
      <div className={`live-turn ${full || !eligible ? "critical" : active ? "" : "muted"}`}>
        {t(lang, statusText)}
      </div>
      <div className="live-columns">
        <span>{t(lang, "memberName")}</span>
        <span>{t(lang, "gold")}</span>
        <span>{t(lang, "contribution")}</span>
      </div>
      <div className="live-members" tabIndex={0} aria-label={`${team.name}: ${t(lang, "members")}`}>
        {team.members.map((m, j) => {
          const avatar = meta?.members.find((sm) => sm.id === m.id)?.avatar ?? null;
          return (
            <div className="live-member" key={m.id}>
              <div className="name">
                {avatar && (
                  <img
                    src={api.teamImageUrl(avatar)}
                    alt=""
                  />
                )}
                <span title={m.name}>{m.name}</span>
              </div>
              <span className="balance">{m.balance}</span>
              {active ? (
                <input
                  type="number"
                  min={0}
                  max={m.balance}
                  step={1}
                  value={draft[j] ?? 0}
                  aria-label={`${m.name}: ${t(lang, "contribution")}`}
                  onChange={(e) => onDraft(j, Math.floor(Number(e.target.value)) || 0)}
                />
              ) : (
                <output>{m.contribution}</output>
              )}
            </div>
          );
        })}
      </div>
      <div className="live-bid">
        <div className="live-bid-total">
          <span>{t(lang, active ? "draftBid" : "confirmedBid")}</span>
          <strong>
            {(active ? draft.reduce((a, b) => a + b, 0) : team.members.reduce((a, m) => a + m.contribution, 0))}{" "}
            <small>{t(lang, "gold")}</small>
          </strong>
        </div>
        <button
          type="button"
          className={active ? "primary" : "secondary"}
          disabled={!active || pending}
          onClick={onConfirm}
        >
          {t(lang, "confirmBid")}
        </button>
      </div>
      <section className="live-acquired">
        <div
          className="live-acquired-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t(lang, "resizeAcquired")}
          aria-valuenow={acquiredHeight}
          aria-valuemin={ACQUIRED_MIN}
          aria-valuemax={ACQUIRED_MAX}
          title={t(lang, "resizeAcquired")}
          tabIndex={0}
          onPointerDown={(e) => {
            dragStart.current = { y: e.clientY, h: acquiredHeight };
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            const s = dragStart.current;
            if (!s) return;
            setAcquiredHeight(clampAcquired(s.h + (s.y - e.clientY)));
          }}
          onPointerUp={() => {
            dragStart.current = null;
          }}
          onPointerCancel={() => {
            dragStart.current = null;
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setAcquiredHeight((h) => clampAcquired(h + 16));
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setAcquiredHeight((h) => clampAcquired(h - 16));
            } else if (e.key === "Home") {
              e.preventDefault();
              setAcquiredHeight(ACQUIRED_MIN);
            } else if (e.key === "End") {
              e.preventDefault();
              setAcquiredHeight(ACQUIRED_MAX);
            }
          }}
          onDoubleClick={() => setAcquiredHeight(ACQUIRED_DEFAULT)}
        />
        <div className="live-acquired-heading">
          <span>{t(lang, "acquired")}</span>
          <span>
            {team.acquiredCount} / {live.capacity}
          </span>
        </div>
        <div
          className="live-acquired-list"
          tabIndex={0}
          aria-label={`${team.name}: ${t(lang, "acquired")}`}
          style={{ height: acquiredHeight, maxHeight: acquiredHeight }}
        >
          {(team.acquired ?? []).length === 0 ? (
            <p className="description">{t(lang, "noneAcquired")}</p>
          ) : (
            (team.acquired ?? []).map((a) => (
              <div key={a.candidateId}>
                <span>{a.name}</span>
                <span>
                  {a.price} <small>{t(lang, "gold")}</small>
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </section>
  );
}
