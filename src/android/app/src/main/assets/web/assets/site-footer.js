/**
 * FluiStream — Web Component <site-footer>
 * Padrão Cesar Ovies Engineering Standards (Midnight Amber & Steel)
 */

class SiteFooter extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <footer class="site-footer-bar">
        <div class="site-footer-inner">
          <div class="site-footer-brand">
            <img src="assets/logo.svg" alt="FluiStream" width="24" height="24" />
            <strong>FluiStream</strong>
            <span>&bull;</span>
            <span>Reprodutor M3U, EPG &amp; Xtream Codes</span>
          </div>

          <div class="site-footer-meta">
            <span>Idiomas: <strong>PT-BR</strong> | <strong>EN-US</strong> | <strong>ES</strong></span>
            <span>&bull;</span>
            <span>100% User-Space</span>
            <span>&bull;</span>
            <a href="https://github.com/CesarOvies/FluiStream" target="_blank" rel="noopener noreferrer">GitHub</a>
          </div>

          <div class="site-footer-copy">
            <span>&copy; ${new Date().getFullYear()} Cesar Ovies. Licença MIT.</span>
          </div>
        </div>
        <div class="site-footer-disclaimer">
          FluiStream é um reprodutor de software livre neutro. Não hospeda, não fornece e não comercializa listas ou transmissões de mídia. Os usuários são os únicos responsáveis pela procedência do conteúdo reproduzido.
        </div>
      </footer>
    `;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('site-footer')) {
  customElements.define('site-footer', SiteFooter);
}
