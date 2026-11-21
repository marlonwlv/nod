import type { ExecucaoRaioX } from "../contracts/raio-x.ts";
import { janelaDoModelo, limiarDeCompactacao } from "./orcamento-contexto.ts";

/**
 * Aviso de contexto cheio (issue #168, emenda da ADR-040 de 2026-11-18). A conversa longa deixa cada turno mais caro e
 * mais lento, porque toda chamada relê o histórico inteiro, e a pessoa só via o tamanho com `/contexto`. Quando o
 * histórico da conversa cruza o limite, o chat ganha uma linha dizendo quanto ele ocupa e sugerindo `/compactar` ou
 * `/nova-sessao`.
 */

/** O limite padrão, em tokens: o mesmo do script com que o time media as sessões antes de existir o aviso. */
export const AVISO_CONTEXTO_TOKENS = 300_000;

/**
 * Numa janela pequena, o Claude Code compacta sozinho muito antes de 300 mil (~144k numa de 200k): o aviso vem a 80% do
 * limiar, para a pessoa poder escolher entre resumir e recomeçar antes de o CLI resumir por ela.
 */
export const FRACAO_DO_LIMIAR_NO_AVISO = 0.8;

/** O limite do aviso numa janela: o menor entre o padrão e 80% do limiar de compactação. */
export function limiteDoAviso(janela: number): number {
  return Math.min(AVISO_CONTEXTO_TOKENS, Math.floor(FRACAO_DO_LIMIAR_NO_AVISO * limiarDeCompactacao(janela)));
}

/**
 * Quanto o histórico ocupava no fim da execução: o contexto da última chamada da conversa principal (subagente não
 * conta) ou, se o CLI compactou depois dela, o que sobrou da compactação. null = execução sem medida (Codex, turno sem
 * chamada).
 */
export function contextoNoFim(execucao: ExecucaoRaioX | null | undefined): number | null {
  if (!execucao) return null;
  const principal = execucao.chamadas.filter((c) => !c.subagente).at(-1) ?? null;
  const compactacao = execucao.compactacoes.at(-1) ?? null;
  if (compactacao && compactacao.depois !== null && (principal === null || compactacao.em >= principal.em)) return compactacao.depois;
  return principal ? principal.contexto : null;
}

export type AvisoDeContexto = { contexto: number; limite: number };

/**
 * Avisa só quando o turno CRUZA o limite: acabou acima e o turno anterior do bot na conversa acabou abaixo (ou não
 * existe). Assim a linha sai uma vez por subida; depois de `/compactar` ou `/nova-sessao` o histórico volta para baixo e
 * a próxima subida avisa de novo. Um turno que compactou no meio compara com zero: a subida é nova.
 */
export function avisoDeContexto(p: { atual: ExecucaoRaioX | null | undefined; anterior: ExecucaoRaioX | null | undefined; modelo: string }): AvisoDeContexto | null {
  const contexto = contextoNoFim(p.atual);
  if (contexto === null) return null;
  const limite = limiteDoAviso(janelaDoModelo(p.atual?.modelo ?? p.modelo, p.atual?.janela ?? null));
  if (limite <= 0 || contexto < limite) return null;
  const antes = (p.atual?.compactacoes.length ?? 0) > 0 ? 0 : (contextoNoFim(p.anterior) ?? 0);
  return antes < limite ? { contexto, limite } : null;
}

/** A linha do chat. Números em mil, como a linha do /compactar. */
export function textoDoAvisoDeContexto(nome: string, aviso: AvisoDeContexto): string {
  const mil = (n: number) => `${Math.round(n / 1000).toLocaleString("pt-BR")} mil`;
  return `A conversa com ${nome} já ocupa ${mil(aviso.contexto)} tokens de contexto (o aviso começa em ${mil(aviso.limite)}). Cada mensagem relê esse histórico, então fica mais cara e mais lenta. Use /compactar para resumir ou /nova-sessao para começar do zero.`;
}
