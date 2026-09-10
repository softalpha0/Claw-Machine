/**
 * The prize shelf — the "still playing after 10 hours" hook. Every distinct
 * prize you have ever grabbed is logged forever with the seed that produced it.
 * Persisted to localStorage for the standalone demo.
 */

import { PRIZES, PRIZE_BY_KEY, TOTAL_PRIZES, type Prize } from "./prizes.ts";

const LS_KEY = "claw.collection.v1";

export interface CaughtEntry {
  key: string;
  firstSeed: string;
  firstAt: number;
  count: number;
}

type Store = Record<string, CaughtEntry>;

function load(): Store {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function save(s: Store): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export class Collection {
  private store: Store = load();
  private listeners: Array<() => void> = [];

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }
  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  /** Returns true if this is the first time the prize has been caught. */
  record(key: string, seedHex: string): boolean {
    const existing = this.store[key];
    if (existing) {
      existing.count += 1;
      save(this.store);
      this.emit();
      return false;
    }
    this.store[key] = { key, firstSeed: seedHex, firstAt: Date.now(), count: 1 };
    save(this.store);
    this.emit();
    return true;
  }

  has(key: string): boolean {
    return key in this.store;
  }
  entry(key: string): CaughtEntry | undefined {
    return this.store[key];
  }
  caughtCount(): number {
    return Object.keys(this.store).length;
  }
  total(): number {
    return TOTAL_PRIZES;
  }
  totalGrabs(): number {
    return Object.values(this.store).reduce((a, e) => a + e.count, 0);
  }

  /** Catalogue in display order with caught state attached. */
  list(): Array<{ prize: Prize; caught: boolean; entry?: CaughtEntry }> {
    return PRIZES.map((prize) => ({
      prize,
      caught: this.has(prize.key),
      entry: this.store[prize.key],
    }));
  }

  reset(): void {
    this.store = {};
    save(this.store);
    this.emit();
  }
}

export { PRIZE_BY_KEY };
