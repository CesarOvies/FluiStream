/**
 * FluiStream — Web Component <site-footer>
 * Padrão Cesar Ovies Engineering Standards
 */

class SiteFooter extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <footer style="background-color: #090D13; border-top: 1px solid #21262D; padding: 2rem 1rem; margin-top: auto; color: #8B949E; font-size: 0.8125rem;">
        <div style="max-width: 1440px; margin: 0 auto; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <img src="assets/logo.svg" alt="FluiStream" style="width: 24px; height: 24px;" />
            <strong style="color: #E6EDF3;">FluiStream</strong>
            <span>&bull;</span>
            <span>Reprodutor M3U, EPG & Xtream Codes</span>
          </div>

          <div style="display: flex; align-items: center; gap: 1rem; flex-wrap: wrap;">
            <span>Idiomas: <strong>PT-BR</strong> | <strong>EN-US</strong> | <strong>ES</strong></span>
            <span>&bull;</span>
            <span>100% User-Space</span>
            <span>&bull;</span>
            <a href="https://github.com/CesarOvies/FluiStream" target="_blank" rel="noopener noreferrer" style="color: #388BFD; text-decoration: none;">GitHub</a>
          </div>

          <div>
            <span>&copy; ${new Date().getFullYear()} Cesar Ovies. Licença MIT.</span>
          </div>
        </div>
      </footer>
    `;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('site-footer')) {
  customElements.define('site-footer', SiteFooter);
}

