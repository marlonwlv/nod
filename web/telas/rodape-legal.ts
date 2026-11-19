/** Links públicos também fora do domínio do servidor e do app desktop (ADR-053). */
export function htmlRodapeLegal(): string {
  return `<nav class="rodape-legal" aria-label="Informações legais"><a href="https://nodbot.ai/privacidade" target="_blank" rel="noopener">Privacidade</a><a href="https://nodbot.ai/termos" target="_blank" rel="noopener">Termos</a></nav>`;
}
