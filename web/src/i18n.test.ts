import { describe, expect, it, vi } from "vitest";
import { getLang, t } from "./i18n";

describe("i18n", () => {
  it("defaults to Turkish", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
    } as unknown as Storage);
    expect(getLang()).toBe("tr");
    expect(t("tr", "catalog")).toBe("Aday Kataloğu");
    vi.unstubAllGlobals();
  });

  it("supports English without translating user names", () => {
    expect(t("en", "catalog")).toBe("Candidate Catalog");
    expect(t("en", "no-such-key-xyz")).toBe("no-such-key-xyz");
  });
});
