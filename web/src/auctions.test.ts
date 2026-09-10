import { describe, expect, it } from "vitest";
import { t } from "./i18n";

describe("auction drafts i18n", () => {
  it("has draft keys in both languages", () => {
    for (const k of [
      "createDraft",
      "rename",
      "draftName",
      "resume",
      "fromList",
      "searchAuctions",
    ])
      expect(t("tr", k)).not.toBe(k);
    for (const k of [
      "createDraft",
      "rename",
      "draftName",
      "resume",
      "fromList",
      "searchAuctions",
    ])
      expect(t("en", k)).not.toBe(k);
  });

  it("never translates user-authored draft names (rendered raw)", () => {
    const draftName = "Benim Taslağım";
    expect(t("en", draftName)).toBe(draftName);
    expect(t("tr", draftName)).toBe(draftName);
  });

  it("persists selected draft pointer key contract", () => {
    expect("obb-selected-auction").toBe("obb-selected-auction");
  });
});
