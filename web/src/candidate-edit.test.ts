import { describe, expect, it } from "vitest";
import { t } from "./i18n";

describe("candidate identity editing i18n", () => {
  it("has edit dialog keys in both languages", () => {
    for (const k of [
      "edit",
      "editCandidate",
      "candidateCopy",
      "newCandidateDescription",
      "candidateName",
      "candidateImage",
      "keepImage",
      "save",
      "cancel",
      "close",
      "archiveTitle",
      "archiveText",
      "archived",
      "updated",
    ]) {
      expect(t("tr", k)).not.toBe(k);
      expect(t("en", k)).not.toBe(k);
    }
  });

  it("describes copy-on-edit without translating user content", () => {
    expect(t("tr", "candidateCopy")).toMatch(/yeni kay/);
    expect(t("en", "candidateCopy")).toMatch(/new .*record/i);
  });
});
