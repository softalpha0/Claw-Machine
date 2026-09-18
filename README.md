# CLAW

A provably-fair **claw machine** — my entry for [Chain Jam Vol. 1](https://jam.chain.wtf/),
the game jam of [chain.wtf](https://chain.wtf/).

> **Live demo:** _add your hosted URL here_ · **Math:** [`MATH.md`](./MATH.md)

Pick a machine, set your bet, drop the claw. A single VRF word decides the whole
round: **did the claw grip? → did it slip on the lift? → did it snag a second
prize?** Win and the toy lands on your shelf forever, stamped with the exact seed
that produced it.

<p align="center"><em>aim · descend · clunk · the tense lift · the near-miss · the coin fountain</em></p>

---

## Why it fits the jam

| Criterion | How CLAW answers it |
|---|---|
| **Novel** | A claw machine, not a dice / plinko / limbo / crash reskin. No prior on-chain original like it. |
| **Instantly legible** | Three buttons: `72% grab · up to 2.8×`, `48% · 4.3×`, `22% · 13.6×`. No manual, no tutorial. |
| **Fun past hour ten** | Volatile long tail (a `13.58×` jackpot), a real near-miss beat, and a **30-piece collection shelf** to chase. |
| **Provably fair** | Every outcome derives from the platform's VRF word. No `Math.random`. Unbiased sampling. One-line player verification. |
| **RTP in band** | Every mode ≈ **95.5%** (house edge ≈ 4.5%), inside the 93–98% rule, proven by Monte-Carlo. |

## The three risk modes

| Mode | Grab chance | Clean multiplier | Max win | Feel |
|---|---|---|---|---|
| **Plush Pit** | 72% | 1.41× | 2.82× | friendly, low variance |
| **Gadget Grab** | 48% | 2.175× | 4.35× | trickier, chunkier payouts |
| **Jackpot Vault** | 22% | 4.526× | 13.58× | rarely holds, pays big |

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
```

Every payout-affecting comparison is **WAD integer math on both sides** — the
Solidity `_uniformWad` / `_play` and the TypeScript `uniformWad` / `resolve`
produce bit-identical results, so the on-chain payout is always exactly the one
the game animates. SHA-256 (not keccak): a cheap EVM precompile, fast in pure JS,
and any player can re-check an outcome with a one-line hash.

## The three parts

| Part | File | Notes |
|---|---|---|
| **Contract** | [`contracts/ClawMachineV2.sol`](./contracts/ClawMachineV2.sol) | implements `ICasinoGameV2` (`SessionContext` / `StepResult`), `pragma ^0.8.30`. All six hooks; `onPlayerAction` reverts (single-shot game), `quoteForfeitPayout` returns 0. `previewPayout()` lets anyone verify an outcome off the money path. |
| **Frontend** | [`src/`](./src) | static, no wallet code. Talks to the host only through `@chain/casino-sdk/guest`. Falls back to a self-contained demo when there is no host. |
| **Manifest** | [`public/game.manifest.json`](./public/game.manifest.json) | the SDK's discovery schema. `gameId: "ClawGame"` → canonical id `claw`. Served at the site root with CORS open. |

The hosted page also carries the jam widget
(`<script async src="https://jam.chain.wtf/widget.js">` in `index.html`), required
by the submission check.

## Run it

```bash
npm install
npm run dev          # play at http://localhost:5173 (standalone demo mode)
npm run montecarlo   # prove the RTP over millions of real seeds
npm run tune         # re-solve the multipliers for a target RTP
npm run build        # typecheck + production bundle into dist/
```

**Standalone / demo mode** kicks in automatically when the page is opened outside
the chain.wtf iframe (no SDK bridge present): it generates its own seed with
`crypto.getRandomValues` and keeps a play-money balance in `localStorage`, so the
jam gallery and judges can open the URL directly and play. Outcome math is
identical to on-chain — only the seed source and the balance differ.

## Develop against the local simulator

1. Get the SDK (`https://sdk.chain.wtf/sdk/casino-sdk.zip`), then in its root:
   `npm install && npm start` → harness at `http://localhost:3300`, chain at
   `:8545` (chUSD is **18 decimals** in the sim).
2. Copy [`contracts/ClawMachineV2.sol`](./contracts/ClawMachineV2.sol) into the
   SDK's `simulator/contracts/`. It hot-compiles, deploys and registers itself;
   the `../../solidity/ICasinoGameV2.sol` import resolves automatically.
3. Point this project at the SDK — `package.json` already has
   `"@chain/casino-sdk": "file:../../Downloads/casino-sdk/casino-sdk"`; adjust the
   path to wherever you unzipped it and re-run `npm install`.
4. `npm run dev`, then open
   `http://localhost:3300/?game=http://localhost:5173&gameAddress=0x<deployed>`.
5. Do a full round. The harness's settled payout must equal the on-screen payout,
   which equals `previewPayout(randomness, mode, wager)` on the contract, which
   equals `resolve(randomness, mode, bet)` in TypeScript.

**Status:** the full `openSession → WAITING_RANDOMNESS → VRF fulfil → settle →
payout → reveal` flow runs end-to-end in the simulator against the deployed
contract.

### Bridge flow (`src/casino/chainClient.ts`)

`connectGameToHost({ setState })` → `await connection.promise` for the `hostApi`
→ `openSession({ wager, gameData })` where `gameData = abi.encode(uint8 mode)` →
watch `snapshot.sessions.items` for the `sessionKey` going terminal → read the
VRF word from `raw.gameState` / `raw.randomness` → `resolve()` locally for the
kind + prize → animate → `revealOutcome({ sessionId })`.

## Project layout

```
contracts/ClawMachineV2.sol   ICasinoGameV2 implementation (the paytable lives here + in outcome.ts)
public/game.manifest.json     SDK discovery manifest + jam widget served from index.html
scripts/montecarlo.ts         RTP proof — millions of real seeds vs the closed form
scripts/tune.ts               solve multipliers for a target RTP

src/game/config.ts            single source of truth for every number
src/game/rng.ts               VRF word -> unbiased WAD uniforms (sha256 expansion)
src/game/outcome.ts           resolve(seed, mode, bet) -> Outcome   (game + montecarlo + contract mirror)
src/game/prizes.ts            the 30-prize catalogue
src/game/machine.ts           canvas rendering + the reveal timeline + idle attract mode
src/game/prizeArt.ts          hand-authored vector glyphs
src/game/audio.ts             synthesised SFX (WebAudio) + the master bus / reverb / compressor
src/game/music.ts             looping background track, wired to the same mute toggle
src/game/collection.ts        the prize shelf (localStorage, seed-stamped)
src/casino/client.ts          CasinoClient interface
src/casino/mockClient.ts      standalone demo client
src/casino/chainClient.ts     @chain/casino-sdk/guest bridge
src/jam/widget.ts             footer credit (the required script tag is in index.html)
src/main.ts                   HUD + orchestration
public/audio/arcade-loop.mp3        background music (a real recorded loop)
public/images/cabinet-backdrop.jpg  AI-generated cabinet backdrop, drawn behind the pile
```

## Tech

Vite + TypeScript, a single `<canvas>` for the machine, WebAudio for every sound
effect (a compressor + a synthesised room reverb glue them together), plus one
real looping background track and one AI-generated backdrop image behind the
pile. `@noble/hashes` for SHA-256. No framework — the production bundle
(excluding the two media assets) is ~17 KB gzipped and loads instantly; the
track and backdrop stream in afterward.

## Credits

Built with AI tooling (allowed and encouraged by the jam).

- **UI chrome, icons, font** — [Kenney](https://kenney.nl) *UI Pack: Sci-Fi* and *Game Icons* (CC0), 9-sliced with CSS `border-image`. Licenses are kept beside the files in `src/assets/`.
- **Sound effects** — Kenney *Casino Audio*, *Interface Sounds*, *Impact Sounds* (CC0), layered over synthesised voices (`public/audio/sfx/`).
- **Backdrops, mode art, prize photos** — AI-generated via Pollinations.ai (`public/images/`).
- **Music loop** — `public/audio/arcade-loop.mp3`.
- **Cabinet, claw, prize fallbacks** — vector art drawn on `<canvas>`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
