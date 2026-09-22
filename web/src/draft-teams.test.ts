import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import { api } from "./api";
import { parseGold, teamTotal, isTeamsFormValid } from "./team-format";

describe("team preparation helpers", () => {
  it("accepts only positive integers as initial gold", () => {
    expect(parseGold("10")).toBe(10);
    expect(parseGold(" 7 ")).toBe(7);
    expect(parseGold("0")).toBeNull();
    expect(parseGold("-3")).toBeNull();
    expect(parseGold("10.5")).toBeNull();
    expect(parseGold("")).toBeNull();
    expect(parseGold("abc")).toBeNull();
  });

  it("totals only valid gold entries", () => {
    const team = {
      key: "k",
      id: null,
      name: "Kuzey",
      slogan: "",
      position: 0 as const,
      flag: null,
      members: [
        { key: "a", id: null, name: "Elif", goldText: "10", avatar: null },
        { key: "b", id: null, name: "Deniz", goldText: "0", avatar: null },
      ],
    };
    expect(teamTotal(team)).toBe(10);
  });

  it("has team and review i18n keys in both languages", () => {
    // "gold"/"members" intentionally render as themselves in English (prototype).
    expect(t("tr", "gold")).toBe("altın");
    expect(t("en", "gold")).toBe("gold");
    expect(t("tr", "members")).toBe("üye");
    expect(t("en", "members")).toBe("members");
    for (const key of [
      "teamsTitle",
      "teamsIntro",
      "balanced",
      "unbalanced",
      "difference",
      "teamName",
      "slogan",
      "flag",
      "avatar",
      "memberName",
      "initialGold",
      "addMember",
      "removeMember",
      "moveMember",
      "total",
      "invalidGold",
      "requiredName",
      "sloganRequired",
      "optional",
      "noMembers",
      "flagRequired",
      "teamsSaved",
      "reviewTitle",
      "reviewIntro",
      "checks",
      "checkName",
      "checkBattle",
      "checkList",
      "checkCandidateNames",
      "checkTeams",
      "checkMembers",
      "checkGold",
      "checkEqual",
      "lock",
      "lockText",
      "start",
      "errors",
      "startDisabledNote",
    ]) {
      expect(t("tr", key)).not.toBe(key);
      expect(t("en", key)).not.toBe(key);
    }
  });

  it("exposes auction team client methods", () => {
    expect(typeof api.getAuctionTeams).toBe("function");
    expect(typeof api.saveAuctionTeams).toBe("function");
    expect(typeof api.uploadTeamImage).toBe("function");
    expect(typeof api.teamFlagUrl).toBe("function");
    expect(typeof api.teamAvatarUrl).toBe("function");
    expect(typeof api.teamImageUrl).toBe("function");
  });

  it("has separate-upload i18n keys in both languages", () => {
    for (const key of ["imageUploadFail", "retry", "singleFileLimitNote"]) {
      expect(t("tr", key)).not.toBe(key);
      expect(t("en", key)).not.toBe(key);
    }
    expect(api.teamImageUrl({ mime: "image/png", name: "flag.png", size: 3, url: "/auctions/a/teams/t/flag" })).toContain(
      "/auctions/a/teams/t/flag",
    );
  });

  it("gates save on fully valid teams including slogan and equal budgets", () => {
    const flag = { marker: "flag" };
    const valid = [
      {
        name: "Kuzey",
        slogan: "Birlik",
        flag,
        members: [{ name: "Elif", goldText: "10" }],
      },
      {
        name: "Guney",
        slogan: "Guc",
        flag,
        members: [{ name: "Deniz", goldText: "10" }],
      },
    ];
    expect(isTeamsFormValid(valid)).toBe(true);
    // unequal budgets block save
    expect(
      isTeamsFormValid([
        { ...valid[0], members: [{ name: "Elif", goldText: "10" }] },
        { ...valid[1], members: [{ name: "Deniz", goldText: "20" }] },
      ]),
    ).toBe(false);
    // empty slogan blocks save
    expect(isTeamsFormValid([{ ...valid[0], slogan: "  " }, valid[1]])).toBe(false);
    // missing flag blocks save
    expect(isTeamsFormValid([{ ...valid[0], flag: null }, valid[1]])).toBe(false);
    // empty members blocks save
    expect(isTeamsFormValid([{ ...valid[0], members: [] }, valid[1]])).toBe(false);
    // blank member name blocks save
    expect(
      isTeamsFormValid([
        { ...valid[0], members: [{ name: "  ", goldText: "10" }] },
        valid[1],
      ]),
    ).toBe(false);
    // invalid gold blocks save
    expect(
      isTeamsFormValid([
        { ...valid[0], members: [{ name: "Elif", goldText: "0" }] },
        valid[1],
      ]),
    ).toBe(false);
  });
});
