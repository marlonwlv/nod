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
