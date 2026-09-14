import { describe, expect, it } from "vitest";
import { t } from "./i18n";

describe("image display i18n", () => {
  it("has shared image keys in both languages", () => {
    for (const k of [
      "uploadImage",
      "enlargeImage",
      "imageUnsaved",
      "imagePreparing",
      "imageUploading",
      "imageSaved",
      "imageLoadFail",
      "imageReadFail",
      "noImage",
      "uploadFlag",
      "uploadAvatar",
      "changeImage",
      "close",
      "image",
    ]) {
      expect(t("tr", k)).not.toBe(k);
      expect(t("en", k)).not.toBe(k);
    }
  });
});
