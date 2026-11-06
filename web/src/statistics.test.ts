import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type AuctionStatistics } from "./api";
import { StatisticsReport } from "./statistics";
import { safeDestination } from "./auth";
import App from "./App";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const report: AuctionStatistics = {
  id: "a", name: "My council", status: "ongoing",
  teams: [
    { position: 0, name: "North", spentGold: 6, remainingGold: 14, acquiredCount: 1, members: [{ id: "m", name: "Elif", spentGold: 6, remainingGold: 14 }] },
    { position: 1, name: "South", spentGold: 0, remainingGold: 20, acquiredCount: 0, members: [{ id: "n", name: "Deniz", spentGold: 0, remainingGold: 20 }] },
  ],
  sales: [{ candidateId: "c", name: "Candidate & one", price: 6, winner: 0, winningContributions: [{ name: "Elif", amount: 6 }, { name: "Kaya", amount: 0 }], losingContributions: [{ name: "Deniz", amount: 5 }] }],
};

describe("statistics", () => {
  it("loads private reports through the existing transport, encodes ids and surfaces failures", async () => {
    const paths: string[] = [];
    vi.stubGlobal("fetch", async (input: string) => {
      paths.push(input);
      return paths.length < 3
        ? new Response(JSON.stringify(paths.length === 1 ? { candidates: 4, lists: 1, battlefields: 1, auctions: [] } : report))
        : new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    });
    expect(await api.statistics()).toMatchObject({ candidates: 4, auctions: [] });
    expect(await api.auctionStatistics("a/b")).toEqual(report);
    expect(paths[0]).toMatch(/\/statistics$/);
    expect(paths[1]).toMatch(/\/statistics\/auctions\/a%2Fb$/);
    await expect(api.auctionStatistics("foreign")).rejects.toMatchObject({ status: 404 });
  });

  it("keeps statistics deep links through login and places the tab last", () => {
    expect(safeDestination("/app?tab=statistics")).toBe("/app?tab=statistics");
    vi.stubGlobal("localStorage", { getItem: () => null });
    vi.stubGlobal("window", { location: { search: "?tab=statistics" } });
    const html = renderToStaticMarkup(createElement(App, { userId: "u" }));
    const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
    expect(nav.trim()).toMatch(/aria-current="page">İstatistikler<\/button>$/);
    expect(html).toContain("Yalnızca kendi hesabına ait");
  });

  it.each(["tr", "en"] as const)("renders sales, zero contributions, losing bids and team spending in %s", lang => {
    const html = renderToStaticMarkup(createElement(StatisticsReport, { lang, report }));
    expect(html).toContain("My council");
    expect(html).toContain("Candidate &amp; one");
    expect(html).toContain("Elif");
    expect(html).toContain("Kaya");
    expect(html).toContain("Deniz");
    expect(html).toMatch(/>0<\/td>/);
    expect(html).toMatch(/>5<\/td>/);
    expect(html).toContain(lang === "tr" ? "Son onaylanan teklif" : "Last confirmed bid");
    expect(html).toContain(lang === "tr" ? "Harcanan altın" : "Gold spent");
  });

  it("distinguishes missing history, no confirmed bid and no settled sale", () => {
    const sale = report.sales[0];
    const render = (sales: AuctionStatistics["sales"]) => renderToStaticMarkup(createElement(StatisticsReport, { lang: "en", report: { ...report, sales } }));
    expect(render([{ ...sale, winningContributions: null, losingContributions: null }])).toContain("Historical bid details are unavailable");
    expect(render([{ ...sale, losingContributions: [] }])).toContain("No confirmed bid");
    expect(render([])).toContain("No settled sales yet");
  });
});
