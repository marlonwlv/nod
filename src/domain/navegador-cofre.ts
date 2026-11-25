import type { EntradaNavegador, FonteCofre, OpcaoLogin } from "../contracts/navegador-do-bot.ts";

/**
 * O login do navegador do bot com os cofres da pessoa (ADR-190, decisão 6; quadro L do Paper) e as respostas de antemão
 * (A2, A3). Puro: nada de segredo passa por aqui; só sites, rótulos, referências e regras.
 */

/** O aparelho da pessoa com o app do nod: o Mac (macOS) ou o PC (Windows). */
export type AparelhoDaPessoa = "mac" | "pc";

/**
 * 2026-11-22 (o navegador no PC): os textos que dizem o aparelho e a confirmação dele. No Mac, o Touch ID (ou a senha,
 * sem sensor) e o Keychain; no PC, o Windows Hello (rosto, digital ou PIN) e a senha do Windows. Um lugar só, para o
 * servidor e a web dizerem a mesma coisa.
 */
export function textosDoAparelho(a: AparelhoDaPessoa) {
  const pc = a === "pc";
  const nome = pc ? "PC" : "Mac";
  const confirmacao = pc ? "Windows Hello" : "Touch ID";
  return {
    nome,
    confirmacao,
    semAparelho: `precisa do seu ${nome} ligado`,
    bitwardenTravado: `destravar no seu ${nome}`,
    avisoSemConfirmacao: `Seu ${nome} está desligado: a confirmação vai só pelo botão, sem o ${confirmacao}.`,
    confirmeNoAparelho: `Confirme no seu ${nome}`,
    aparelhoDesligado: `O seu ${nome} não está ligado agora.`,
    pedeNaHoraDePagar: `O seu ${nome} pede o ${confirmacao} na hora de pagar.`,
    pedeParaGuardarLimite: `O seu ${nome} pede o ${confirmacao} para guardar o limite.`,
    pedeNoLogin: pc ? "O Windows pede o Windows Hello (ou a senha do Windows). A senha vai direto para a página." : "O seu Mac pede o Touch ID ou a senha do Keychain. A senha vai direto para a página.",
    pagarCom: `Pagar com ${confirmacao}`,
    pagarSem: `Pagar sem ${confirmacao}`,
  };
}

/** O aparelho pela plataforma da máquina (win32 = PC; o resto que não é Linux, o Mac). */
export const aparelhoDaPlataforma = (plataforma: string | null | undefined): AparelhoDaPessoa => (plataforma === "win32" ? "pc" : "mac");

/** As frases da opção que não roda agora (L1, M4). */
export const MOTIVO_SEM_MAC = textosDoAparelho("mac").semAparelho;
export const MOTIVO_BITWARDEN_TRAVADO = textosDoAparelho("mac").bitwardenTravado;

/**
 * Sufixos públicos de dois níveis que os sites das pessoas do nod usam (Brasil, Portugal, Reino Unido, Austrália, Japão).
 * definido em 2026-11-20: sem a Public Suffix List inteira; o que não está aqui conta como sufixo de um nível, e o pior
 * caso é casar dois sites do mesmo sufixo de dois níveis (`a.com.xx` e `b.com.xx`), nunca dois domínios registráveis
 * diferentes dos listados.
 */
const SUFIXOS_DUPLOS: ReadonlySet<string> = new Set([
  "com.br", "net.br", "org.br", "gov.br", "edu.br", "art.br", "blog.br", "coop.br", "ind.br", "inf.br", "jus.br", "leg.br", "mil.br", "app.br", "dev.br", "eco.br", "emp.br", "log.br", "med.br", "srv.br", "tec.br", "tur.br", "tv.br",
  "com.pt", "org.pt", "gov.pt", "co.uk", "org.uk", "gov.uk", "ac.uk", "com.au", "net.au", "org.au", "co.jp", "ne.jp", "or.jp", "com.ar", "com.mx", "com.co", "com.es", "co.nz", "co.za", "com.tr", "com.cn", "com.hk", "com.sg",
]);

/** O host de um site ou endereço ("itau.com.br", "https://www.itau.com.br/x"), em minúsculas; "" quando não dá. */
export function hostDoSite(siteOuUrl: string): string {
  // Sem `URL` (domínio puro): tira o esquema, o caminho, o usuário e a porta; host com letras, dígitos, ponto e hífen.
  const t = siteOuUrl.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const autoridade = t.split(/[/?#]/, 1)[0] ?? "";
  const host = autoridade.slice(autoridade.lastIndexOf("@") + 1).replace(/:\d+$/, "").replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : "";
}

/**
 * 2026-11-23 (teste do dono, LinkedIn com "Entrar com o Google"): o Google recusa o login em navegador automatizado com a
 * tela "Esse navegador ou app pode não ser seguro" (`accounts.google.com/v3/signin/rejected`). É política dele e o nod não
 * contorna: a saída é trazer a sessão do site de origem do Chrome da pessoa ("Trazer do meu Chrome").
 */
export function googleRecusouOLogin(url: string): boolean {
  const t = url.trim().toLowerCase();
  if (!/^https:\/\/accounts\.google\.com\//u.test(t)) return false;
  const caminho = t.replace(/^https:\/\/accounts\.google\.com/u, "").split(/[?#]/u, 1)[0] ?? "";
  return /(^|\/)signin\/rejected(\/|$)/u.test(caminho);
}

/** O host de login do Google (de onde o "Entrar com o Google" passa): não conta como o site de origem. */
export const ehLoginDoGoogle = (host: string): boolean => host === "accounts.google.com";

/** O domínio registrável ("internetpf.itau.com.br" → "itau.com.br"); um IP volta inteiro. */
export function dominioRegistravel(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (/^\d+(\.\d+){3}$/.test(h) || h.includes(":")) return h;
  const partes = h.split(".").filter(Boolean);
  if (partes.length <= 2) return partes.join(".");
  const dois = partes.slice(-2).join(".");
  return SUFIXOS_DUPLOS.has(dois) ? partes.slice(-3).join(".") : dois;
}

/** Os dois hosts são do mesmo site (o mesmo domínio registrável). */
export function mesmoSite(a: string, b: string): boolean {
  const x = dominioRegistravel(a);
  return x !== "" && x === dominioRegistravel(b);
}

/** O endereço de um item de cofre (URL ou host) casa com o host da aba. */
export function itemCasaComHost(urlOuHost: string, host: string): boolean {
  const h = hostDoSite(urlOuHost);
  return h !== "" && mesmoSite(h, host);
}

/**
 * O cookie do Chrome da pessoa serve ao host pedido: o domínio dele é o próprio host ou um pai dele que não passa do
 * domínio registrável ("Só cookies do host pedido e do domínio pai registrável, nunca o resto").
 */
export function cookieServeAoHost(dominioDoCookie: string, host: string): boolean {
  const d = dominioDoCookie.toLowerCase().replace(/^\./, "");
  const h = host.toLowerCase();
  if (!d || !(h === d || h.endsWith(`.${d}`))) return false;
  return d.split(".").length >= dominioRegistravel(h).split(".").length;
}

/** "marlon@exemplo.com" → "marlon@…"; um usuário sem @ fica com as 3 primeiras letras. Nunca o usuário inteiro de e-mail. */
export function mascararUsuario(usuario: string): string {
  const u = usuario.trim();
  if (!u) return "";
  const arroba = u.indexOf("@");
  if (arroba > 0) return `${u.slice(0, Math.min(arroba, 12))}@…`;
  return [...u].length <= 4 ? u : `${[...u].slice(0, 3).join("")}…`;
}

/** O rótulo da opção (L1): "Itaú · marlon@…". */
export function rotuloDoItem(titulo: string, usuario: string): string {
  const t = titulo.replace(/\s+/g, " ").trim().slice(0, 80);
  const m = mascararUsuario(usuario);
  return m ? `${t} · ${m}` : t;
}

const ORDEM_FONTE: Readonly<Record<FonteCofre, number>> = { "1password": 0, nod: 1, bitwarden: 2 };

/**
 * A ordem do cartão (L1, M4): o que roda agora primeiro (o primeiro vira o botão preto); entre os que rodam, 1Password,
 * o cofre do nod e o Bitwarden. Com o Mac desligado, o 1Password e o Bitwarden ficam cinza e o cofre do nod vem primeiro.
 */
export function ordenarOpcoes(opcoes: readonly OpcaoLogin[]): OpcaoLogin[] {
  return [...opcoes].sort((a, b) => Number(b.disponivel) - Number(a.disponivel) || ORDEM_FONTE[a.fonte] - ORDEM_FONTE[b.fonte]);
}

/** definido em 2026-11-20: o cartão mostra até 6 itens (um site com mais logins que isso é raro e a lista vira ruído). */
export const OPCOES_MAX = 6;

/** "R$ 4.000" · "R$ 3.780,50" (centavos inteiros, ADR-177). */
export function reais(centavos: number): string {
  const inteiro = Math.floor(Math.abs(centavos) / 100);
  const resto = Math.abs(centavos) % 100;
  const milhar = String(inteiro).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${centavos < 0 ? "-" : ""}R$ ${milhar}${resto ? `,${String(resto).padStart(2, "0")}` : ""}`;
}

/** O cartão de antemão (A2): o que o bot vai fazer, com o teto ou o destino, e os dois botões. */
export function textoDoCombinar(p: { host: string; oQue: string; ateCentavos: number | null; destino: string | null }): { titulo: string; texto: string; sim: string; nao: string } {
  const site = p.host.replace(/^www\./, "");
  const oQue = p.oQue.replace(/\s+/g, " ").trim().slice(0, 120);
  if (p.ateCentavos !== null) {
    const teto = reais(p.ateCentavos);
    return { titulo: `Vou comprar em ${site}: ${oQue}, até ${teto}`, texto: "Com isso eu pago sem perguntar de novo, se o valor ficar dentro do limite.", sim: `Pode, até ${teto}`, nao: "Me pergunte antes de pagar" };
  }
  const para = (p.destino ?? "").slice(0, 120);
  return { titulo: `Vou enviar para ${para} em ${site}: ${oQue}`, texto: `Com isso eu envio para ${para} sem perguntar de novo.`, sim: `Pode enviar para ${para}`, nao: "Me pergunte antes de enviar" };
}

const normal = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * O destino do envio (A3) só vale se aparece na página: no texto dela ou no título da aba. O que o modelo diz sozinho
 * nunca libera nada. Devolve o destino como o bot escreveu (espaços normalizados), ou null.
 */
export function destinoNaPagina(para: unknown, textoDaPagina: string, titulo: string): string | null {
  if (typeof para !== "string") return null;
  const p = para.replace(/\s+/g, " ").trim();
  if ([...p].length < 2 || [...p].length > 120) return null;
  const alvo = normal(p);
  return normal(textoDaPagina).includes(alvo) || normal(titulo).includes(alvo) ? p : null;
}

/** O destino guardado casa com o do envio (sem acento, sem caixa). */
export function mesmoDestino(a: string, b: string): boolean {
  return normal(a) === normal(b);
}

export function textoDoLembrar(destino: string): string {
  return `Não perguntar de novo para ${destino}`;
}

/** O código de uso único (L4): uma linha, até 64 caracteres. */
export function codigoValido(codigo: unknown): codigo is string {
  return typeof codigo === "string" && /^[^\r\n\t\p{Cc}]{1,64}$/u.test(codigo) && codigo.trim() !== "";
}

/**
 * A digitação da pessoa num campo (L5), aplicada a um texto guardado só em memória: o caractere entra, o Backspace tira o
 * último, e Selecionar tudo (Cmd/Ctrl+A) faz o próximo caractere trocar o texto inteiro. Atalho que não seja esse e
 * tecla de navegação não mudam o texto. definido em 2026-11-20: é uma reconstrução; colar com o mouse ou o corretor do
 * sistema podem escapar, e por isso a oferta de guardar é uma pergunta, nunca um "guardei".
 */
export type Digitado = { texto: string; tudo: boolean };

const TECLAS_SEM_TEXTO: ReadonlySet<string> = new Set(["Enter", "Tab", "Escape", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Alt", "Control", "Meta", "Shift", "CapsLock"]);

export function aplicarDigitacao(d: Digitado, e: EntradaNavegador): Digitado {
  if (e.t !== "tecla" || e.evento === "keyUp") return d;
  const mods = e.modificadores ?? 0;
  const inserir = (t: string): Digitado => ({ texto: (d.tudo ? "" : d.texto) + t, tudo: false });
  if (e.evento === "char") return e.texto ? inserir(e.texto) : d;
  const tecla = e.tecla ?? "";
  if (mods & (2 | 4)) return tecla.toLowerCase() === "a" ? { ...d, tudo: true } : d;
  if (tecla === "Backspace") return d.tudo ? { texto: "", tudo: false } : { texto: [...d.texto].slice(0, -1).join(""), tudo: false };
  if (TECLAS_SEM_TEXTO.has(tecla)) return d;
  const t = e.texto ?? ([...tecla].length === 1 ? tecla : "");
  return t ? inserir(t) : d;
}

/** definido em 2026-11-20 (L5): o que a pessoa digitou fica no máximo 5 min em memória, guardado ou não. */
export const DIGITADO_DURA_MS = 5 * 60_000;
