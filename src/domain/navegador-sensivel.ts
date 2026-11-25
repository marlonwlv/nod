/**
 * Campos sensíveis no navegador do bot (ADR-190, quadro L3 do Paper). Puro.
 *
 * definido em 2026-11-20: o bot lê a página pela árvore de acessibilidade; senha, cartão e código de uso único aparecem
 * como "[campo protegido]", nunca com o valor. Enquanto um segredo que o nod preencheu está na página, a vista ao vivo
 * some e a leitura e o print do bot ficam travados até a página mudar (outra URL).
 */
export const MARCA_PROTEGIDO = "[campo protegido]";

/** Nomes de campo que guardam segredo, sem acento e em minúsculas. */
const NOMES_SECRETOS = /\b(senha|password|passcode|pin|cvv|cvc|codigo de seguranca|security code|token|codigo de verificacao|verification code|one[- ]time|otp|2fa|cartao|card number|numero do cartao)\b/;

export function campoEhSecreto(p: { papel: string; nome: string; tipo?: string | null; autocomplete?: string | null }): boolean {
  if (p.tipo === "password") return true;
  if (p.autocomplete && /^(current-password|new-password|one-time-code|cc-number|cc-csc|cc-exp)/.test(p.autocomplete)) return true;
  if (!/textbox|searchbox|spinbutton|campo/.test(p.papel.toLowerCase())) return false;
  return NOMES_SECRETOS.test(p.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
}

/**
 * Tira o valor dos campos secretos de uma árvore em texto do agent-browser (`- textbox "Senha" [ref=e4]: abc123`).
 * O valor vem depois de `: ` no fim da linha; a linha fica com a marca no lugar.
 */
export function redigirArvore(arvore: string): string {
  return arvore.split("\n").map((linha) => {
    const m = linha.match(/^(\s*-\s*)(textbox|searchbox|spinbutton)\s+"([^"]*)"(.*?)(:\s.*)?$/);
    if (!m) return linha;
    const [, ini, papel, nome, meio] = m;
    if (!campoEhSecreto({ papel: papel!, nome: nome! })) return linha;
    return `${ini}${papel} "${nome}"${meio ?? ""}: ${MARCA_PROTEGIDO}`;
  }).join("\n");
}

/** Tira de um texto livre qualquer valor que a pessoa entregou como segredo (defesa em profundidade). */
export function redigirSegredos(texto: string, segredos: readonly string[]): string {
  let t = texto;
  for (const s of segredos) if (s.length >= 4) t = t.split(s).join(MARCA_PROTEGIDO);
  return t;
}

/** O segredo continua na página enquanto a URL (sem o fragmento) não muda. */
export function segredoAindaNaPagina(urlDoSegredo: string | null, urlAgora: string): boolean {
  if (!urlDoSegredo) return false;
  const tirar = (u: string) => u.split("#")[0];
  return tirar(urlDoSegredo) === tirar(urlAgora);
}

/** Alguma aba aberta ainda está na página do segredo (QA-204: a trava não sai só porque a aba ativa mudou). */
export function segredoEmAlgumaAba(urlDoSegredo: string | null, abas: readonly { url: string }[]): boolean {
  return abas.some((a) => segredoAindaNaPagina(urlDoSegredo, a.url));
}

/** A URL sem o fragmento: a chave das páginas em que o nod já pôs um segredo. */
export const paginaSemFragmento = (url: string): string => url.split("#")[0]!;

/**
 * JS que o nod roda (não o bot) numa página em que já pôs um segredo e à qual a aba voltou: algum campo de texto ainda
 * tem valor? Definido em 2026-11-25 (QA-210): voltar pelo histórico traz a página do bfcache com a senha no campo
 * (medido no Chromium do agent-browser); recarregada do zero, os campos vêm vazios e a trava não volta.
 */
export const JS_CAMPO_PREENCHIDO = `(() => { const fora = /^(hidden|checkbox|radio|submit|button|reset|image|file|range|color)$/i; return [...document.querySelectorAll("input, textarea")].some((e) => !fora.test(e.type || "") && e.value !== ""); })()`;

/**
 * JS que o nod roda (não o bot) quando a URL da aba mudou depois de pôr um segredo: o campo que o próprio nod marcou
 * (`data-nod-campo`, ver JS_CAMPOS_LOGIN) ainda está no documento com valor? Definido em 2026-11-25 (QA-214): uma SPA
 * troca a URL com pushState sem recarregar (login com erro, etapa 2) e a senha continua no campo; medido no Chromium do
 * agent-browser. Página carregada de novo não tem a marca.
 */
export const JS_SEGREDO_MARCADO = `(() => [...document.querySelectorAll('[data-nod-campo="senha"], [data-nod-campo="codigo"]')].some((e) => typeof e.value === "string" && e.value !== ""))()`;
