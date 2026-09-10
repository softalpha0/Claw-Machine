/**
 * Chain Jam widget mount point.
 *
 * The jam requires every entry to carry the official jam widget. Drop the real
 * embed snippet from jam.chain.wtf here (it is usually a <script src> plus a
 * target element). Until you paste it, this renders a labelled placeholder so
 * the slot, styling and layout are already correct.
 *
 *   1. Copy the embed snippet from https://jam.chain.wtf/  ("Add the jam widget")
 *   2. If it is a <script> tag: add it to index.html and set MOUNTED = true here.
 *   3. If it is an init call: import it and call it against #jam-widget below.
 */

const MOUNTED = false; // flip to true once the real widget script is in index.html

export function mountJamWidget(host: HTMLElement): void {
  host.innerHTML = "";
  const el = document.createElement("div");
  el.id = "jam-widget";
  host.appendChild(el);

  if (MOUNTED) return; // real widget will populate #jam-widget

  el.className = "jam-widget-placeholder";
  el.innerHTML = `
    <span class="jam-dot"></span>
    <span>Chain Jam Vol. 1</span>
    <a href="https://jam.chain.wtf/" target="_blank" rel="noopener">jam.chain.wtf</a>
    <span class="jam-note">widget slot — paste embed in src/jam/widget.ts</span>
  `;
}
