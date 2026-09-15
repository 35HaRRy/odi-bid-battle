import { useEffect, useState } from "react";
import { api, type Auction, type DraftBattlefield, type SavedTeam } from "./api";
import { t, type Lang } from "./i18n";

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

export function LiveCouncil({
  lang,
  auction,
}: {
  lang: Lang;
  auction: Auction;
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
    if (auction.battlefieldId) {
      api
        .getDraftBattlefield(auction.id)
        .then((summary) => {
          if (!cancelled) setBattlefield(summary);
        })
        .catch(() => {
          if (!cancelled) setLoadError(t(lang, "persistFail"));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [auction.id, auction.battlefieldId, lang]);

  const totals = (teams ?? []).map((team) =>
    team.members.reduce((sum, m) => sum + m.initialGold, 0),
  );

  return (
    <section className="locked" aria-label={t(lang, "liveCouncilTitle")}>
      <svg viewBox="0 0 38 43" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M19 4v35M9 14l10 8 10-8M9 24l10 7 10-7" />
      </svg>
      <h2>{t(lang, "liveCouncilTitle")}</h2>
      <p>
        {auction.name} · {auction.entries.length} {t(lang, "candidates")}
        {battlefield ? ` · ${battlefield.name}` : ""}
      </p>
      <p>{t(lang, "liveCouncilIntro")}</p>
      {loadError ? (
        <p className="empty">{loadError}</p>
      ) : (
        <div className="locked-teams">
          {(teams ?? []).map((team, i) => (
            <div className="locked-team" key={team.id}>
              <img
                src={`data:${team.flag.mime};base64,${team.flag.data}`}
                alt={team.name}
              />
              <strong>{team.name}</strong>
              <span>{team.slogan}</span>
              <span>
                {team.members.length} {t(lang, "members")} · {totals[i]} {t(lang, "gold")}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="locked-message">{t(lang, "liveWaiting")}</p>
      <p className="description">{t(lang, "liveLockedNote")}</p>
    </section>
  );
}
