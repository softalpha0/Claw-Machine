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

Everything chain-specific is isolated so the game core never imports the SDK.
Reconciled against **@chain/casino-sdk v0.2.0** (`src/guest.ts`, `src/types.ts`,
`solidity/ICasinoGameV2.sol`, `examples/coinflip-public/`).

| file | what it is | status |
|---|---|---|
| `src/casino/client.ts` | `CasinoClient` interface | final |
| `src/casino/mockClient.ts` | standalone demo client | final |
| `src/casino/chainClient.ts` | `@chain/casino-sdk/guest` bridge | wired to the real API; `any`-typed until the SDK is installed |
| `src/casino/chain-sdk.d.ts` | ambient shims | **delete after linking the SDK** to get real types |
| `contracts/ClawMachineV2.sol` | `ICasinoGameV2` impl (SessionContext / StepResult) | final; `_play` math is authoritative |
| `public/game.manifest.json` | discovery manifest (SDK schema) | final |
| `src/jam/widget.ts` | jam widget slot | paste the embed from jam.chain.wtf, flip `MOUNTED` |

### Wire it to the simulator

1. Unzip the SDK (`sdk.chain.wtf/sdk/casino-sdk.zip`), then in the SDK root:
   `npm install && npm start` → harness at `http://localhost:3300`, chain at `:8545`
   (chUSD is **18 decimals** in the sim).
2. Copy `contracts/ClawMachineV2.sol` into the SDK's `simulator/contracts/`.
   It hot-compiles, deploys and registers (`ClawGame` → canonical id `claw`).
   Copy `../../solidity/ICasinoGameV2.sol` is resolved automatically.
3. In ClawJam: `npm link @chain/casino-sdk` (or add it to `package.json`
   pointing at the unzipped path), then **delete the `external` line in
   `vite.config.ts`** and `src/casino/chain-sdk.d.ts`.
4. `npm run dev`, then open
   `http://localhost:3300/?game=http://localhost:5173&gameAddress=0x<deployed>`.
5. Verify one drop end-to-end — the harness's settled payout must equal the
   on-screen payout, which equals `previewPayout(randomness, mode, wager)` on
   the contract, which equals `resolve(randomness, mode, bet)` in TS.
6. Validate the manifest: `validateCasinoGameManifest(require('./public/game.manifest.json'))`
   from the SDK returns `{ ok: true }`.

The bridge flow (`chainClient.ts`): `connectGameToHost({ setState })` →
`await connection.promise` for `hostApi` → `openSession({ wager, gameData })`
where `gameData = abi.encode(uint8 mode)` → watch `snapshot.sessions.items` for
the `sessionKey` going terminal → read the VRF word from `raw.gameState` /
`raw.randomness` → `resolve()` locally for kind + prize → `revealOutcome({ sessionId })`.

## Randomness

The on-chain VRF word (`bytes32` handed to `onRandomness`) is the seed.
`uniformWad(i) = uint64(first 8 bytes of sha256(seed ++ uint32be(i))) * 1e18 >> 64`.
Every payout-affecting comparison is WAD BigInt on both sides, so the contract
and the guest preview never disagree. sha256 (not keccak): cheap EVM precompile,
fast in pure JS, one-line player verification. See [`MATH.md`](./MATH.md).

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
src/casino/            CasinoClient interface + mock (standalone) + chain (SDK bridge)
contracts/             ICasinoGameV2 implementation (SessionContext / StepResult)
public/game.manifest.json  SDK discovery manifest
scripts/               montecarlo.ts, tune.ts
```

## Credits

Code and assets built with AI tooling. All art is hand-authored vector drawn on
`<canvas>` and all sound is synthesised — no generated bitmaps, no audio files.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
