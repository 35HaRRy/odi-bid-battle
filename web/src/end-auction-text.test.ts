import { describe, expect, it } from "vitest";
import {
  buildEndAuctionClipboardText,
  buildSimulationPromptText,
  buildSingleTeamText,
} from "./end-auction-text";

describe("buildEndAuctionClipboardText", () => {
  it("matches Turkish template from komut.txt", () => {
    const text = buildEndAuctionClipboardText(
      "tr",
      { name: "Birinci", slogan: "Slogan1", members: ["Ali", "Veli"] },
      { name: "İkinci", slogan: "Slogan2", members: ["Ayşe"] },
    );
    expect(text).toBe(
      [
        'Birinci takımın adı: "Birinci" olacak. "Birinci" takımının sloganı "Slogan1". Ayrıca bu takmın üyeleri şu şekilde:',
        "\t....",
        "\tAli",
        "\tVeli",
        "\t....",
        'İkinci takımın adı: "İkinci" olacak. "İkinci" takımının sloganı "Slogan2". Ayrıca bu takmın üyeleri şu şekilde:',
        "\t....",
        "\tAyşe",
        "\t....",
      ].join("\n"),
    );
  });

  it("matches English template from komut.txt", () => {
    const text = buildEndAuctionClipboardText(
      "en",
      { name: "First", slogan: "Catch1", members: ["A", "B"] },
      { name: "Second", slogan: "Catch2", members: ["C"] },
    );
    expect(text).toBe(
      [
        'Name of first team: "First" olacak. Catchphrase of "First": "Catch1". Also, members of thids team are like these:',
        "\t....",
        "\tA",
        "\tB",
        "\t....",
        'Name of second team: "Second" olacak. Catchphrase of "Second": "Catch2". Also, members of thids team are like these:',
        "\t....",
        "\tC",
        "\t....",
      ].join("\n"),
    );
  });
});

describe("buildSimulationPromptText", () => {
  const first = { name: "Birinci", slogan: "Slogan1", members: ["Ali"] };
  const second = { name: "İkinci", slogan: "Slogan2", members: ["Ayşe"] };

  it("returns only team texts for an empty template", () => {
    const text = buildSimulationPromptText("tr", {
      template: "   ",
      battlefieldName: "Alan",
      first,
      second,
    });
    expect(text).toBe(buildEndAuctionClipboardText("tr", first, second));
  });

  it("replaces all placeholders including single-brace variants", () => {
    const template = [
      "{{Savaş alanı}}",
      "{{1.takım metni}}",
      "{{1.takım metni}}",
      "{{2.takım metni}}",
      "{{2.takım metni}}",
    ].join("\n");
    const text = buildSimulationPromptText("tr", {
      template,
      battlefieldName: "Kuytu Vadi",
      first,
      second,
    });
    const expectedFirst = buildSingleTeamText("tr", 0, first);
    const expectedSecond = buildSingleTeamText("tr", 1, second);
    expect(text).toBe(
      ["Kuytu Vadi", expectedFirst, expectedFirst, expectedSecond, expectedSecond].join("\n"),
    );
    expect(text).not.toContain("{{");
  });

  it("keeps unknown placeholders untouched", () => {
    const text = buildSimulationPromptText("tr", {
      template: "{{bilinmeyen}} {{Savaş alanı}}",
      battlefieldName: "Alan",
      first,
      second,
    });
    expect(text).toBe("{{bilinmeyen}} Alan");
  });
});
