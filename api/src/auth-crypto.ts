import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 32768;
const r = 8;
const p = 1;
// Two ~32 MiB jobs per process; bound the queue as well as native allocations.
let active = 0;
const waiting: Array<() => void> = [];

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (active < 2) active++;
  else {
    if (waiting.length >= 32) throw new Error("Credential service busy");
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) => {
        if (error) reject(error);
        else resolve(key);
      });
    });
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

function validPassword(password: string): boolean {
  return typeof password === "string" && password.length <= 256 && Array.from(password).length >= 12 && Array.from(password).length <= 128;
}

export async function hashPassword(password: string): Promise<string> {
  if (!validPassword(password)) throw new Error("Password must contain 12–128 characters");
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${N}$${r}$${p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  // Only the supported profile is accepted: attacker-controlled parameters never reach scrypt.
  const match = typeof encoded === "string" && encoded.length <= 200
    ? /^scrypt\$32768\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded) : null;
  const valid = validPassword(password);
  // Missing/malformed hashes and wrong passwords all do one identical-cost KDF.
  const key = await derive(valid ? password : "invalid-password", match ? Buffer.from(match[1], "hex") : Buffer.alloc(16));
  const expected = match ? Buffer.from(match[2], "hex") : Buffer.alloc(64);
  return timingSafeEqual(key, expected) && !!match && valid;
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
