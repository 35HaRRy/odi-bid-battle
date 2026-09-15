import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  api,
  type Auction,
  type LiveState,
  type SavedTeam,
} from "./api";
import { t, type Lang } from "./i18n";
import { ImagePreview } from "./image-preview";

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
  if (/bid must|exceed|positive/.test(message)) return "bidError";
  if (/contribution/.test(message)) return "contributionError";
  if (/not your turn/.test(message)) return "notYourTurn";
  if (/team cannot bid/.test(message)) return "cannotBid";
  if (/no active round/.test(message)) return "noActiveRound";
  return null;
}

export function LiveCouncil({
  lang,
  auction,
}: {
  lang: Lang;
  auction: Auction;
}) {
  const [live, setLive] = useState<LiveState | null>(null);
  const [teams, setTeams] = useState<SavedTeam[] | null>(null);
  const [candidateName, setCandidateName] = useState<string>("");
  const [drafts, setDrafts] = useState<number[][]>([[], []]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Match the approved prototype: the live council renders inside the
  // compact live shell while mounted.
  useEffect(() => {
    const shell = document.querySelector(".shell");
    shell?.classList.add("live-shell");
    return () => shell?.classList.remove("live-shell");
  }, []);

  const refresh = useCallback(async () => {
    const next = await api.getLive(auction.id);
    setLive(next);
    setDrafts(next.teams.map((team) => team.members.map((m) => m.contribution)));
    return next;
  }, [auction.id]);

  useEffect(() => {
    let cancelled = false;
    setLive(null);
    setLoadError(null);
    setActionError(null);
    refresh().catch(() => {
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

  async function run(action: () => Promise<LiveState>) {
    if (pending) return;
    setPending(true);
    setActionError(null);
    try {
      await refreshAfter(action);
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

  const total = (pos: 0 | 1) =>
    (drafts[pos] ?? []).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

  return (
    <section className="live-scene" aria-label={t(lang, "liveCouncilTitle")}>
      <header className="live-heading">
        <div>
          <h1>{auction.name}</h1>
          <p>
            {t(lang, "liveCouncilTitle")} · {live.cursor} / {auction.entries.length}
          </p>
        </div>
      </header>
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
          onConfirm={() => run(() => api.confirmBid(auction.id, 0, drafts[0] ?? []))}
        />
        <section className="live-center" aria-label={t(lang, "activeCandidate")}>
          {!live.active ? (
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
                {live.specialPass && !live.latest && (
                  <>
                    <button
                      type="button"
                      className="secondary"
                      disabled={pending}
                      onClick={() => run(() => api.passCandidate(auction.id))}
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
          onConfirm={() => run(() => api.confirmBid(auction.id, 1, drafts[1] ?? []))}
        />
      </div>
      {actionError && (
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
  const turnText = full
    ? "fullCapacity"
    : team.remainingGold === 0
      ? "noGold"
      : active
        ? "turnHere"
        : "waitingTurn";
  return (
    <section className="live-team" aria-label={team.name}>
      <header className="live-team-head">
        {meta && (
          <img
            src={`data:${meta.flag.mime};base64,${meta.flag.data}`}
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
        {live.active ? t(lang, turnText) : t(lang, "awaitCandidate")}
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
                    src={`data:${avatar.mime};base64,${avatar.data}`}
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
        <div className="live-acquired-heading">
          <span>{t(lang, "acquired")}</span>
          <span>
            {team.acquiredCount} / {live.capacity}
          </span>
        </div>
        <div className="live-acquired-list" tabIndex={0} aria-label={`${team.name}: ${t(lang, "acquired")}`}>
          <p className="description">{t(lang, "noneAcquired")}</p>
        </div>
      </section>
    </section>
  );
}
