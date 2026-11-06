import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, newToken, hashToken } from "../src/auth-crypto.js";

describe("credential crypto", () => {
  it("password_is_salted_and_bounded", async () => {
    const password = "  password twelve  ";
    const a = await hashPassword(password);
    const b = await hashPassword(password);
    expect(a).not.toBe(b);
    expect(await verifyPassword(password, a)).toBe(true);
    expect(await verifyPassword(password, b)).toBe(true);
    expect(await verifyPassword(password.trim(), a)).toBe(false);
    for (const length of [11, 129]) await expect(hashPassword("x".repeat(length))).rejects.toThrow();
    for (const length of [12, 128]) {
      const value = "x".repeat(length);
      expect(await verifyPassword(value, await hashPassword(value))).toBe(true);
    }
  });

  it("rejects wrong passwords and malformed or unbounded encodings safely", async () => {
    const encoded = await hashPassword("fixture-password");
    expect(await verifyPassword("wrong-password", encoded)).toBe(false);
    for (const bad of ["", "scrypt$999999999$8$1$aa$bb", encoded + "$extra", encoded.replace("32768", "65536")]) {
      expect(await verifyPassword("fixture-password", bad)).toBe(false);
    }
  });

  it("generates independent opaque tokens and SHA-256 digests", () => {
    const token = newToken();
    expect(Buffer.from(token, "base64url").length).toBeGreaterThanOrEqual(32);
    expect(newToken()).not.toBe(token);
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("bounds queued expensive jobs and recovers after saturation", async () => {
    const results = await Promise.allSettled(Array.from({ length: 35 }, () => hashPassword("fixture-password")));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(34);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await verifyPassword("fixture-password", await hashPassword("fixture-password"))).toBe(true);
  }, 15000);
});
