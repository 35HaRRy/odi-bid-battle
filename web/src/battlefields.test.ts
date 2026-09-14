import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import { api } from "./api";

describe("battlefield client and i18n", () => {
  it("has required battlefield i18n keys in both languages", () => {
    for (const key of [
      "battlefields",
      "newBattlefield",
      "editBattlefield",
      "geography",
      "history",
      "noBattlefields",
      "selectBattlefield",
      "selected",
      "clearSelection",
      "initialBackground",
      "changeBackground",
      "resetBackground",
      "battlefieldIntro",
      "battleTitle",
      "battleSubtitle",
      "geographyFeatures",
      "historyPast",
      "firstHalfBackground",
      "changeImage",
      "editTexts",
      "selectedBattlefield",
    ]) {
      expect(t("tr", key)).not.toBe(key);
      expect(t("en", key)).not.toBe(key);
    }
  });

  it("constructs correct battlefield and background URLs", () => {
    expect(api.battlefieldImageUrl("bf-1")).toContain("/battlefields/bf-1/image");
    expect(api.draftBattlefieldImageUrl("auc-1")).toContain("/auctions/auc-1/battlefield/image");
    expect(api.auctionBackgroundUrl("auc-1")).toContain("/auctions/auc-1/background");
    expect(api.auctionBackgroundUrl("auc-1", 2)).toContain("/auctions/auc-1/background?r=2");
  });
});
