import { describe, expect, it } from "vitest";
import {
  AssetError,
  validateAssetImage,
  validateBattlefield,
  type AssetImage,
  type BattlefieldFields,
} from "../src/battlefield-domain.js";

const fields: BattlefieldFields = {
  name: "Pelennor",
  geography: "Doğu sınırı",
  history: "Eski çağ",
};

// Complete one-pixel PNG and GIF images, not arbitrary placeholder bytes.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const gif = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);
const image: AssetImage = { buffer: png, mime: "image/png", name: "field.png" };

describe("battlefield fields", () => {
  it("retains user-authored text while trimming surrounding whitespace", () => {
    expect(validateBattlefield({
      name: " Pelennor ", geography: " Doğu sınırı ", history: " Eski çağ ",
    })).toEqual(fields);
  });

  for (const field of ["name", "geography", "history"] as const) {
    it.each(["", " \t\n ", undefined, null, 42, false, {}, []])(
      `rejects invalid ${field} independently of other fields: %j`,
      (value) => {
        // Runtime request data can violate the declared input contract.
        const input = { ...fields, [field]: value } as BattlefieldFields;
        expect(() => validateBattlefield(input)).toThrow(new AssetError(`invalid ${field}`));
      },
    );

    it(`rejects missing ${field}`, () => {
      const input: Partial<BattlefieldFields> = { ...fields };
      delete input[field];
      expect(() => validateBattlefield(input as BattlefieldFields))
        .toThrow(new AssetError(`invalid ${field}`));
    });
  }

  it("rejects a name over 200 characters", () => {
    expect(() => validateBattlefield({ ...fields, name: "x".repeat(201) }))
      .toThrow(new AssetError("invalid name"));
  });

  it("accepts a trimmed 200-character name and long descriptions", () => {
    expect(validateBattlefield({
      name: ` ${"x".repeat(200)} `,
      geography: "g".repeat(201),
      history: "h".repeat(201),
    })).toEqual({
      name: "x".repeat(200), geography: "g".repeat(201), history: "h".repeat(201),
    });
  });

  it("preserves internal whitespace and leaves the input untouched", () => {
    const input = Object.freeze({ ...fields, history: "  First age\n\nSecond  age  " });
    expect(validateBattlefield(input).history).toBe("First age\n\nSecond  age");
    expect(input.history).toBe("  First age\n\nSecond  age  ");
  });

  it("provides a typed error code to callers", () => {
    try {
      validateBattlefield({ ...fields, name: "" });
      expect.unreachable("Expected validation to reject the name");
    } catch (error) {
      expect(error).toBeInstanceOf(AssetError);
      expect(error).toMatchObject({ code: "invalid name", message: "invalid name" });
    }
  });
});

describe("shared battlefield and background upload validation", () => {
  it.each([
    ["image/png", png],
    ["image/gif", gif],
    ["image/gif", Buffer.concat([Buffer.from("GIF87a"), gif.subarray(6)])],
    // JPEG SOI/marker and WebP RIFF/WEBP signatures exercise the signature policy.
    ["image/jpeg", Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex")],
    ["image/webp", Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64")],
  ])("accepts matching %s bytes and preserves upload metadata", (mime, buffer) => {
    const upload = { buffer: buffer as Buffer, mime: mime as string, name: "original name" };
    expect(validateAssetImage(upload)).toEqual(upload);
  });

  it("rejects empty bytes as a required image", () => {
    expect(() => validateAssetImage({ ...image, buffer: Buffer.alloc(0) }))
      .toThrow(new AssetError("image required"));
  });

  it("rejects a missing image", () => {
    expect(() => validateAssetImage(undefined as unknown as AssetImage))
      .toThrow(new AssetError("image required"));
  });

  it("rejects bytes above 5 MiB", () => {
    const buffer = Buffer.alloc(5 * 1024 * 1024 + 1);
    png.copy(buffer);
    expect(() => validateAssetImage({ ...image, buffer }))
      .toThrow(new AssetError("image too large"));
  });

  it("accepts bytes at exactly 5 MiB", () => {
    const buffer = Buffer.alloc(5 * 1024 * 1024);
    png.copy(buffer);
    expect(validateAssetImage({ ...image, buffer }).buffer).toBe(buffer);
  });

  it.each(["image/svg+xml", "text/plain", "application/octet-stream", "image/jpg", ""])(
    "rejects unsupported MIME %s even with PNG bytes",
    (mime) => {
      expect(() => validateAssetImage({ ...image, mime }))
        .toThrow(new AssetError("invalid image"));
    },
  );

  it("rejects SVG uploads even when named like the trusted bundled default", () => {
    expect(() => validateAssetImage({
      name: "default.svg", mime: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    })).toThrow(new AssetError("invalid image"));
  });

  it.each([
    ["image/png", gif],
    ["image/gif", png],
    ["image/jpeg", png],
    ["image/webp", png],
    ["image/png", png.subarray(0, 7)],
    ["image/gif", Buffer.from("GIF89x")],
    ["image/jpeg", Buffer.from("ffd800", "hex")],
    ["image/webp", Buffer.from("RIFF0000WAVE")],
    ["image/webp", Buffer.from("XXXX0000WEBP")],
    ["image/webp", Buffer.from("RIFF0000WEB")],
  ])("rejects mismatched or incomplete %s signatures", (mime, buffer) => {
    expect(() => validateAssetImage({ ...image, mime: mime as string, buffer: buffer as Buffer }))
      .toThrow(new AssetError("invalid image"));
  });
});
