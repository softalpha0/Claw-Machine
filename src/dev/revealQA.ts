/** Development-only visual review. Vite does not include this page in the build. */
import "../style.css";
import { ClawMachine, type Beat } from "../game/machine.ts";
import { RewardDisplay } from "../game/rewardDisplay.ts";
import { resolve, type ResultKind } from "../game/outcome.ts";
import { preloadPrizeSprites } from "../game/prizeSprites.ts";
import type { ModeId } from "../game/config.ts";
import { sfx } from "../game/audio.ts";

if (import.meta.env.DEV) {
  document.body.innerHTML = `<main class="qa-layout"><header><h1>Reveal review</h1><p>Local presentation fixtures · no bets or balance changes</p></header><div class="qa-controls"><label>Machine<select id="qa-mode"><option value="plush">Plush</option><option value="gadget">Gadget</option><option value="vault">Jackpot</option></select></label><label>Result<select id="qa-result"><option value="grab">Win</option><option value="bonus">Double Grab</option><option value="slip">Slip</option><option value="whiff">Miss</option></select></label><label>Pause at<select id="qa-phase"><option value="none">No pause</option><option value="grab">Claw contact</option><option value="lift">First lift frame</option><option value="carry">Carry</option><option value="drop">Drop</option><option value="win">Win</option><option value="bonus">Double Grab win</option></select></label><button id="qa-play">Play reveal</button><button id="qa-pause">Pause</button><button id="qa-step">Advance one frame</button><button id="qa-banner">Show win plaque</button></div><div class="cabinet chrome"><div class="glass-bezel"><div class="stage-wrap"><canvas id="machine" aria-label="Claw reveal preview"></canvas></div></div></div><output id="qa-status" role="status">Ready</output><p><a href="/">Back to the game</a></p></main>`;
  const style = document.createElement("style");
  style.textContent = `html,body{overflow:auto;height:auto}.qa-layout{width:min(900px,calc(100% - 24px));margin:20px auto;font:14px system-ui}.qa-layout h1{font-size:24px;margin:0}.qa-layout p{color:#ddd3e0}.qa-controls{display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin:15px 0}.qa-controls label{display:flex;flex-direction:column;gap:5px}.qa-controls button,.qa-controls select{border-radius:6px;background:#ece8f1;color:#342238;border:1px solid #bbb;padding:8px;font:13px system-ui}.qa-controls button:disabled{opacity:.4}.qa-layout output{display:block;padding:12px;background:#221529;margin-top:10px}.qa-layout .cabinet{padding:15px}.qa-layout .stage-wrap{aspect-ratio:8/5}`;
  document.head.append(style);
  const byId = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;
  const mode = byId<HTMLSelectElement>("qa-mode"),
    result = byId<HTMLSelectElement>("qa-result"),
    pauseAt = byId<HTMLSelectElement>("qa-phase");
  const play = byId<HTMLButtonElement>("qa-play"),
    pause = byId<HTMLButtonElement>("qa-pause"),
    status = byId<HTMLOutputElement>("qa-status");
  // A visible review control owns this clock, isolated from the real game's clock.
  const realRAF = window.requestAnimationFrame.bind(window);
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0,
    virtualTime = performance.now(),
    previous = 0,
    paused = false,
    step = false,
    pauseAfterFrame = false;
  window.requestAnimationFrame = (callback) => {
    frames.set(++id, callback);
    return id;
  };
  window.cancelAnimationFrame = (key) => {
    frames.delete(key);
  };
  const pump = (now: number) => {
    const dt = Math.min(40, previous ? now - previous : 16);
    previous = now;
    if (!paused || step) {
      virtualTime += step ? 16.667 : dt;
      step = false;
      const batch = [...frames.values()];
      frames.clear();
      batch.forEach((callback) => callback(virtualTime));
      if (pauseAfterFrame) {
        paused = true;
        pauseAfterFrame = false;
        pause.textContent = "Resume";
      }
    }
    realRAF(pump);
  };
  realRAF(pump);
  const machine = new ClawMachine(byId<HTMLCanvasElement>("machine"), {
    watchdogMs: 180000,
  });
  const reward = new RewardDisplay(
    document.querySelector<HTMLElement>(".stage-wrap")!,
  );
  const fixtures: Record<ModeId, Record<ResultKind, number>> = {
    plush: { grab: 0, bonus: 3, slip: 61, whiff: 4 },
    gadget: { grab: 2, bonus: 3, slip: 0, whiff: 1 },
    vault: { grab: 6, bonus: 12, slip: 100, whiff: 0 },
  };
  const outcome = () =>
    resolve(
      "0x" +
        fixtures[mode.value as ModeId][result.value as ResultKind]
          .toString(16)
          .padStart(64, "0"),
      mode.value as ModeId,
      5,
    );
  mode.addEventListener("change", () => {
    machine.setMode(mode.value as ModeId);
    reward.clear();
    document.documentElement.dataset.mode = mode.value;
  });
  play.onclick = async () => {
    reward.clear();
    const o = outcome();
    play.disabled = true;
    mode.disabled = true;
    result.disabled = true;
    paused = false;
    pause.textContent = "Pause";
    sfx.unlock();
    machine.onBeat = (beat: Beat) => {
      status.value = `${beat} · pickup ${machine.pickupIndex} / ${machine.pickupTotal}`;
      if (["aim", "descend", "lift", "carry", "park", "whiff"].includes(beat))
        sfx.startMovement(
          beat as "aim" | "descend" | "lift" | "carry" | "park" | "whiff",
        );
      else sfx.stopMovement();
      if (beat === "grab") sfx.grab();
      if (beat === "win" || beat === "bonus") {
        reward.show(o);
        beat === "bonus" ? sfx.jackpot() : sfx.win(o.payoutX);
      }
      if (beat === pauseAt.value) {
        pauseAfterFrame = true;
        sfx.stopMovement();
      }
    };
    await machine.play(o);
    reward.show(o);
    play.disabled = false;
    mode.disabled = false;
    result.disabled = false;
  };
  pause.onclick = () => {
    paused = !paused;
    pause.textContent = paused ? "Resume" : "Pause";
    if (paused) sfx.stopMovement();
  };
  byId<HTMLButtonElement>("qa-step").onclick = () => {
    paused = true;
    step = true;
    pause.textContent = "Resume";
  };
  byId<HTMLButtonElement>("qa-banner").onclick = () => {
    reward.clear();
    reward.show(outcome());
  };
  await preloadPrizeSprites();
}
