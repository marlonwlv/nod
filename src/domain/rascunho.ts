import type { CanalRascunho, DestinoItem, Rascunho } from "../contracts/item-aprovacao.ts";
import { semInvisiveis } from "./acoes-do-modo.ts";

/**
 * O rascunho de uma mensagem que sai (ADR-173; protótipo "12-rascunhos-claro" da engenharia reversa do Grok Bot): quando o
 * item de aprovação é um envio — e-mail, Slack, iMessage/SMS ou chat —, a conversa o desenha como o rascunho que ele é
 * (cabeçalho "E-mail · Gmail", Para, Assunto e o corpo editável), em vez do cartão genérico "precisa do seu ok".
 *
 * Nada muda na aprovação: o rascunho é LEITURA dos argumentos que o bot já mandou em `pedir_aprovacao`, calculada pelo
 * servidor a cada "Sua vez" (como a `fraseDaAcao`), e Enviar/Descartar chamam o mesmo `decisoes/:id/decidir`. O corpo só
 * é editável quando é o próprio texto do item: aí a edição da pessoa chega ao argumento pela regra de sempre
 * (`argumentosComTextoFinal`, E4.3). Os valores são dado não confiável: sem invisíveis aqui, escapados na web.
 *
 * Nunca inventa: sem verbo de envio no nome da ferramenta, sem canal reconhecível ou sem corpo de texto, é null e o item
 * fica com o cartão de hoje. Computador e terminal nunca são rascunho (aprova-se exatamente o comando, ADR-055).
 */

/** "chat.postMessage" → ["CHAT", "POST", "MESSAGE"]; "enviar_e-mail" → ["ENVIAR", "E", "MAIL"]. Sem acento. */
function palavras(nome: string): string[] {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
}

const chave = (k: string): string => palavras(k).join("_");

/** O verbo que manda para fora. "draft"/"rascunho" ficam de fora: criar o rascunho no app não envia nada. */
const VERBO_ENVIO = /^(SEND|SENDS|ENVIAR|ENVIA|POST|POSTAR|PUBLICAR|REPLY|RESPONDER|RESPONDE|FORWARD|ENCAMINHAR)$/;
const PROIBE = /^(DRAFT|DRAFTS|RASCUNHO|RASCUNHOS|DELETE|APAGAR|REMOVE|SCHEDULE|AGENDAR|SEARCH|BUSCAR|LIST|LISTAR|READ|LER|GET)$/;

const CORPO = /^(BODY|CORPO|TEXT|TEXTO|MESSAGE|MENSAGEM|CONTENT|CONTEUDO|MARKDOWN_TEXT|MESSAGE_BODY|BODY_TEXT|PLAIN_TEXT|MSG)$/;
const ASSUNTO = /^(SUBJECT|ASSUNTO)$/;
const PARA = /^(TO|PARA|RECIPIENTS?|RECIPIENT_EMAILS?|RECIPIENT_EMAIL|TO_EMAILS?|DESTINATARIOS?|DESTINATARIO|PHONE|PHONE_NUMBER|TELEFONE|NUMERO|NUMBER|HANDLE|CHAT_ID|USER|USER_ID|EMAIL)$/;
const CANAL = /^(CHANNEL|CANAL|CHANNEL_NAME|CHANNEL_ID|CONVERSATION|CONVERSA|ROOM|SALA|THREAD|SPACE)$/;
const COPIA: readonly [RegExp, string][] = [[/^(CC|COPIA|EXTRA_RECIPIENTS)$/, "Cc "], [/^(BCC|CCO|COPIA_OCULTA)$/, "Cco "]];

/** O canal pelo app (slug e nome) e pela ferramenta; a ordem decide o que é mais específico (iMessage antes de "message"). */
function canalDe(slug: string, app: string, ferramenta: string): CanalRascunho | null {
  const tudo = [...palavras(slug), ...palavras(app), ...palavras(ferramenta)];
  const tem = (re: RegExp) => tudo.some((p) => re.test(p));
  if (tem(/^(IMESSAGE|IMESSAGES|IMSG)$/)) return "imessage";
  if (tem(/^(SMS|TEXTED)$/)) return "sms";
  if (tem(/^SLACK$/)) return "slack";
  if (tem(/^(GMAIL|OUTLOOK|EMAIL|EMAILS|MAIL|MAILS|INBOX)$/) || (tem(/^E$/) && tem(/^MAIL$/))) return "email";
  if (tem(/^(TEAMS|DISCORD|WHATSAPP|TELEGRAM|CHAT|MEETING|REUNIAO|ZOOM|MEET)$/)) return "chat";
  return null;
}

const limpo = (v: string): string => semInvisiveis(v);
const lista = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/\s*[,;]\s*/) : [])
    .filter((x): x is string => typeof x === "string")
    .map(limpo)
    .filter((x) => x.length > 0);

export type ItemParaRascunho = { textoOriginal: string; textoFinal: string; destino: DestinoItem };

/** O rascunho do item, ou null quando ele não é uma mensagem que sai. `app`: o nome do conector como a pessoa o vê. */
export function rascunhoDoItem(item: ItemParaRascunho, app: string): Rascunho | null {
  const { destino } = item;
  if (destino.conector === "computador" || destino.conector === "terminal") return null;
  const ps = palavras(destino.ferramenta);
  if (!ps.some((p) => VERBO_ENVIO.test(p)) || ps.some((p) => PROIBE.test(p))) return null;
  const canal = canalDe(destino.conector, app, destino.ferramenta);
  if (!canal) return null;

  let corpo: string | null = null;
  let assunto: string | null = null;
  const para: string[] = [];
  const copias: string[] = [];
  for (const [k, v] of Object.entries(destino.argumentos ?? {})) {
    const c = chave(k);
    if (CORPO.test(c) && corpo === null && typeof v === "string" && v.trim().length > 0) { corpo = v; continue; }
    if (ASSUNTO.test(c) && assunto === null && typeof v === "string") { assunto = limpo(v); continue; }
    if (PARA.test(c) || CANAL.test(c)) { para.push(...lista(typeof v === "number" ? String(v) : v)); continue; }
    const copia = COPIA.find(([re]) => re.test(c));
    if (copia) copias.push(...lista(v).map((x) => `${copia[1]}${x}`));
  }
  if (corpo === null) return null;
  const editavel = corpo === item.textoOriginal;
  const nome = limpo(app) || destino.conector;
  return {
    canal,
    rotulo: rotuloDe(canal, nome),
    para: [...para, ...copias],
    ...(assunto ? { assunto } : {}),
    // O corpo vai como é (quebras de linha e tudo): é o que sai. A edição da pessoa está no textoFinal.
    corpo: editavel ? item.textoFinal : corpo,
    editavel,
  };
}

/** O cabeçalho do cartão: "E-mail · Gmail", "Mensagem · Slack", "iMessage", "SMS". */
function rotuloDe(canal: CanalRascunho, app: string): string {
  const tipo: Record<CanalRascunho, string> = { email: "E-mail", slack: "Mensagem", imessage: "iMessage", sms: "SMS", chat: "Mensagem" };
  const t = tipo[canal];
  return canal === "imessage" || canal === "sms" || app.toLowerCase() === t.toLowerCase() ? t : `${t} · ${app}`;
}
