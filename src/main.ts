import "./style.css";

import {
  MODES, MODE_ORDER, DEFAULT_MODE, BET_STEPS, DEFAULT_BET,
  theoreticalRtp, maxWinX, type ModeId,
} from "./game/config.ts";
import { PRIZES, RARITY_COLOR } from "./game/prizes.ts";
import { drawPrize } from "./game/prizeArt.ts";
import { explain, type Outcome } from "./game/outcome.ts";
import { ClawMachine, type Beat } from "./game/machine.ts";
import { Collection } from "./game/collection.ts";
import { sfx } from "./game/audio.ts";
import { mountJamWidget } from "./jam/widget.ts";
import type { CasinoClient } from "./casino/client.ts";
import { MockClient } from "./casino/mockClient.ts";

// ---- element helpers ---------------------------------------------------
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};
const fmt = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: n % 1 ? 2 : 0 });

// ---- state -----------------------------------------------------------
let mode: ModeId = DEFAULT_MODE;
let bet = DEFAULT_BET;
let rolling = false;

const collection = new Collection();

// ---- client pick ---------------------------------------------------
async function pickClient(): Promise<CasinoClient> {
  const params = new URLSearchParams(location.search);
  const wantsChain = params.has("host") || params.has("gameAddress") || window.parent !== window;
  if (wantsChain) {
    try {
      const { ChainSdkClient } = await import("./casino/chainClient.ts");
      const c = new ChainSdkClient();
      await c.ready();
      return c;
    } catch (err) {
      console.warn("[claw] chain client unavailable, falling back to standalone demo", err);
    }
  }
  return new MockClient();
}

// ---- boot ----------------------------------------------------------
const machine = new ClawMachine($<HTMLCanvasElement>("machine"));
mountJamWidget($("jamWidget"));
buildModes();
buildBetChips();
renderShelf();
updateOdds();

let client: CasinoClient = new MockClient();
pickClient().then((c) => {
  client = c;
  client.onBalanceChange(renderBalance);
  bet = Math.min(bet, client.maxBet());
  renderBalance(client.getBalance());
  renderBet();
});

// ---- modes UI ----------------------------------------------------
function buildModes(): void {
  const host = $("modes");
  host.innerHTML = "";
  for (const id of MODE_ORDER) {
    const m = MODES[id];
    const btn = document.createElement("button");
    btn.className = "mode";
    btn.role = "tab";
    btn.style.setProperty("--m-accent", m.accent);
    btn.setAttribute("aria-selected", String(id === mode));
    btn.innerHTML =
      `<div class="m-name">${m.label}</div>` +
      `<div class="m-odds">${Math.round(m.grab * 100)}% grab · up to ${maxWinX(m).toFixed(1)}×</div>`;
    btn.addEventListener("click", () => {
      if (rolling) return;
      mode = id;
      sfx.unlock();
      sfx.toggle();
      machine.setMode(id);
      [...host.children].forEach((c, i) =>
        c.setAttribute("aria-selected", String(MODE_ORDER[i] === id)),
      );
      applyAccent(m.accent);
      updateOdds();
    });
    host.appendChild(btn);
  }
  applyAccent(MODES[mode].accent);
}

function applyAccent(hex: string): void {
  document.documentElement.style.setProperty("--accent", hex);
}

// ---- bet UI ----------------------------------------------------
function buildBetChips(): void {
  const host = $("betChips");
  host.innerHTML = "";
  for (const v of BET_STEPS) {
    const b = document.createElement("button");
    b.textContent = String(v);
    b.addEventListener("click", () => {
      if (rolling) return;
      bet = v;
      sfx.unlock();
      sfx.click();
      renderBet();
    });
    host.appendChild(b);
  }
}
function renderBet(): void {
  $("bet").textContent = String(bet);
  [...$("betChips").children].forEach((c, i) =>
    c.classList.toggle("active", BET_STEPS[i] === bet),
  );
  updateOdds();
}
function stepBet(dir: 1 | -1): void {
  if (rolling) return;
  const i = BET_STEPS.findIndex((v) => v === bet);
  const cur = i >= 0 ? i : BET_STEPS.findIndex((v) => v >= bet);
  const next = Math.max(0, Math.min(BET_STEPS.length - 1, (cur < 0 ? 0 : cur) + dir));
  bet = BET_STEPS[next]!;
  sfx.unlock();
  sfx.click();
  renderBet();
}
$("betUp").addEventListener("click", () => stepBet(1));
$("betDown").addEventListener("click", () => stepBet(-1));

function updateOdds(): void {
  const m = MODES[mode];
  const rtp = (theoreticalRtp(m) * 100).toFixed(2);
  $("odds").innerHTML =
    `<b>${m.label}</b> — ${m.blurb}<br/>` +
    `grab <b>${(m.grab * 100).toFixed(0)}%</b> · ` +
    `clean pay <b>${m.mult}×</b> (${fmt(bet * m.mult)}) · ` +
    `bonus <b>${m.bonusFactor}×</b> that · ` +
    `slip back <b>${m.consolation}×</b><br/>` +
    `max win <b>${maxWinX(m).toFixed(2)}×</b> = ${fmt(bet * maxWinX(m))} chUSD · theoretical RTP <b>${rtp}%</b>`;
}

// ---- balance -------------------------------------------------
function renderBalance(v: number): void {
  $("balance").textContent = fmt(v);
  const canRefill = client.kind === "mock" && v < (client.minBet?.() ?? 1);
  const rf = $<HTMLButtonElement>("refill");
  rf.hidden = !canRefill;
  updateDropEnabled();
}
$("refill").addEventListener("click", () => {
  if (client instanceof MockClient) {
    client.refill();
    flash("demo wallet refilled");
  }
});

function updateDropEnabled(): void {
  const btn = $<HTMLButtonElement>("drop");
  btn.disabled = rolling || client.getBalance() < bet;
}

// ---- the drop ----------------------------------------------
$("drop").addEventListener("click", onDrop);

async function onDrop(): Promise<void> {
  if (rolling) return;
  sfx.unlock();
  if (client.getBalance() < bet) {
    flash("not enough chUSD");
    return;
  }
  rolling = true;
  updateDropEnabled();
  setMessage("asking the chain for a seed…", "");
  sfx.gantry();

  let result;
  try {
    result = await client.play(mode, bet);
  } catch (err) {
    console.error(err);
    setMessage("drop failed — try again", "miss");
    rolling = false;
    updateDropEnabled();
    return;
  }

  const o = result.outcome;
  machine.onBeat = (b: Beat) => onBeat(b, o);
  await machine.play(o);

  client.commitReveal();
  finishReveal(o);
  rolling = false;
  updateDropEnabled();
  renderBalance(client.getBalance());
}

function onBeat(b: Beat, o: Outcome): void {
  switch (b) {
    case "descend": sfx.descend(); setMessage("dropping the claw…", ""); break;
    case "grab": sfx.grab(); setMessage("closing the grip…", ""); break;
    case "lift": sfx.lift(); setMessage("and… lift!", ""); break;
    case "carry":
      setMessage("carrying it to the chute…", "");
      break;
    case "whiff":
      sfx.whiff();
      setMessage("the claw came up empty", "miss");
      break;
    case "slip":
      sfx.slip();
      setMessage("SO CLOSE — it slipped out", "miss");
      break;
    case "win":
      sfx.win(o.payoutX);
      setMessage(`grabbed it! +${fmt(o.payout)} chUSD  (${o.payoutX}×)`, "win");
      break;
    case "bonus":
      sfx.jackpot();
      setMessage(`DOUBLE GRAB!! +${fmt(o.payout)} chUSD  (${o.payoutX}×)`, "big");
      break;
  }
}

function finishReveal(o: Outcome): void {
  if (o.kind === "slip") {
    setMessage(`slipped — ${fmt(o.payout)} chUSD back (${o.payoutX}×)`, "miss");
  }
  if (o.prizeKey && (o.kind === "grab" || o.kind === "bonus")) {
    const isNew = collection.record(o.prizeKey, o.seedHex);
    renderShelf(isNew ? o.prizeKey : undefined);
    if (isNew) {
      const p = PRIZES.find((x) => x.key === o.prizeKey);
      sfx.newPrize();
      flash(`NEW PRIZE — ${p?.name ?? o.prizeKey} (${p?.rarity})`);
    }
  }
  renderVerify(o);
}

// ---- messages / toast --------------------------------------
let msgTimer = 0;
function setMessage(text: string, cls: "" | "win" | "big" | "miss"): void {
  const el = $("message");
  el.textContent = text;
  el.className = `message ${cls}`.trim();
  window.clearTimeout(msgTimer);
  if (cls) {
    msgTimer = window.setTimeout(() => {
      if (!rolling) {
        el.textContent = "pick a machine and drop the claw";
        el.className = "message";
      }
    }, 4200);
  }
}
let toastTimer = 0;
function flash(text: string): void {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add("show"));
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    t.classList.remove("show");
    window.setTimeout(() => (t.hidden = true), 300);
  }, 2600);
}

// ---- verify panel ----------------------------------------
function renderVerify(o: Outcome): void {
  const body = $("verifyBody");
  body.innerHTML =
    `<b>seed</b>  ${o.seedHex}\n` +
    `<b>derivation</b>  u_i = sha256(seed ++ uint32be(i)) → first 8 bytes / 2^64\n\n` +
    explain(o)
      .split("\n")
      .map((l) => l.replace(/^(\w+)/, "<b>$1</b>"))
      .join("\n") +
    `\n\n<b>independent check</b>: hash the seed above with the indices and compare.`;
}

// ---- prize shelf ---------------------------------------
function renderShelf(highlightKey?: string): void {
  const grid = $("shelfGrid");
  grid.innerHTML = "";
  for (const { prize, caught, entry } of collection.list()) {
    const slot = document.createElement("div");
    slot.className = `slot ${caught ? "" : "locked"} ${highlightKey === prize.key ? "new" : ""}`.trim();
    slot.title = caught
      ? `${prize.name} — ${prize.rarity} — grabbed ${entry?.count}×`
      : `??? — ${prize.rarity} — not grabbed yet`;

    const rarity = document.createElement("div");
    rarity.className = "rarity";
    rarity.style.background = RARITY_COLOR[prize.rarity];
    slot.appendChild(rarity);

    const cv = document.createElement("canvas");
    cv.width = 96;
    cv.height = 96;
    const cx = cv.getContext("2d")!;
    drawPrize(cx, prize, 48, 50, 74);
    slot.appendChild(cv);

    if (caught && entry && entry.count > 1) {
      const c = document.createElement("span");
      c.className = "count";
      c.textContent = `×${entry.count}`;
      slot.appendChild(c);
    }
    grid.appendChild(slot);
  }
  const done = collection.caughtCount();
  $("shelfCount").textContent = `${done} / ${collection.total()}`;
  $<HTMLDivElement>("shelfBar").style.width = `${(done / collection.total()) * 100}%`;
}
$("shelfReset").addEventListener("click", () => {
  if (confirm("Clear your prize shelf? This can't be undone.")) {
    collection.reset();
    renderShelf();
    flash("prize shelf cleared");
  }
});

// keyboard: space / enter to drop
window.addEventListener("keydown", (e) => {
  if ((e.code === "Space" || e.code === "Enter") && document.activeElement?.tagName !== "BUTTON") {
    e.preventDefault();
    void onDrop();
  }
});

renderBalance(client.getBalance());
renderBet();
