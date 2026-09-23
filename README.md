# CLAW

A provably-fair **claw machine** — my entry for [Chain Jam Vol. 1](https://jam.chain.wtf/),
the game jam of [chain.wtf](https://chain.wtf/).

> **Live demo:** [claw-jam.netlify.app](https://claw-jam.netlify.app/) · **Math:** [`MATH.md`](./MATH.md)

Pick a machine, set your bet, drop the claw. A single VRF word decides the whole
round: **did the claw grip? → did it slip on the lift? → did it snag a second
prize?** Win and the toy lands on your shelf forever, stamped with the exact seed
that produced it.

<p align="center"><em>aim · descend · grip · lift · collect</em></p>

## Collector station

The redesigned cabinet puts full-body prizes inside the machine and a persistent
collection shelf beside it. Plush, Gadget and Jackpot each contain ten collectibles;
missing prizes appear as matching silhouettes. A double grab adds both prizes to
the collection. The desktop cabinet, controls and shelf fit together without page
scrolling, with a separate responsive arrangement on smaller screens.

This is a presentation and interaction update. The three modes keep their existing
outcome probabilities, multipliers and seed-based payout calculation. Selected
recordings provide the button, arm movement, grip and win sounds; the new audio
runtime has no background music bed. See [artwork provenance](./docs/collector-assets.md)
and [audio sources](./docs/audio-sources.md).

---

## Why it fits the jam

| Criterion | How CLAW answers it |
|---|---|
| **Collector identity** | Three themed machines with a shared collection shelf and full-body prizes. |
| **Instantly legible** | Visible prize chances of `63.4%`, `40.8%`, and `18.0%`, with the selected mode's maximum win beside the controls. |
| **Fun past hour ten** | Volatile long tail (a `13.58×` jackpot), a real near-miss beat, and a **30-piece collection shelf** to chase. |
| **Provably fair** | Every outcome derives from the platform's VRF word. No `Math.random`. Unbiased sampling. One-line player verification. |
| **RTP in band** | Every mode ≈ **95.5%** (house edge ≈ 4.5%), inside the 93–98% rule, proven by Monte-Carlo. |

## The three risk modes

| Mode | Initial grip | Prize chance | Clean multiplier | Max win | Feel |
|---|---|---|---|---|---|
| **Plush Pit** | 72% | 63.4% | 1.41× | 2.82× | friendly, low variance |
| **Gadget Grab** | 48% | 40.8% | 2.175× | 4.35× | trickier, chunkier payouts |
| **Jackpot Vault** | 22% | 18.0% | 4.526× | 13.58× | rarely holds, pays big |

The UI's prize chance is `grab × (1 − slip)`, rounded to one decimal place.
An initial grip can still slip before delivering a collectible.

The declared math in the contract's `quoteRiskParams` is the same paytable
`onRandomness` pays from — see [`MATH.md`](./MATH.md) for the closed form and the
Monte-Carlo proof.

## How a round resolves

The chain hands the game one `bytes32` VRF word. It is expanded with SHA-256 and
read as fixed-point uniforms:

```
word_i        = sha256( seed ++ uint32be(i) )
uniformWad(i) = uint64(first 8 bytes of word_i) * 1e18 >> 64        // [0, 1e18)
```

```
i=0  held?      uniformWad(0) >= grab[m]        → whiff  (payout 0)
i=1  slipped?   uniformWad(1) <  slip[m]        → slip   (payout 0.2× bet)
i=2  bonus?     uniformWad(2) <  bonusChance[m] → double grab (payout mult × bonusFactor × bet)
     otherwise                                  → clean grab  (payout mult × bet)
i=10 which prize (weighted; flavour only, never affects payout)
i=11 second distinct prize on a double grab (weighted cosmetic collection reward only)
```

Index 11 is used only by the frontend's `getWonPrizes()` helper. It excludes the
first prize from the same mode's pool, so both displayed prizes can be recorded
on the shelf. It does not change the contract, payout draws, or primary prize.

Every payout-affecting comparison is **WAD integer math on both sides** — the
Solidity `_uniformWad` / `_play` and the TypeScript `uniformWad` / `resolve`
produce bit-identical results, so the on-chain payout is always exactly the one
the game animates. SHA-256 (not keccak): a cheap EVM precompile, fast in pure JS,
and any player can re-check an outcome with a one-line hash.

## The three parts

| Part | File | Notes |
|---|---|---|
| **Contract** | [`contracts/ClawMachineV2.sol`](./contracts/ClawMachineV2.sol) | implements `ICasinoGameV2` (`SessionContext` / `StepResult`), `pragma ^0.8.30`. All six hooks; `onPlayerAction` reverts (single-shot game), `quoteForfeitPayout` returns 0. `previewPayout()` lets anyone verify an outcome off the money path. |
| **Frontend** | [`src/`](./src) | static, no wallet code. Talks to the host through `@chain/casino-sdk/guest`; standalone visits use a self-contained demo. A failed host connection never falls back to demo play. |
| **Manifest** | [`public/game.manifest.json`](./public/game.manifest.json) | the SDK's discovery schema. `gameId: "ClawGame"` → canonical id `claw`. Served at the site root with CORS open. |

The hosted page also carries the jam widget
(`<script async src="https://jam.chain.wtf/widget.js">` in `index.html`), required
by the submission check.

## Run it

The frontend SDK is included in `vendor/casino-sdk`; no developer-specific
Downloads path or separately installed SDK is needed for the standalone game.

```bash
npm install
npm run dev          # play at http://localhost:5173 (standalone demo mode)
npm test             # outcome, collection, machine, audio and mocked host checks
npm run montecarlo   # prove the RTP over millions of real seeds
npm run tune         # re-solve the multipliers for a target RTP
npm run build        # typecheck + production bundle into dist/
```

The regression runner is also available as `node scripts/checks/run.mjs`. Its
host checks use an in-memory SDK mock, with no wallet or real transactions.

The `predev` and `prebuild` hooks download two licensed Mixkit effects and verify
their SHA-256 hashes. The first run needs network access; matching local files are
reused. The files are excluded from Git. The two CC0 mechanical recordings are
already included. See [audio setup and licenses](./docs/audio-sources.md).

**Standalone / demo mode** is selected only outside an iframe, without a `host`
or `gameAddress` query parameter. It generates its own seed with
`crypto.getRandomValues` and keeps a play-money balance in `localStorage`, so the
jam gallery and judges can open the URL directly and play. Outcome math is
identical to on-chain — only the seed source and the balance differ.
An iframe or either host query parameter selects the real bridge. If that
connection fails, play stays disabled and the page shows a connection message;
it does not silently switch to demo mode.

## Develop against the local simulator

1. Get the SDK (`https://sdk.chain.wtf/sdk/casino-sdk.zip`), then in its root:
   `npm install && npm start` → harness at `http://localhost:3300`, chain at
   `:8545` (chUSD is **18 decimals** in the sim).
2. Copy [`contracts/ClawMachineV2.sol`](./contracts/ClawMachineV2.sol) into the
   SDK's `simulator/contracts/`. It hot-compiles, deploys and registers itself;
   the `../../solidity/ICasinoGameV2.sol` import resolves automatically.
3. Run `npm install` in this project. Its guest SDK resolves from
   `"@chain/casino-sdk": "file:vendor/casino-sdk"`; the separate download above
   supplies the simulator harness, not a required local dependency path.
4. `npm run dev`, then open
   `http://localhost:3300/?game=http://localhost:5173&gameAddress=0x<deployed>`.
5. Do a full round. The harness's settled payout must equal the on-screen payout,
   which equals `previewPayout(randomness, mode, wager)` on the contract, which
   equals `resolve(randomness, mode, bet)` in TypeScript.

When changing the host integration, verify the full `openSession →
WAITING_RANDOMNESS → VRF fulfil → settle → payout → reveal` flow in the simulator.
The local regression checks do not replace that integration check.

### Bridge flow (`src/casino/chainClient.ts`)

`connectGameToHost({ setState })` → `await connection.promise` for the `hostApi`
→ `openSession({ wager, gameData })` where `gameData = abi.encode(uint8 mode)` →
watch `snapshot.sessions.items` for the `sessionKey` going terminal → read the
VRF word from `raw.gameState` / `raw.randomness` → `resolve()` locally for the
kind + prize → animate → `revealOutcome({ sessionId })`.

## Tech

Vite + TypeScript, canvas rendering for the machine and collectible sprites,
responsive HTML/CSS controls, and WebAudio sample playback. Transparent sprite
atlases provide the same prize shapes in the cabinet and on the shelf.
`@noble/hashes` supplies SHA-256. The frontend uses the vendored Chain SDK guest
bridge and has no UI framework.
