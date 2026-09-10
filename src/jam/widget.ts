/**
 * Chain Jam widget.
 *
 * The required submission tag —
 *   <script async src="https://jam.chain.wtf/widget.js"></script>
 * — lives in index.html so the jam's URL check always sees it, even before
 * this bundle runs. This module just renders a small static credit in the
 * footer slot; widget.js injects its own UI when it loads.
 */

export function mountJamWidget(host: HTMLElement): void {
  host.innerHTML = `
    <div class="jam-widget-credit">
      <span class="jam-dot"></span>
      Built for <a href="https://jam.chain.wtf/" target="_blank" rel="noopener">Chain Jam Vol. 1</a>
    </div>
  `;
}
