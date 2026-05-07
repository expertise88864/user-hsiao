/* HsiaoEye Web Components — encapsulated <hs-myth>, <hs-redflag>, <hs-keypoint>.
 *
 * Why custom elements:
 *   - Drop-in semantic markup: `<hs-myth question="…" answer="…">` is far
 *     cleaner than nested div+class soup.
 *   - Encapsulated styling via Shadow DOM means article authors can't
 *     accidentally break the visual style with stray CSS.
 *   - Native progressive enhancement: if JS fails the inner-text content
 *     still reads fine, just unstyled.
 *
 * Usage in article HTML:
 *   <hs-myth>
 *     <span slot="myth">很多人以為點眼藥水可以治癒近視。</span>
 *     <span slot="truth">藥水只能緩解眼疲勞,真正的近視成因是眼軸過長,需要長效阿托品或角膜塑型片才能控制。</span>
 *   </hs-myth>
 *
 *   <hs-redflag title="飛蚊症 4 大警訊">
 *     <ul>
 *       <li>突然增加大量黑點</li>
 *       <li>合併閃光感</li>
 *       <li>視野缺損</li>
 *       <li>視力快速下降</li>
 *     </ul>
 *   </hs-redflag>
 *
 *   <hs-keypoint>
 *     正常眼壓 10–21 mmHg,但「正常眼壓性青光眼」即使 < 21 也可能持續惡化。
 *   </hs-keypoint>
 *
 * Loaded once per page via /assets/components.js (cacheable).
 */
(function () {
  if (window.customElements && customElements.get('hs-myth')) return;  // idempotent

  // ── <hs-myth> ─────────────────────────────────────────────────────
  class HSMyth extends HTMLElement {
    connectedCallback() {
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          :host { display:block; margin:18px 0; border-radius:14px; overflow:hidden;
                  border:1px solid #dcd5c8; background:#fff;
                  box-shadow:0 8px 22px -16px rgba(58,90,124,.25); }
          .myth { background:linear-gradient(135deg,#fde7e7,#fcc9c9); padding:14px 18px;
                  font-size:14.5px; line-height:1.7; color:#7b1d1d; font-weight:600;
                  border-bottom:1px solid #f4b5b5; }
          .myth::before { content:'迷思 / Myth'; display:inline-block; font-size:10.5px;
                  font-weight:700; letter-spacing:.08em; text-transform:uppercase;
                  color:#fff; background:#c44; padding:3px 10px; border-radius:9999px;
                  margin-right:10px; vertical-align:1px; }
          .truth { padding:14px 18px; font-size:14.5px; line-height:1.85; color:#1f3d1f;
                  background:linear-gradient(135deg,#dcfce7,#bbf7d0); }
          .truth::before { content:'事實 / Fact'; display:inline-block; font-size:10.5px;
                  font-weight:700; letter-spacing:.08em; text-transform:uppercase;
                  color:#fff; background:#16a34a; padding:3px 10px; border-radius:9999px;
                  margin-right:10px; vertical-align:1px; }
          @media (prefers-color-scheme: dark) {
            :host { background:#252220; border-color:#3a352d; }
            .myth { background:linear-gradient(135deg,#3a1f1f,#5a2a2a); color:#fcaaaa; border-bottom-color:#5a2a2a; }
            .truth { background:linear-gradient(135deg,#0f2515,#1a3322); color:#86efac; }
          }
        </style>
        <div class="myth"><slot name="myth"></slot></div>
        <div class="truth"><slot name="truth"></slot></div>
      `;
    }
  }
  customElements.define('hs-myth', HSMyth);

  // ── <hs-redflag> ─────────────────────────────────────────────────
  class HSRedFlag extends HTMLElement {
    connectedCallback() {
      const title = this.getAttribute('title') || '警訊辨識 / Red Flags';
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          :host { display:block; margin:18px 0; padding:16px 22px;
                  border:2px solid #fca5a5; border-left-width:6px;
                  border-radius:12px; background:#fef2f2; color:#0f172a; }
          .h { font-family:'Noto Serif TC',Georgia,serif; font-size:16px; font-weight:700;
               color:#991b1b; margin:0 0 10px; display:flex; align-items:center; gap:8px; }
          .h::before { content:'⚠'; font-size:20px; }
          ::slotted(ul) { margin:0; padding-left:22px; line-height:1.85; font-size:14px; }
          ::slotted(li) { margin:4px 0; }
          @media (prefers-color-scheme: dark) {
            :host { background:#3a1f1f; border-color:#7a3a3a; color:#fcaaaa; }
            .h { color:#fcaaaa; }
          }
        </style>
        <div class="h">${title}</div>
        <slot></slot>
      `;
    }
  }
  customElements.define('hs-redflag', HSRedFlag);

  // ── <hs-keypoint> ────────────────────────────────────────────────
  class HSKeypoint extends HTMLElement {
    connectedCallback() {
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          :host { display:block; margin:14px 0; padding:12px 18px 12px 16px;
                  border-left:4px solid #3a5a7c; background:#f3f7fb;
                  font-size:14.5px; line-height:1.85; color:#0f172a; border-radius:0 8px 8px 0; }
          ::slotted(*) { margin:0; }
          @media (prefers-color-scheme: dark) {
            :host { background:#1f2e42; border-left-color:#a4c4dd; color:#e0eaf2; }
          }
        </style>
        <slot></slot>
      `;
    }
  }
  customElements.define('hs-keypoint', HSKeypoint);

  // ── <hs-tldr> ────────────────────────────────────────────────────
  class HSTldr extends HTMLElement {
    connectedCallback() {
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          :host { display:block; margin:14px 0 20px; padding:14px 20px;
                  background:linear-gradient(135deg,#f3e9d6,#e6d4b8);
                  border-left:4px solid #c9a961; border-radius:0 12px 12px 0;
                  font-size:14.5px; line-height:1.85; color:#3a3024; }
          .h { font-size:11px; letter-spacing:.12em; text-transform:uppercase;
               font-weight:700; color:#8b6f3a; margin-bottom:6px; }
          ::slotted(*) { margin:0; }
          @media (prefers-color-scheme: dark) {
            :host { background:linear-gradient(135deg,#3a3024,#4d3f2a); color:#f0d8a0; border-left-color:#c9a961; }
            .h { color:#c9a961; }
          }
        </style>
        <div class="h">TL;DR · 3 句話精華</div>
        <slot></slot>
      `;
    }
  }
  customElements.define('hs-tldr', HSTldr);
})();
