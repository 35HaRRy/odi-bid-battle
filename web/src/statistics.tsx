import { useEffect, useState } from "react";
import { api, type AuctionStatistics, type StatisticsOverview } from "./api";
import { t, type Lang } from "./i18n";
import "./statistics.css";

function stateLabel(lang: Lang, status: string) {
  return t(lang, status === "completed" ? "endedState" : status === "ongoing" ? "liveState" : "draftState");
}

function Contributions({ lang, values, winning }: {
  lang: Lang; values: AuctionStatistics["sales"][number]["winningContributions"]; winning: boolean;
}) {
  if (values === null) return <p className="stats-note">{t(lang, "stats_missingHistory")}</p>;
  if (values.length === 0) return <p className="stats-note">{t(lang, "stats_noBid")}</p>;
  return <table className="stats-table">
    <thead><tr><th scope="col">{t(lang, "stats_member")}</th><th scope="col">{t(lang, winning ? "stats_contribution" : "stats_lastBid")}</th></tr></thead>
    <tbody>{values.map((member, index) => <tr key={index}><th scope="row">{member.name}</th><td>{member.amount.toLocaleString(lang)}</td></tr>)}</tbody>
  </table>;
}

export function StatisticsReport({ lang, report }: { lang: Lang; report: AuctionStatistics }) {
  const number = (value: number) => value.toLocaleString(lang, { maximumFractionDigits: 1 });
  return <section className="stats-report" aria-labelledby="stats-auction-title">
    <div className="stats-report-heading">
      <h3 id="stats-auction-title">{report.name}</h3>
      <span className="state-tag">{stateLabel(lang, report.status)}</span>
    </div>
    <div className="stats-teams">
      {report.teams.map(team => <section className="stats-team" key={team.position} aria-labelledby={`stats-team-${team.position}`}>
        <h4 id={`stats-team-${team.position}`} className="serif">{team.name}</h4>
        <dl className="stats-ledger">
          <div><dt>{t(lang, "stats_sold")}</dt><dd>{number(team.acquiredCount)}</dd></div>
          <div><dt>{t(lang, "stats_spent")}</dt><dd>{number(team.spentGold)}</dd></div>
          <div><dt>{t(lang, "stats_remaining")}</dt><dd>{number(team.remainingGold)}</dd></div>
          <div><dt>{t(lang, "stats_average")}</dt><dd>{team.acquiredCount ? number(team.spentGold / team.acquiredCount) : "—"}</dd></div>
        </dl>
        <details className="stats-members">
          <summary>{t(lang, "stats_members")}</summary>
          <table className="stats-table">
            <thead><tr><th scope="col">{t(lang, "stats_member")}</th><th scope="col">{t(lang, "stats_spent")}</th><th scope="col">{t(lang, "stats_remaining")}</th></tr></thead>
            <tbody>{team.members.map(member => <tr key={member.id}><th scope="row">{member.name}</th><td>{number(member.spentGold)}</td><td>{number(member.remainingGold)}</td></tr>)}</tbody>
          </table>
        </details>
      </section>)}
    </div>
    <h3 className="stats-sales-title">{t(lang, "stats_sales")}</h3>
    {report.sales.length === 0 ? <div className="app-empty"><h4>{t(lang, "stats_noSales")}</h4><p>{t(lang, "stats_noSalesHint")}</p></div> : <>
      <p className="stats-note">{t(lang, "stats_saleHint")}</p>
      <div className="stats-sales">{report.sales.map(sale => <details className="stats-sale" key={sale.candidateId}>
        <summary>
          <span className="stats-candidate">{sale.name}</span>
          <span>{report.teams.find(team => team.position === sale.winner)?.name}</span>
          <strong>{number(sale.price)} {t(lang, "gold")}</strong>
        </summary>
        <div className="stats-bids">
          <section><h4>{t(lang, "stats_winning")}</h4><Contributions lang={lang} values={sale.winningContributions} winning /></section>
          <section><h4>{t(lang, "stats_losing")}</h4><Contributions lang={lang} values={sale.losingContributions} winning={false} /></section>
        </div>
      </details>)}</div>
    </>}
  </section>;
}

export function StatisticsPage({ lang }: { lang: Lang }) {
  const [overview, setOverview] = useState<StatisticsOverview | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [report, setReport] = useState<AuctionStatistics | null>(null);
  const [overviewError, setOverviewError] = useState(false);
  const [reportError, setReportError] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setOverview(null); setOverviewError(false);
    api.statistics().then(data => {
      if (!active) return;
      setOverview(data);
      setSelectedId(current => data.auctions.some(auction => auction.id === current)
        ? current : (data.auctions.find(auction => auction.status !== "draft") ?? data.auctions[0])?.id ?? "");
    }).catch(() => { if (active) setOverviewError(true); });
    return () => { active = false; };
  }, [refresh]);

  useEffect(() => {
    let active = true;
    setReport(null); setReportError(false);
    if (selectedId) api.auctionStatistics(selectedId)
      .then(data => { if (active) setReport(data); })
      .catch(() => { if (active) setReportError(true); });
    return () => { active = false; };
  }, [selectedId, refresh]);

  const retry = () => setRefresh(value => value + 1);
  const number = (value: number) => value.toLocaleString(lang);
  return <div className="statistics-page">
    <div className="app-heading">
      <div><h1>{t(lang, "statistics")}</h1><p>{t(lang, "stats_intro")}</p></div>
      <button className="secondary" onClick={retry} disabled={!overview && !overviewError}>{t(lang, "stats_refresh")}</button>
    </div>
    {overviewError ? <div role="alert"><p>{t(lang, "stats_error")}</p><button className="secondary" onClick={retry}>{t(lang, "retry")}</button></div>
      : !overview ? <p role="status">{t(lang, "stats_loading")}</p> : <>
        <section aria-labelledby="stats-overview-title">
          <h2 id="stats-overview-title">{t(lang, "stats_library")}</h2>
          <p className="stats-note">{t(lang, "stats_libraryHint")}</p>
          <dl className="stats-overview">
            {([
              ["stats_candidates", overview.candidates], ["stats_lists", overview.lists],
              ["stats_battlefields", overview.battlefields], ["stats_auctions", overview.auctions.length],
              ["stats_sold", overview.auctions.reduce((sum, auction) => sum + auction.soldCount, 0)],
              ["stats_spent", overview.auctions.reduce((sum, auction) => sum + auction.spentGold, 0)],
            ] as const).map(([label, value]) => <div key={label}><dt>{t(lang, label)}</dt><dd>{number(value)}</dd></div>)}
          </dl>
          <dl className="stats-states">{(["draft", "ongoing", "completed"] as const).map(status => <div key={status}><dt>{stateLabel(lang, status)}</dt><dd>{number(overview.auctions.filter(auction => auction.status === status).length)}</dd></div>)}</dl>
        </section>
        <section className="stats-results" aria-labelledby="stats-results-title">
          <h2 id="stats-results-title">{t(lang, "stats_results")}</h2>
          <p className="stats-note">{t(lang, "stats_resultsHint")}</p>
          {overview.auctions.length === 0 ? <div className="app-empty"><h3>{t(lang, "stats_noAuctions")}</h3><p>{t(lang, "stats_noAuctionsHint")}</p></div> : <>
            <label className="stats-select">{t(lang, "stats_select")}
              <select value={selectedId} onChange={event => setSelectedId(event.target.value)}>
                {overview.auctions.map(auction => <option key={auction.id} value={auction.id}>{auction.name} · {stateLabel(lang, auction.status)}</option>)}
              </select>
            </label>
            {reportError ? <div role="alert"><p>{t(lang, "stats_error")}</p><button className="secondary" onClick={retry}>{t(lang, "retry")}</button></div>
              : report?.id === selectedId ? <StatisticsReport lang={lang} report={report} /> : <p role="status">{t(lang, "stats_loading")}</p>}
          </>}
        </section>
      </>}
  </div>;
}
