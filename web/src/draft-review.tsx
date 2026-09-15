import { useEffect, useState } from "react";
import {
  api,
  type Auction,
  type DraftBattlefield,
  type FieldError,
  type SavedTeam,
} from "./api";
import { t, type Lang } from "./i18n";
import { ImagePreview } from "./image-preview";

function stepForFieldError(path: string): number {
  if (
    path === "battlefield" ||
    path.startsWith("battlefield.") ||
    path === "background"
  )
    return 0;
  if (
    path === "auction.name" ||
    path === "entries" ||
    path.startsWith("entries") ||
    path.startsWith("candidates")
  )
    return 1;
  return 2;
}

interface Check {
  key: string;
  ok: boolean;
  step: number;
}

export function DraftReview({
  lang,
  auction,
  battlefieldId,
  entries,
  namesReady,
  resolveName,
  onGoStep,
  onReadiness,
  startPending,
  startErrors,
  onStart,
}: {
  lang: Lang;
  auction: Auction;
  battlefieldId: string | null;
  entries: string[];
  namesReady: boolean;
  resolveName: (id: string) => string;
  onGoStep: (step: number) => void;
  onReadiness?: (ready: boolean) => void;
  startPending: boolean;
  startErrors: FieldError[];
  onStart: () => void;
}) {
  const [teams, setTeams] = useState<SavedTeam[] | null>(null);
  const [battlefield, setBattlefield] = useState<DraftBattlefield | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getAuctionTeams(auction.id)
      .then((saved) => {
        if (!cancelled) setTeams(saved);
      })
      .catch(() => {
        if (!cancelled) setLoadError(t(lang, "persistFail"));
      });
    if (battlefieldId) {
      api
        .getDraftBattlefield(auction.id)
        .then((summary) => {
          if (!cancelled) setBattlefield(summary);
        })
        .catch(() => {
          if (!cancelled) setLoadError(t(lang, "persistFail"));
        });
    } else {
      setBattlefield(null);
    }
    return () => {
      cancelled = true;
    };
  }, [auction.id, battlefieldId, lang]);

  const listOk = entries.length >= 4 && entries.length % 2 === 0;
  const teamPair = teams !== null && teams.length === 2 ? teams : null;
  const totals = (teamPair ?? []).map((team) =>
    team.members.reduce((sum, m) => sum + m.initialGold, 0),
  );

  const checks: Check[] = [
    { key: "checkName", ok: !!auction.name.trim(), step: 1 },
    { key: "checkBattle", ok: !!battlefield, step: 0 },
    { key: "checkList", ok: listOk, step: 1 },
    { key: "checkCandidateNames", ok: namesReady, step: 1 },
    {
      key: "checkTeams",
      ok: !!teamPair && teamPair.every((team) => team.name.trim() && (team.slogan ?? "").trim() && team.flag),
      step: 2,
    },
    { key: "checkMembers", ok: !!teamPair && teamPair.every((team) => team.members.length > 0), step: 2 },
    {
      key: "checkGold",
      ok:
        !!teamPair &&
        teamPair.every((team) =>
          team.members.every((m) => m.name.trim() && Number.isInteger(m.initialGold) && m.initialGold > 0),
        ),
      step: 2,
    },
    { key: "checkEqual", ok: !!teamPair && totals[0] === totals[1], step: 2 },
  ];
  const failures = checks.filter((c) => !c.ok);
  const ready = failures.length === 0;

  useEffect(() => {
    onReadiness?.(ready);
  }, [ready, onReadiness]);

  return (
    <section aria-label={t(lang, "stepReview")}>
      <div className="section-title">
        <div>
          <h2>{t(lang, "reviewTitle")}</h2>
          <p className="description">{t(lang, "reviewIntro")}</p>
        </div>
      </div>
      {failures.length > 0 && (
        <div className="error-summary" role="alert">
          <h3>{t(lang, "errors")}</h3>
          <ul>
            {failures.map((c) => (
              <li key={c.key}>
                <button type="button" className="quiet" onClick={() => onGoStep(c.step)}>
                  {t(lang, c.key)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="review-grid">
        <div>
          <section className="review-section">
            <header>
              <h3>{t(lang, "stepBattle")}</h3>
              <button type="button" className="quiet" onClick={() => onGoStep(0)}>
                {t(lang, "edit")}
              </button>
            </header>
            {battlefield ? (
              <div className="review-detail">
                <ImagePreview lang={lang} src={api.draftBattlefieldImageUrl(auction.id)} alt={battlefield.name} />
                <div>
                  <strong>{battlefield.name}</strong>
                  <p>{battlefield.geography}</p>
                </div>
              </div>
            ) : (
              <p className="empty">{t(lang, "noBattlefields")}</p>
            )}
          </section>
          <section className="review-section">
            <header>
              <h3>{t(lang, "stepList")}</h3>
              <button type="button" className="quiet" onClick={() => onGoStep(1)}>
                {t(lang, "edit")}
              </button>
            </header>
            <p className="description" style={{ marginBottom: "10px" }}>
              {auction.name} · {entries.length} {t(lang, "candidates")}
            </p>
            <div className="review-candidates" tabIndex={0} aria-label={t(lang, "stepList")}>
              {entries.map((id) => (
                <ImagePreview
                  key={id}
                  lang={lang}
                  src={api.imageUrl(id)}
                  alt={resolveName(id)}
                  enlargeLabel={resolveName(id)}
                  className="image-preview compact"
                />
              ))}
            </div>
          </section>
          <section className="review-section">
            <header>
              <h3>{t(lang, "stepTeams")}</h3>
              <button type="button" className="quiet" onClick={() => onGoStep(2)}>
                {t(lang, "edit")}
              </button>
            </header>
            {loadError ? (
              <p className="empty">{loadError}</p>
            ) : (
              <div className="review-teams">
                {(teamPair ?? []).map((team, i) => (
                  <div key={team.id}>
                    <strong>{team.name}</strong>
                    <p>
                      {team.members.length} {t(lang, "members")} · {totals[i]} {t(lang, "gold")}
                    </p>
                    <p>{team.slogan}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
        <aside className="checklist">
          <h3>{t(lang, "checks")}</h3>
          {checks.map((c) => (
            <div key={c.key} className={`check${c.ok ? "" : " invalid"}`}>
              <span>{c.ok ? "✓" : "!"}</span>
              {c.ok ? (
                <span>{t(lang, c.key)}</span>
              ) : (
                <button type="button" className="quiet" onClick={() => onGoStep(c.step)}>
                  {t(lang, c.key)}
                </button>
              )}
            </div>
          ))}
          <p className="lock-note">
            <strong>{t(lang, "lock")}</strong>
            <br />
            {t(lang, "lockText")}
          </p>
          {startErrors.length > 0 && (
            <div className="error-summary" role="alert">
              <h3>{t(lang, "startFailed")}</h3>
              <ul>
                {startErrors.map((e) => (
                  <li key={e.path}>
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => onGoStep(stepForFieldError(e.path))}
                    >
                      {e.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            type="button"
            className="primary"
            disabled={!ready || startPending}
            title={ready ? undefined : t(lang, "startDisabledNote")}
            onClick={onStart}
          >
            {t(lang, "start")}
          </button>
          {!ready && <p className="description">{t(lang, "startDisabledNote")}</p>}
        </aside>
      </div>
    </section>
  );
}
