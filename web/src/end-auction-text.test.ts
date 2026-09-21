import { describe, expect, it } from "vitest";
import { buildEndAuctionClipboardText } from "./end-auction-text";

describe("buildEndAuctionClipboardText", () => {
  it("matches Turkish template from komut.txt", () => {
    const text = buildEndAuctionClipboardText(
      "tr",
      { name: "Birinci", slogan: "Slogan1", members: ["Ali", "Veli"] },
      { name: "İkinci", slogan: "Slogan2", members: ["Ayşe"] },
    );
    expect(text).toBe(
      [
        "...",
        'Birinci takımın adı: "Birinci" olacak. "Birinci" takımının sloganı "Slogan1". Ayrıca bu takmın üyeleri şu şekilde:',
        "\t....",
        "\tAli",
        "\tVeli",
        "\t....",
        'İkinci takımın adı: "İkinci" olacak. "İkinci" takımının sloganı "Slogan2". Ayrıca bu takmın üyeleri şu şekilde:',
        "\t....",
        "\tAyşe",
        "\t....",
        "...",
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
        "...",
        'Name of first team: "First" olacak. Catchphrase of "First": "Catch1". Also, members of thids team are like these:',
        "\t....",
        "\tA",
        "\tB",
        "\t....",
        'Name of second team: "Second" olacak. Catchphrase of "Second": "Catch2". Also, members of thids team are like these:',
        "\t....",
        "\tC",
        "\t....",
        "...",
      ].join("\n"),
    );
  });
});
