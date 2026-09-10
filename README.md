# CLAW

A provably-fair **claw machine** for [Chain Jam Vol. 1](https://jam.chain.wtf/).

Pick a machine (risk mode), set your bet, drop the claw. One VRF seed decides
everything: *did it grip?* → *did it slip on the lift?* → *double grab?*. Grab a
prize and it goes on your shelf forever, stamped with the seed that produced it.

- **Novel** — a claw machine, not a dice/plinko/crash reskin.
- **Instantly legible** — three buttons say `72% grab · up to 2.8×`, `48% · 4.4×`,
  `22% · 13.6×`. No manual.
- **One seed → one juicy reveal** — aim, descend, clunk, the tense lift, the
  near-miss, the coin fountain.
- **Chase layer** — 30 collectibles, 10 per mode, rarity-tiered, seed-stamped.
- **93–98 % RTP** — every mode ~95.5 %, proven by Monte-Carlo.

## Run it

```bash
npm install
npm run dev          # standalone demo at http://localhost:5173
npm run montecarlo   # prove the RTP (millions of real seeds)
npm run tune         # re-solve multipliers for a target RTP
npm run build        # typecheck + production bundle
```

The standalone demo uses a mock VRF (`crypto.getRandomValues`) and a play-money
balance in `localStorage`, so it is fully playable outside the chain.wtf iframe —
a jam requirement.

## Wiring to the Chain SDK

Everything chain-specific is isolated so the game core never imports the SDK:

| file | what it is | what to do |
|---|---|---|
| `src/casino/client.ts` | `CasinoClient` interface | nothing — the contract both clients honour |
| `src/casino/mockClient.ts` | standalone demo client | nothing |
| `src/casino/chainClient.ts` | `@chain/casino-sdk` bridge adapter | **reconcile method/payload names** with `examples/coinflip-public/` |
| `contracts/ClawMachineV2.sol` | `ICasinoGameV2` implementation | **reconcile the interface**; the `_payoutWad` math is final |
| `game.manifest.json` | discovery + math + presentation | match field names to the coinflip manifest |
| `src/jam/widget.ts` | jam widget slot | paste the embed from jam.chain.wtf, flip `MOUNTED` |

Steps:

1. `npx @chain/casino-sdk` (or `git clone` the SDK) and **fork the coinflip example**.
2. Drop `contracts/ClawMachineV2.sol` into `simulator/contracts/` — it hot-compiles.
3. Point this dev server at the harness: `http://localhost:3300/?game=http://localhost:5173&gameAddress=0x…`
4. Open `examples/coinflip-public/` and align: `connectGameToHost`,
   `hostApi.openSession`, `revealOutcome`, the manifest schema, the
   `ICasinoGameV2` struct names.
5. Verify one drop end-to-end: the harness payout must equal the on-screen
   payout, which equals `previewPayout(seed, mode, wager)` on the contract,
   which equals `resolve(seed, mode, bet)` in TS.

## Randomness

`sha256(seed ++ uint32be(index))`, first 8 bytes as a uint64, divided by 2^64.
Chosen over keccak because it is a cheap EVM precompile, fast in pure JS, and any
player can verify an outcome with a one-line `sha256`. Integer ranges use
rejection sampling — never `% n` on a raw word. See [`MATH.md`](./MATH.md).

## Layout

```
src/game/config.ts     single source of truth for all math
src/game/rng.ts        seed -> unbiased uniforms
src/game/outcome.ts    resolve(seed, mode, bet) -> Outcome   (shared by game + montecarlo + contract mirror)
src/game/prizes.ts     the 30-prize catalogue
src/game/machine.ts    canvas render + the reveal timeline
src/game/audio.ts      synthesised SFX (no audio files)
src/game/collection.ts the prize shelf (localStorage)
src/main.ts            HUD + orchestration
contracts/             ICasinoGameV2 implementation
scripts/               montecarlo.ts, tune.ts
```

## Credits

Code and assets built with AI tooling. All art is hand-authored vector drawn on
`<canvas>` and all sound is synthesised — no generated bitmaps, no audio files.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
