import type { IaDesktop } from "../../src/contracts/desktop.ts";
import { esc } from "../lib/render.ts";
import { logoDaIa, PROVEDOR } from "./cartao-ia.ts";

/**
 * O aviso ao ligar "Trocar sozinho" (ADR-101, NOD-211; protótipo v4, revisão do Gil em 2026-10-12). Cada frase diz de
 * onde vem: a Anthropic fala em uso individual só para Pro e Max, e na página legal do Claude Code, não nos Termos de
 * Consumo. Cancelar é o primário e recebe o foco; "Ligar mesmo assim" é secundário. Diálogo próprio (window.confirm
 * não deixa escolher o botão em foco nem pôr links).
 */
export type AvisoDosTermos = { texto: string; links: readonly { rotulo: string; url: string }[] };

/** definido em 2026-10-12, conferido nas páginas: code.claude.com/docs/en/legal-and-compliance e anthropic.com/legal/consumer-terms. */
export const TERMOS_DA_TROCA: Record<IaDesktop, AvisoDosTermos> = {
  "claude-cli": {
    texto: "A Anthropic diz que os limites do Pro e Max supõem uso individual comum do Claude Code, e os Termos de Consumo proíbem contornar os sistemas e as proteções dela. Isso pode ser visto assim: se ligar, a responsabilidade é sua.",
    links: [
      { rotulo: "Página legal do Claude Code", url: "https://code.claude.com/docs/en/legal-and-compliance" },
      { rotulo: "Termos de Consumo", url: "https://www.anthropic.com/legal/consumer-terms" },
    ],
  },
  "codex-cli": {
    texto: "Os Termos de Uso da OpenAI proíbem contornar limites de uso ou restrições. Isso pode ser visto assim: se ligar, a responsabilidade é sua.",
    links: [{ rotulo: "Termos de Uso da OpenAI", url: "https://openai.com/policies/terms-of-use/" }],
  },
};

/** A conta que vai entrar na fila (Paper G3): o nome e o lugar dela entre as contas da mesma IA na fila. */
export type ContaNoAviso = { nome: string; ordem: number };

/**
 * Jornadas da IA (Paper G3, 2026-11-20): o aviso no design system novo — a conta no topo, a pergunta, o porquê com as
 * fontes e o caminho seguro ("Deixar fora da fila") como primário e com o foco; "Ligar mesmo assim" é o secundário.
 * Sem a conta (o "Trocar sozinho" do app do Mac de antes, ADR-101), a mesma pergunta pela IA e o Cancelar.
 */
export function htmlDoAvisoDosTermos(ia: IaDesktop, conta?: ContaNoAviso): string {
  const t = TERMOS_DA_TROCA[ia];
  const { nome, cli } = PROVEDOR[ia];
  const links = t.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.rotulo)} ↗</a>`).join("");
  const topo = conta ? `<div class="termos-conta">${logoDaIa(ia, "cl-logo")}<span><b>${esc(conta.nome)}</b><small>${conta.ordem}ª conta do ${esc(nome)} na fila</small></span></div>` : "";
  const titulo = conta ? "Deixar o nod passar sozinho para esta conta?" : `Deixar o nod trocar de conta sozinho no ${esc(cli)}?`;
  const contexto = `Com duas contas do ${esc(nome)} na fila, quando uma chega ao limite os bots seguem na outra. `;
  return `${topo}<h2 id="aviso-termos-titulo">${titulo}</h2>
    <p class="termos-texto">${contexto}${esc(t.texto)}</p>
    <p class="termos-fontes">${links}</p>
    <div class="termos-acoes"><button class="termos-sim" data-sim type="button">Ligar mesmo assim</button><button class="termos-nao" data-nao type="button" autofocus>${conta ? "Deixar fora da fila" : "Cancelar"}</button></div>`;
}
