/**
 * Standalone demo client. No chain, no SDK — generates its own VRF-style seed
 * with window.crypto and keeps a play-money balance in localStorage so the game
 * is a real playable demo outside the chain.wtf iframe (a jam requirement).
 *
 * The seed here is cryptographically random but NOT verifiable — that is the
 * whole point of the real VRF. The outcome math is byte-identical to on-chain.
 */

import { resolve } from "../game/outcome.ts";
import { bytesToHex } from "../game/rng.ts";
import type { ModeId } from "../game/config.ts";
import type { CasinoClient, PlayResult } from "./client.ts";

const LS_KEY = "claw.demo.balance.v1";
const START_BALANCE = 1000;
const MIN_BET = 1;
const MAX_BET = 100;

function loadBalance(): number {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw == null) return START_BALANCE;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : START_BALANCE;
  } catch {
    return START_BALANCE;
  }
}

function saveBalance(n: number): void {
  try {
    localStorage.setItem(LS_KEY, String(n));
  } catch {
    /* private mode / storage disabled — balance just won't persist */
  }
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export class MockClient implements CasinoClient {
  readonly kind = "mock" as const;
  private balance = loadBalance();
  private listeners: Array<(b: number) => void> = [];

  async ready(): Promise<void> {
    /* nothing to wait for */
  }

  getBalance(): number {
    return this.balance;
  }
  minBet(): number {
    return MIN_BET;
  }
  maxBet(): number {
    return MAX_BET;
  }

  /** Top the demo wallet back up when the player busts. */
  refill(): void {
    this.setBalance(START_BALANCE);
  }

  async play(mode: ModeId, bet: number): Promise<PlayResult> {
    if (bet < MIN_BET || bet > MAX_BET) throw new Error("bet out of range");
    if (bet > this.balance) throw new Error("insufficient balance");

    const seedBytes = new Uint8Array(32);
    crypto.getRandomValues(seedBytes);
    const seedHex = bytesToHex(seedBytes);

    // simulate the VRF round-trip so the "asking the chain…" beat isn't instant
    await new Promise((r) => setTimeout(r, 260 + Math.random() * 240));

    const outcome = resolve(seedHex, mode, bet);
    this.setBalance(round6(this.balance - bet + outcome.payout));
    return { outcome, balance: this.balance };
  }

  commitReveal(): void {
    /* no host to notify */
  }

  onBalanceChange(cb: (b: number) => void): void {
    this.listeners.push(cb);
  }

  private setBalance(n: number): void {
    this.balance = n;
    saveBalance(n);
    for (const cb of this.listeners) cb(n);
  }
}
