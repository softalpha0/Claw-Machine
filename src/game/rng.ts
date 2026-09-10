/**
 * Deterministic, unbiased randomness derived from ONE VRF seed.
 *
 * The chain hands the game a single 32-byte seed. Every random decision in a
 * play must be a pure function of that seed so the outcome is reproducible and
 * verifiable by anyone.
 *
 * Canonical derivation (mirrored EXACTLY in contracts/ClawMachineV2.sol so the
 * on-chain payout always equals the one the game animates):
 *
 *     word_i    = sha256( seed(32 bytes) ++ uint32_be(i) )        // 32 bytes
 *     u64_i     = big-endian uint64 of the FIRST 8 bytes of word_i
 *     uniformWad(i) = (u64_i * 1e18) >> 64                        // [0, 1e18)
 *
 * All payout-affecting decisions compare `uniformWad(i)` (BigInt) against a
 * 1e18-scaled threshold — identical integer math to the Solidity `_uniformWad`.
 * `uniform()` (float) is display/flavour only. sha256 is used (not keccak)
 * because it is a cheap EVM precompile, is fast in pure JS, and a player can
 * verify any outcome with a one-line sha256 call. Integer ranges use rejection
 * sampling — never `% n` on a raw word (bias).
 */

import { sha256 } from "@noble/hashes/sha256";

export type Seed = Uint8Array;

const TWO_64 = 18446744073709551616; // 2^64 as a float
const TWO_64n = 1n << 64n;

export function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (s.length % 2 !== 0) throw new Error("odd-length hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let s = "0x";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/** Coerce a hex string or byte array to a 32-byte seed. */
export function toSeed(input: string | Uint8Array): Seed {
  const b = typeof input === "string" ? hexToBytes(input) : input;
  if (b.length === 32) return b;
  return sha256(b); // normalise anything odd-sized to 32 bytes
}

/** sha256(seed ++ uint32be(index)) digest bytes. */
function digest(seed: Seed, index: number): Uint8Array {
  const buf = new Uint8Array(seed.length + 4);
  buf.set(seed, 0);
  buf[seed.length + 0] = (index >>> 24) & 0xff;
  buf[seed.length + 1] = (index >>> 16) & 0xff;
  buf[seed.length + 2] = (index >>> 8) & 0xff;
  buf[seed.length + 3] = index & 0xff;
  return sha256(buf);
}

/** Big-endian uint64 from the first 8 bytes of the digest (as BigInt, 0..2^64-1). */
export function word64(seed: Seed, index: number): bigint {
  const d = digest(seed, index);
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(d[i]!);
  return n;
}

/** WAD (1e18) fixed-point uniform in [0, 1e18). Bit-identical to Solidity `_uniformWad`. */
export const WAD = 1_000_000_000_000_000_000n;
export function uniformWad(seed: Seed, index: number): bigint {
  return (word64(seed, index) * WAD) >> 64n;
}

/**
 * A config number (probability or multiplier, ≤6 decimals) as its 1e18-scaled
 * BigInt — exactly the value the Solidity literal `x e18` compiles to, so
 * threshold comparisons match on both sides.
 */
export function toWad(x: number): bigint {
  return BigInt(Math.round(x * 1e6)) * 1_000_000_000_000n;
}

/** Uniform in [0, 1) with 53 bits of resolution — display / flavour only. */
export function uniform(seed: Seed, index: number): number {
  const d = digest(seed, index);
  // top 53 bits -> exact double in [0,1)
  const hi = ((d[0]! << 24) | (d[1]! << 16) | (d[2]! << 8) | d[3]!) >>> 0; // 32 bits
  const lo = ((d[4]! << 16) | (d[5]! << 8) | d[6]!) >>> 0; // 24 bits -> use 21
  return (hi * 2097152 + (lo >>> 3)) / 9007199254740992; // (32+21)=53 bits / 2^53
}

/**
 * Uniform integer in [0, n) with NO modulo bias, via rejection sampling on the
 * 64-bit word space. `index` is the first probe; rejections walk forward.
 */
export function uniformInt(seed: Seed, index: number, n: number): number {
  if (n <= 0) throw new Error("n must be positive");
  const N = BigInt(n);
  const limit = TWO_64n - (TWO_64n % N);
  for (let probe = index; probe < index + 64; probe++) {
    const w = word64(seed, probe);
    if (w < limit) return Number(w % N);
  }
  return Number(word64(seed, index) % N);
}

/** Pick an index into `weights` proportional to weight. */
export function weightedPick(seed: Seed, index: number, weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = uniform(seed, index) * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) return i;
  }
  return weights.length - 1;
}

void TWO_64;
