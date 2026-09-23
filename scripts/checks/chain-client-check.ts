/** Mock SDK only: no browser, network, wallet, chain or real transactions. */
import assert from "node:assert/strict";
import type { HostSnapshotV1 } from "@chain/casino-sdk/guest";
import { ChainSdkClient } from "../../src/casino/chainClient.ts";
import { bridge } from "./chain-sdk-mock.ts";

type Row = HostSnapshotV1["sessions"]["items"][number];
const address = "0x0000000000000000000000000000000000000000" as const;
const seed = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
const units = (value: number, decimals = 18) =>
  (BigInt(Math.round(value * 1_000_000)) * 10n ** BigInt(decimals - 6)).toString();
const snapshot = (balance: number, rows: Row[] = [], maxBet = 100, decimals = 18): HostSnapshotV1 => ({
  apiVersion: 1,
  integration: { chainId: 31337, slug: "claw", gameAddress: address, manifest: {
    schemaVersion: 1, gameId: "claw", apiVersion: 1, defaultLocale: "en", locales: { en: { name: "CLAW" } },
  } },
  wallet: { status: "ready" }, token: { symbol: "chUSD", decimals },
  balances: { smartVaultBalance: units(balance, decimals) },
  casino: { maxBetAmount: units(maxBet, decimals) },
  sessions: { items: rows }, ui: { locale: "en", theme: "dark" },
});
const row = (key: string, overrides: Partial<Row> = {}): Row => ({
  sessionId: `id-${key}`, sessionKey: key, gameAddress: address,
  phase: 3, isSettled: true, payout: units(10.875), lastEventTimestamp: 0,
  raw: { gameState: seed(2) }, ...overrides,
});
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

const client = new ChainSdkClient();
await client.ready();
assert.equal(client.getBalance(), 0, "connection may precede the first balance snapshot");
const notices: number[] = [];
client.onBalanceChange(value => notices.push(value));
await bridge.push(snapshot(100));
assert.equal(client.getBalance(), 100);
assert.deepEqual(notices, [100], "late initial balance must notify the UI");

await bridge.push(snapshot(100, [], 2));
assert.equal(client.maxBet(), 2);
assert.deepEqual(notices, [100, 100], "a lower cap with unchanged balance must notify the UI");
await bridge.push(snapshot(100, [], 0.5));
assert.equal(client.maxBet(), 0, "a cap below the minimum must not permit a whole-token wager");
assert.equal(notices.length, 3);
await bridge.push(snapshot(100, [], 0.5));
assert.equal(notices.length, 3, "an identical snapshot must not cause repeated UI updates");
await bridge.push(snapshot(100, [], 100));

// The settle push can arrive before openSession returns its session key.
bridge.onOpen = async () => {
  await bridge.push(snapshot(105.875, [row("early")]));
  return { sessionKey: "early", transactionHash: seed(1) };
};
const early = await client.play("gadget", 5);
assert.deepEqual(bridge.opened[0], { wager: units(5), gameData: seed(1) });
assert.equal(early.outcome.kind, "grab");
assert.equal(early.outcome.payout, 10.875);
assert.equal(early.balance, 105.875);
assert.deepEqual(bridge.revealed, [], "settlement must not reveal before the animation completes");
client.commitReveal();
await flush();
assert.deepEqual(bridge.revealed, ["id-early"]);

// A later settle must match the returned key and can use raw.randomness.
bridge.onOpen = async () => ({ sessionKey: "late", transactionHash: seed(3) });
let settled = false;
const pending = client.play("gadget", 5).then(value => { settled = true; return value; });
await flush();
await bridge.push(snapshot(100.875, [row("unrelated"), row("late", { phase: 1, isSettled: false, raw: {} })]));
assert.equal(settled, false);
await bridge.push(snapshot(111.75, [row("late", { raw: { gameState: "0x", randomness: seed(2) } })]));
const late = await pending;
assert.equal(late.outcome.seedHex, seed(2));
assert.equal(late.balance, 111.75);
assert.equal(bridge.revealed.length, 1);
client.commitReveal();
await flush();
assert.deepEqual(bridge.revealed, ["id-early", "id-late"]);

// Token decimals and host payout are authoritative at the bridge boundary.
await bridge.push(snapshot(50, [], 7.9, 6));
assert.equal(client.maxBet(), 7);
bridge.onOpen = async () => {
  await bridge.push(snapshot(56, [row("six", { payout: units(11, 6) })], 7.9, 6));
  return { sessionKey: "six", transactionHash: seed(4) };
};
const originalWarn = console.warn;
const warnings: unknown[][] = [];
console.warn = (...args: unknown[]) => warnings.push(args);
try {
  const reported = await client.play("gadget", 5);
  assert.equal(bridge.opened.at(-1)?.wager, "5000000");
  assert.equal(reported.outcome.payout, 11);
  assert.equal(reported.outcome.kind, "grab");
  assert.equal(reported.balance, 56);
  assert.equal(warnings.length, 1, "a payout discrepancy should be reported");
} finally { console.warn = originalWarn; }

bridge.onOpen = async () => {
  await bridge.push(snapshot(56, [row("cancelled", { phase: 5, raw: {} })], 7.9, 6));
  return { sessionKey: "cancelled", transactionHash: seed(5) };
};
await assert.rejects(client.play("gadget", 5), /did not settle normally/);
assert.equal(bridge.revealed.length, 2, "a rejected round must not automatically reveal");
client.destroy();
assert.equal(bridge.disconnected, 1);
assert.equal(bridge.observerDisconnected, 1);
console.log("Host bridge checks passed: delayed balance, cap-only updates, early/late settlement, decimals, host payout, reveal timing and cleanup. No live transactions.");
