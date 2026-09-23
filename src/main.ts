import "./style.css";
import {
  MODES,
  MODE_ORDER,
  DEFAULT_MODE,
  BET_STEPS,
  DEFAULT_BET,
  theoreticalRtp,
  maxWinX,
  type ModeId,
} from "./game/config.ts";
import { type Prize } from "./game/prizes.ts";
import { drawPrizeSprite, preloadPrizeSprites } from "./game/prizeSprites.ts";
import { explain, getWonPrizes, type Outcome } from "./game/outcome.ts";
import { ClawMachine, type Beat } from "./game/machine.ts";
import { Collection } from "./game/collection.ts";
import { sfx } from "./game/audio.ts";
import { ICON, type IconName } from "./game/uiIcons.ts";
import { mountJamWidget } from "./jam/widget.ts";
import type { CasinoClient } from "./casino/client.ts";
import { MockClient } from "./casino/mockClient.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};
const money = (n: number) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const labels: Record<ModeId, string> = {
  plush: "PLUSH",
  gadget: "GADGET",
  vault: "JACKPOT",
};
const modeIcons: Record<ModeId, string> = {
  plush:
    '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 11C0 9 4 1 10 6c4-2 8-2 12 0 6-5 10 3 2 5 6 17-22 17-16 0Z"/><circle cx="12" cy="14" r="1.5" class="eye"/><circle cx="20" cy="14" r="1.5" class="eye"/><path d="m14 19 2 2 2-2" class="eye-stroke"/></svg>',
  gadget:
    '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9 8h14c5 0 8 16 4 17-3 1-5-5-7-5h-8c-2 0-4 6-7 5C1 24 4 8 9 8Z"/><path d="M10 11v7m-3-3.5h6" class="eye-stroke"/><circle cx="22" cy="12" r="1.3" class="eye"/><circle cx="25" cy="16" r="1.3" class="eye"/></svg>',
  vault:
    '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 7h22l3 8-14 14L2 15Z"/><path d="m5 7 8 8 3 14 3-14 8-8M2 15h28M13 15l3-8 3 8" class="eye-stroke"/></svg>',
};
let mode: ModeId = DEFAULT_MODE,
  shelfMode: ModeId = DEFAULT_MODE;
let bet: number = DEFAULT_BET,
  rolling = false,
  clientReady = false;
let client: CasinoClient = new MockClient();
const collection = new Collection();
const machine = new ClawMachine($<HTMLCanvasElement>("machine"));
void document.fonts?.load('700 28px "Kenney Future"');
document
  .querySelectorAll<HTMLImageElement>("img[data-icon]")
  .forEach((img) => (img.src = ICON[img.dataset.icon as IconName]));
mountJamWidget($("jamWidget"));

function buildTabs(): void {
  for (const id of MODE_ORDER) {
    const button = document.createElement("button");
    button.className = "mode";
    button.dataset.mode = id;
    button.role = "tab";
    button.innerHTML = `${modeIcons[id]}<span>${labels[id]}</span>`;
    button.addEventListener("click", () => {
      if (rolling) return;
      sfx.unlock();
      sfx.click();
      mode = id;
      shelfMode = id;
      document.documentElement.dataset.mode = id;
      machine.setMode(id);
      renderTabs();
      renderShelf();
      updateOdds();
      setMessage("Choose your bet. Drop the claw.");
    });
    $("modes").append(button);
    const tab = document.createElement("button");
    tab.className = "shelf-tab";
    tab.dataset.mode = id;
    tab.role = "tab";
    tab.addEventListener("click", () => {
      sfx.unlock();
      sfx.click();
      shelfMode = id;
      renderTabs();
      renderShelf();
    });
    $("shelfTabs").append(tab);
  }
  [$("modes"), $("shelfTabs")].forEach((host) =>
    host.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
      const current = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      if (current < 0) return;
      e.preventDefault();
      const next =
        buttons[
          (current + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) %
            buttons.length
        ]!;
      if (!next.disabled) {
        next.focus();
        next.click();
      }
    }),
  );
  renderTabs();
}
function renderTabs(): void {
  for (const button of $("modes").querySelectorAll<HTMLButtonElement>(
    "button",
  )) {
    const selected = button.dataset.mode === mode;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    button.disabled = rolling;
  }
  for (const tab of $("shelfTabs").querySelectorAll<HTMLButtonElement>(
    "button",
  )) {
    const id = tab.dataset.mode as ModeId;
    const count = collection
      .list()
      .filter((x) => x.prize.mode === id && x.caught).length;
    tab.innerHTML = `<span>${labels[id]}</span><strong>${count}<small> / 10</small></strong>`;
    tab.setAttribute("aria-label", `${labels[id]} collection, ${count} of 10`);
    tab.setAttribute("aria-selected", String(id === shelfMode));
    tab.tabIndex = id === shelfMode ? 0 : -1;
  }
}
function allowedBets(): number[] {
  return BET_STEPS.filter((v) => v >= client.minBet() && v <= client.maxBet());
}
function buildBets(): void {
  $("betChips").replaceChildren();
  for (const value of allowedBets()) {
    const button = document.createElement("button");
    button.textContent = String(value);
    button.setAttribute("aria-label", `Bet ${value} chUSD`);
    button.addEventListener("click", () => {
      if (rolling) return;
      bet = value;
      sfx.unlock();
      sfx.click();
      closeBetMenu();
      renderBet();
    });
    $("betChips").append(button);
  }
}
function renderBet(): void {
  $("bet").textContent = money(bet);
  const options = allowedBets();
  $<HTMLButtonElement>("betDown").disabled =
    rolling || !options.some((v) => v < bet);
  $<HTMLButtonElement>("betUp").disabled =
    rolling || !options.some((v) => v > bet);
  $<HTMLButtonElement>("betAmount").disabled = rolling;
  $("betChips")
    .querySelectorAll("button")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(Number(button.textContent) === bet),
      ),
    );
  updateDropEnabled();
}
function stepBet(direction: number): void {
  if (rolling) return;
  const options = allowedBets();
  const next =
    direction > 0
      ? options.find((v) => v > bet)
      : [...options].reverse().find((v) => v < bet);
  if (next === undefined) return;
  bet = next;
  sfx.unlock();
  sfx.click();
  renderBet();
}
$("betDown").addEventListener("click", () => stepBet(-1));
$("betUp").addEventListener("click", () => stepBet(1));
function closeBetMenu(): void {
  $("betChips").hidden = true;
  $("betAmount").setAttribute("aria-expanded", "false");
}
$("betAmount").addEventListener("click", () => {
  if (rolling) return;
  const menu = $("betChips");
  menu.hidden = !menu.hidden;
  $("betAmount").setAttribute("aria-expanded", String(!menu.hidden));
  if (!menu.hidden) menu.querySelector("button")?.focus();
});
document.addEventListener("click", (e) => {
  if (!(e.target as Element).closest(".betblock")) closeBetMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeBetMenu();
});
function updateOdds(): void {
  const m = MODES[mode];
  $("odds").innerHTML =
    `<div class="stat"><span class="control-label">PRIZE CHANCE</span><strong>${(m.grab * (1 - m.slip) * 100).toFixed(1)}<small>%</small></strong></div><div class="stat"><span class="control-label">MAX WIN</span><strong>${maxWinX(m).toFixed(2)}<small>×</small></strong></div>`;
  $("bonusMultiplier").textContent = `${m.bonusFactor}× payout`;
}
function renderBalance(value: number): void {
  $("balance").textContent = money(value);
  $("balanceLabel").textContent =
    client.kind === "mock" ? "DEMO BALANCE" : "BALANCE";
  $("refill").hidden = client.kind !== "mock" || value >= client.minBet();
  updateDropEnabled();
}
function updateDropEnabled(): void {
  $<HTMLButtonElement>("drop").disabled =
    !clientReady ||
    rolling ||
    bet < client.minBet() ||
    bet > client.maxBet() ||
    client.getBalance() < bet;
  $("drop").querySelector("span")!.textContent = rolling
    ? "CLAW IN MOTION"
    : "DROP THE CLAW";
}
$("refill").addEventListener("click", () => {
  if (!rolling && client instanceof MockClient) {
    client.refill();
    setMessage("Demo balance refilled. Ready to play.");
  }
});
function setMessage(text: string, kind = ""): void {
  $("message").textContent = text;
  $("message").className = `message ${kind}`;
}

async function onDrop(): Promise<void> {
  if (
    !clientReady ||
    rolling ||
    client.getBalance() < bet ||
    bet < client.minBet() ||
    bet > client.maxBet()
  )
    return;
  rolling = true;
  closeBetMenu();
  renderBet();
  renderTabs();
  sfx.unlock();
  sfx.click();
  $("bonusSign").classList.remove("won");
  setMessage(
    client.kind === "chain" ? "Waiting for your round…" : "The claw is ready…",
  );
  let result: Awaited<ReturnType<CasinoClient["play"]>>;
  try {
    result = await client.play(mode, bet);
  } catch (error) {
    console.error(error);
    rolling = false;
    sfx.stopMovement();
    renderBet();
    renderTabs();
    renderBalance(client.getBalance());
    setMessage("The round could not start. Please try again.", "miss");
    return;
  }
  const outcome = result.outcome;
  machine.onBeat = (beat) => onBeat(beat, outcome);
  try {
    await machine.play(outcome);
  } catch (error) {
    console.error("Reveal failed", error);
  } finally {
    sfx.stopMovement();
    client.commitReveal();
    finishReveal(outcome);
    rolling = false;
    buildBets();
    renderBet();
    renderTabs();
    renderBalance(client.getBalance());
  }
}
function onBeat(beat: Beat, o: Outcome): void {
  switch (beat as string) {
    case "aim":
      sfx.startMovement();
      setMessage("Lining up the claw…");
      break;
    case "descend":
      sfx.startMovement();
      setMessage("Going in…");
      break;
    case "grab":
      sfx.stopMovement();
      sfx.grab();
      setMessage("Got a grip?");
      break;
    case "lift":
      sfx.startMovement();
      setMessage("Hold on…");
      break;
    case "carry":
      sfx.startMovement();
      setMessage("Bringing your prize home…");
      break;
    case "drop":
      sfx.stopMovement();
      break;
    case "park":
      sfx.startMovement(0.55);
      break;
    case "settle":
      sfx.stopMovement();
      break;
    case "whiff":
      sfx.startMovement(0.55);
      setMessage("Empty claw. Another prize is waiting.", "miss");
      break;
    case "slip":
      sfx.stopMovement();
      setMessage(`So close. ${money(o.payout)} chUSD returned.`, "miss");
      break;
    case "win":
      sfx.stopMovement();
      sfx.win(o.payoutX);
      setMessage(
        `Prize secured · ${money(o.payout)} chUSD · ${o.payoutX}×`,
        "win",
      );
      break;
    case "bonus":
      sfx.stopMovement();
      sfx.jackpot();
      $("bonusSign").classList.add("won");
      setMessage(
        `Double Grab · ${money(o.payout)} chUSD · ${o.payoutX}×`,
        "win",
      );
      break;
  }
}
function finishReveal(o: Outcome): void {
  const prizes = getWonPrizes(o),
    fresh: string[] = [];
  for (const prize of prizes)
    if (collection.record(prize.key, o.seedHex)) fresh.push(prize.key);
  if (prizes.length) {
    shelfMode = o.mode;
    renderShelf(fresh);
    renderTabs();
    $("shelfNote").textContent = fresh.length
      ? fresh.length === 2
        ? "Two new prizes!"
        : "New on your shelf!"
      : "Another favourite for your collection.";
  }
  if (o.kind === "slip")
    setMessage(
      `So close · ${money(o.payout)} chUSD returned (${o.payoutX}×)`,
      "miss",
    );
  if (o.kind === "whiff")
    setMessage("Empty claw. Your next favourite is still in there.", "miss");
  if (o.kind === "grab" || o.kind === "bonus") {
    $("bonusSign").classList.toggle("won", o.kind === "bonus");
    setMessage(
      `${o.kind === "bonus" ? "Double Grab" : "Prize secured"} · ${money(o.payout)} chUSD · ${o.payoutX}×`,
      "win",
    );
  }
  $("verifyBody").textContent =
    `seed\n${o.seedHex}\n\nderivation\nsha256(seed ++ uint32be(index))\n\n${explain(o)}\n\ncollection\n${prizes.map((p) => p.name).join(", ") || "No prize collected"}\n\nIndices 0–2 determine payout. Cosmetic prize picks use 10 and, for Double Grab, 11.`;
}
$("drop").addEventListener("click", () => void onDrop());
function renderShelf(highlights: string[] = []): void {
  const grid = $("shelfGrid");
  grid.replaceChildren();
  grid.setAttribute("aria-label", `${labels[shelfMode]} collection`);
  const entries = collection.list().filter((x) => x.prize.mode === shelfMode);
  for (const { prize, caught, entry } of entries) {
    const slot = document.createElement("button");
    slot.className = `slot${caught ? " caught" : " locked"}${highlights.includes(prize.key) ? " new" : ""}`;
    slot.setAttribute(
      "aria-label",
      `${prize.name}, ${prize.rarity}, ${caught ? `collected ${entry?.count} times` : "not collected"}`,
    );
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 210;
    canvas.setAttribute("aria-hidden", "true");
    drawPrizeSprite(canvas.getContext("2d")!, prize, 160, 100, 186, {
      silhouette: !caught,
    });
    const name = document.createElement("span");
    name.className = "slot-name";
    name.textContent = prize.name;
    slot.append(canvas, name);
    if (caught && entry && entry.count > 1) {
      const count = document.createElement("span");
      count.className = "copy-count";
      count.textContent = `×${entry.count}`;
      slot.append(count);
    }
    if (highlights.includes(prize.key)) {
      const badge = document.createElement("span");
      badge.className = "new-label";
      badge.textContent = "NEW";
      slot.append(badge);
    }
    slot.addEventListener("click", () => showPrize(prize));
    grid.append(slot);
  }
  $("shelfCount").innerHTML =
    `${collection.caughtCount()} <small>/ ${collection.total()}</small>`;
  $("shelfProgress").textContent =
    `${entries.filter((x) => x.caught).length} / 10`;
  if (!highlights.length)
    $("shelfNote").textContent = entries.some((x) => x.caught)
      ? "Your collection, one drop at a time."
      : "Your next favourite is in there.";
}
function showPrize(prize: Prize): void {
  sfx.unlock();
  sfx.click();
  const canvas = $<HTMLCanvasElement>("prizePreview"),
    ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawPrizeSprite(ctx, prize, 240, 205, 350, {
    silhouette: !collection.has(prize.key),
  });
  $("prizeName").textContent = prize.name;
  $("prizeRarity").textContent = `${labels[prize.mode]} · ${prize.rarity}`;
  $("prizeDetail").textContent = collection.has(prize.key)
    ? `Collected ${collection.entry(prize.key)?.count} time${collection.entry(prize.key)?.count === 1 ? "" : "s"}. Yours to keep on the shelf.`
    : "Still waiting in the machine. Land this prize to add it to your shelf.";
  $<HTMLDialogElement>("prizeDialog").showModal();
}
$("howToPlay").addEventListener("click", () =>
  $<HTMLDialogElement>("infoDialog").showModal(),
);
$("verifyOpen").addEventListener("click", () =>
  $<HTMLDialogElement>("verifyDialog").showModal(),
);
document.querySelectorAll<HTMLDialogElement>("dialog").forEach((dialog) => {
  dialog
    .querySelector("[data-close]")!
    .addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      const box = dialog.getBoundingClientRect();
      if (
        e.clientX < box.left ||
        e.clientX > box.right ||
        e.clientY < box.top ||
        e.clientY > box.bottom
      )
        dialog.close();
    }
  });
});
$("shelfReset").addEventListener("click", () => {
  if (confirm("Clear the collected prizes saved in this browser?")) {
    collection.reset();
    renderTabs();
    renderShelf();
    $("shelfNote").textContent = "Your next favourite is in there.";
  }
});
$("paytable").innerHTML =
  `<table><caption>Machine payouts</caption><thead><tr><th>Machine</th><th>Prize chance</th><th>Prize</th><th>Bonus</th><th>RTP</th></tr></thead><tbody>${MODE_ORDER.map(
    (id) => {
      const m = MODES[id];
      return `<tr><th>${labels[id]}</th><td>${(m.grab * (1 - m.slip) * 100).toFixed(2)}%</td><td>${m.mult}×</td><td>${maxWinX(m).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}×</td><td>${(theoreticalRtp(m) * 100).toFixed(2)}%</td></tr>`;
    },
  ).join(
    "",
  )}</tbody></table><p>Prize chance includes the possibility of slipping. Bonus chance after keeping a prize: 5% Plush, 6% Gadget, 8% Jackpot. Slip return: 0.2×.</p>`;
let muted = false;
try {
  muted = localStorage.getItem("claw.muted") === "1";
} catch {
  /* storage unavailable */
}
function applyMuted(): void {
  sfx.setMuted(muted);
  const button = $("soundToggle");
  button.querySelector("img")!.src = muted ? ICON.audioOff : ICON.audioOn;
  button.setAttribute("aria-label", muted ? "Enable sound" : "Mute sound");
  button.setAttribute("aria-pressed", String(muted));
  try {
    localStorage.setItem("claw.muted", muted ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}
$("soundToggle").addEventListener("click", () => {
  sfx.unlock();
  muted = !muted;
  applyMuted();
  if (!muted) sfx.click();
});
window.addEventListener("keydown", (event) => {
  const active = document.activeElement;
  if (
    event.code !== "Space" ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    document.querySelector("dialog[open]")
  )
    return;
  if (active !== document.body && active !== $("machine")) return;
  event.preventDefault();
  void onDrop();
});
buildTabs();
buildBets();
renderShelf();
updateOdds();
applyMuted();
renderBalance(client.getBalance());
renderBet();
void preloadPrizeSprites().then(() => renderShelf());
async function connect(): Promise<void> {
  const params = new URLSearchParams(location.search),
    useHost =
      params.has("host") ||
      params.has("gameAddress") ||
      window.parent !== window;
  try {
    if (useHost) {
      $("balanceLabel").textContent = "CONNECTING";
      const { ChainSdkClient } = await import("./casino/chainClient.ts");
      client = new ChainSdkClient();
      await client.ready();
    } else await client.ready();
    client.onBalanceChange((value) => {
      if (!rolling) {
        renderBalance(value);
        buildBets();
        renderBet();
      }
    });
    clientReady = true;
    bet = Math.max(client.minBet(), Math.min(bet, client.maxBet()));
    buildBets();
    renderBet();
    renderBalance(client.getBalance());
  } catch (error) {
    console.error("Host connection failed", error);
    clientReady = false;
    $("balanceLabel").textContent = "NOT CONNECTED";
    setMessage(
      "Connection unavailable. Please reopen the game from the casino.",
      "miss",
    );
    updateDropEnabled();
  }
}
void connect();
