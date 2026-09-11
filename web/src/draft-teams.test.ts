import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import { api } from "./api";
import { parseGold, teamTotal } from "./team-format";

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
  });
});
