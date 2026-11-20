import type { ModoAprovacao } from "../contracts/agente.ts";

/**
 * Aprovação no navegador do bot (ADR-190, quadro "A" do Paper): pede só no ponto sem volta. Puro.
 *
 * definido em 2026-11-20 (decisão do Marlon: manter a aprovação do nod sem pesar na experiência; nightly e OpenMausBot
 * não pedem nada): a ação ganha uma CLASSE a partir do alvo que o servidor resolveu da última leitura (papel e nome
 * acessível do botão, nunca o texto que o modelo diz), e a classe decide com o modo do bot.
 */
export const CLASSES_ACAO_NAVEGADOR = ["livre", "enviar", "apagar", "pagar", "seguranca"] as const;
export type ClasseAcaoNavegador = (typeof CLASSES_ACAO_NAVEGADOR)[number];

/** O alvo como o servidor o conhece: papel e nome acessível da referência, e o site (host) da aba. */
export type AlvoResolvido = { papel: string; nome: string; host: string };

/**
 * Palavras do rótulo de um botão ou link que fazem dele um ponto sem volta. Comparadas sem acento e em minúsculas, como
 * palavra inteira (ou expressão). Português e inglês, os idiomas dos sites que as pessoas do nod usam.
 * definido em 2026-11-20: a lista é a do quadro A; o que não casa é livre (o revisor do automático continua olhando os
 * envios).
 */
const PALAVRAS: Readonly<Record<Exclude<ClasseAcaoNavegador, "livre">, readonly string[]>> = {
  pagar: ["pagar", "comprar", "finalizar compra", "finalizar pedido", "confirmar pagamento", "confirmar compra", "assinar", "contratar", "efetuar pagamento", "fazer pedido", "checkout", "pay", "buy", "purchase", "place order", "subscribe", "pix", "transferir", "doar", "donate"],
  apagar: ["apagar", "excluir", "remover", "deletar", "cancelar assinatura", "cancelar pedido", "cancelar conta", "encerrar conta", "delete", "remove", "cancel subscription", "cancel order", "close account", "esvaziar lixeira", "descartar"],
  seguranca: ["alterar senha", "trocar senha", "mudar senha", "redefinir senha", "alterar e-mail", "trocar e-mail", "alterar email", "trocar email", "autenticacao em dois fatores", "verificacao em duas etapas", "change password", "reset password", "change email", "two-factor", "2fa", "desativar seguranca"],
  enviar: ["enviar", "publicar", "postar", "responder", "responder a todos", "compartilhar", "convidar", "agendar envio", "send", "post", "publish", "reply", "share", "invite", "tweet", "submit", "enviar mensagem", "enviar e-mail", "confirmar envio", "concluir inscricao", "inscrever"],
};

/** Ordem de gravidade: o rótulo "Pagar e enviar" é pagar. */
const ORDEM: readonly Exclude<ClasseAcaoNavegador, "livre">[] = ["pagar", "seguranca", "apagar", "enviar"];

export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function contemExpressao(rotulo: string, expressao: string): boolean {
  const r = ` ${rotulo.replace(/[^a-z0-9$-]+/g, " ").trim()} `;
  const e = ` ${expressao.replace(/[^a-z0-9$-]+/g, " ").trim()} `;
  return r.includes(e);
}

/** Papéis que disparam algo ao clicar. Campo, caixa de seleção e texto nunca são ponto sem volta sozinhos. */
const PAPEIS_DE_ACAO = new Set(["button", "link", "menuitem", "tab", "option", "switch", "botao", "submit"]);

export function classificarAlvo(alvo: AlvoResolvido | null): ClasseAcaoNavegador {
  if (!alvo) return "livre";
  if (!PAPEIS_DE_ACAO.has(alvo.papel.toLowerCase())) return "livre";
  const rotulo = semAcento(alvo.nome);
  for (const classe of ORDEM) if (PALAVRAS[classe].some((p) => contemExpressao(rotulo, semAcento(p)))) return classe;
  return "livre";
}

/** Uma ação do navegador que chega ao servidor: a ferramenta e o alvo resolvido (quando há). */
export type AcaoNavegador = { ferramenta: string; alvo: AlvoResolvido | null; tecla?: string };

/** Só clicar (ou Enter num botão focado) dispara o que o rótulo promete. Preencher, rolar e ler nunca pedem. */
export function classificarAcao(acao: AcaoNavegador): ClasseAcaoNavegador {
  if (acao.ferramenta === "navegador_clicar" || acao.ferramenta === "navegador_procurar") return classificarAlvo(acao.alvo);
  if (acao.ferramenta === "navegador_tecla" && acao.tecla && /^(enter|space| )$/i.test(acao.tecla)) return classificarAlvo(acao.alvo);
  if (acao.ferramenta === "navegador_pixel") return "livre";
  return "livre";
}

/**
 * Respostas que valem de antemão (A2, A3): um teto para pagar num site e destinos de envio que a pessoa liberou.
 * `pagarAte` em centavos; o valor da ação vem do rótulo ("Pagar R$ 3.780") quando dá para ler.
 */
export type LiberacoesNavegador = {
  pagar: readonly { host: string; ateCentavos: number }[];
  enviar: readonly { host: string; destino: string }[];
};

export const SEM_LIBERACOES: LiberacoesNavegador = { pagar: [], enviar: [] };

/** O valor em centavos escrito no rótulo (R$ 3.780,00 · R$3.780 · $ 12.50), ou null. */
export function valorDoRotulo(rotulo: string): number | null {
  const m = rotulo.match(/(?:R\$|US\$|\$|€)\s*([0-9](?:[0-9.,\s]*[0-9])?)/);
  if (!m?.[1]) return null;
  const n = m[1].replace(/\s/g, "");
  // O último separador seguido de exatamente 2 dígitos é o decimal; os outros são de milhar.
  const dec = n.match(/[.,]([0-9]{2})$/);
  const inteiro = (dec ? n.slice(0, -3) : n).replace(/[.,]/g, "");
  const v = Number(inteiro) * 100 + (dec ? Number(dec[1]) : 0);
  return Number.isFinite(v) ? v : null;
}

export type DecisaoNavegador =
  /** Segue sem perguntar. */
  | { tipo: "passa"; motivo: "livre" | "modo" | "liberado_antes" }
  /** Para e pergunta na pílula, na conversa e no celular (A1). touchId: dinheiro pede a passkey (ADR-177). */
  | { tipo: "pede"; classe: Exclude<ClasseAcaoNavegador, "livre" | "seguranca">; touchId: boolean; podeLembrar: boolean }
  /** O revisor do automático decide (só envios). */
  | { tipo: "revisor" }
  /** Senha, e-mail e segurança da conta: a pessoa faz (assume). */
  | { tipo: "pessoa_faz" };

/**
 * A tabela do quadro A. Pagar pede SEMPRE com Touch ID (ADR-177: dinheiro nunca sem você), a não ser que a pessoa tenha
 * dado um teto para aquele site e o valor caiba nele. Segurança da conta é sempre da pessoa. Apagar pede no manual e no
 * automático; enviar pede no manual, vai ao revisor no automático (que pergunta só com destino novo ou conteúdo sensível),
 * e nenhum dos dois pede no total.
 */
export function decidirNoNavegador(p: { modo: ModoAprovacao; classe: ClasseAcaoNavegador; host: string; rotulo: string; destino: string | null; liberacoes: LiberacoesNavegador; revisorLigado: boolean }): DecisaoNavegador {
  const { classe } = p;
  if (classe === "livre") return { tipo: "passa", motivo: "livre" };
  if (classe === "seguranca") return { tipo: "pessoa_faz" };
  if (classe === "pagar") {
    const valor = valorDoRotulo(p.rotulo);
    const teto = p.liberacoes.pagar.find((l) => l.host === p.host);
    if (teto && valor !== null && valor <= teto.ateCentavos) return { tipo: "passa", motivo: "liberado_antes" };
    return { tipo: "pede", classe: "pagar", touchId: true, podeLembrar: false };
  }
  if (p.modo === "total") return { tipo: "passa", motivo: "modo" };
  if (classe === "apagar") return { tipo: "pede", classe: "apagar", touchId: false, podeLembrar: false };
  // enviar
  if (p.destino && p.liberacoes.enviar.some((l) => l.host === p.host && l.destino === p.destino)) return { tipo: "passa", motivo: "liberado_antes" };
  if (p.modo === "automatico") return p.revisorLigado ? { tipo: "revisor" } : { tipo: "passa", motivo: "modo" };
  return { tipo: "pede", classe: "enviar", touchId: false, podeLembrar: p.destino !== null };
}

/** A pergunta da pílula (A1): curta, com o rótulo do próprio site. */
export function perguntaDaAcao(classe: Exclude<ClasseAcaoNavegador, "livre" | "seguranca">, rotulo: string, host: string): string {
  const site = siteLegivel(host);
  const r = rotulo.trim().replace(/\s+/g, " ").slice(0, 80);
  if (classe === "pagar") return `${r} no ${site}?`;
  if (classe === "apagar") return `${r} no ${site}?`;
  return `${r} no ${site}?`;
}

/** "www.tap.pt" → "tap.pt"; o host cru quando não dá. */
export function siteLegivel(host: string): string {
  return host.replace(/^www\./, "") || host;
}
