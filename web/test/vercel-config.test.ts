import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
  redirects?: Array<{ source: string; destination: string; has?: unknown[] }>;
  rewrites?: Array<{ source: string; destination: string }>;
};

describe("Vercel routing config", () => {
  it("routes the configured Google callback path to the API", () => {
    expect(config.rewrites).toContainEqual({ source: "/auth/:path*", destination: "/api/index" });
  });

  it("sends non-canonical hosts to the canonical app origin", () => {
    expect(config.redirects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        has: [{ type: "host", value: { neq: "odibb.hayrihabip.com" } }],
        destination: "https://odibb.hayrihabip.com/:path*",
      }),
    ]));
  });
});
