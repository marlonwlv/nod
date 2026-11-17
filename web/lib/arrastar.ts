import type { FrotaDto } from "../../src/contracts/api.ts";
import { chaveDoTime } from "./times-da-barra.ts";

type Bot = FrotaDto["agentes"][number];

/**
 * Arrastar na barra lateral (definido em 2026-09-30, canvas "Menu, sidebar e gaveta"): um grupo é a grade de fixados
 * ou uma seção ("" = Sem seção). Soltar manda ao servidor a ordem inteira do grupo de destino (0041) e a barra se
 * reorganiza na hora, sem esperar a frota voltar. Na grade o ponto de soltar escolhe a vaga; numa seção, não
 * (ordemAoSoltarNaSecao).
 */
export type Destino = { grupo: "fixados" } | { grupo: "secao"; secao: string };

// NOD-437: o time casa pela chave do nome ("produção" e "Produção" são o mesmo time).
const noGrupo = (b: Bot, destino: Destino): boolean => (destino.grupo === "fixados" ? b.fixado : !b.fixado && chaveDoTime(b.secao ?? "") === chaveDoTime(destino.secao));

/** A mesma ordem do servidor: fixados primeiro, depois a posição (null por último), depois a criação. */
export function compararNaBarra(x: Bot, y: Bot): number {
  return Number(y.fixado) - Number(x.fixado) || (x.posicao ?? Infinity) - (y.posicao ?? Infinity) || x.criadoEm - y.criadoEm;
}

/** Os ids do grupo de destino na ordem da barra, com o bot solto em `indice` (fora do alcance = no fim). */
export function ordemAoSoltar(agentes: readonly Bot[], pessoaId: string, id: string, destino: Destino, indice: number): string[] {
  // ADR-081: o Nod não entra na ordem de grupo nenhum — a barra o desenha à parte (primeiro dos fixados, ou na barra de cima).
  const grupo = agentes.filter((b) => b.ownerId === pessoaId && b.id !== id && !b.excluidoEm && b.papel !== "nod" && noGrupo(b, destino)).map((b) => b.id);
  grupo.splice(Math.max(0, Math.min(indice, grupo.length)), 0, id);
  return grupo;
}

/**
 * Soltar numa seção (definido em 2026-11-16, jornada "Arrastar bot para seção"): a seção inteira é o alvo e o ponto
 * onde se solta não escolhe lugar. O bot entra no fim da seção; solto na seção em que já está, nada muda (null): não
 * há reordenar dentro da seção arrastando.
 */
export function ordemAoSoltarNaSecao(agentes: readonly Bot[], pessoaId: string, id: string, secao: string): string[] | null {
  const bot = agentes.find((b) => b.id === id);
  if (!bot || (!bot.fixado && chaveDoTime(bot.secao ?? "") === chaveDoTime(secao))) return null;
  return ordemAoSoltar(agentes, pessoaId, id, { grupo: "secao", secao }, Infinity);
}

/**
 * O cartão que segue o ponteiro enquanto se arrasta um bot: 80×90, centrado no ponteiro. A escala de 1,04 ao pegar é
 * do CSS (.fantasma-bot); o centro não muda com ela.
 */
export const FANTASMA = { largura: 80, altura: 90 } as const;
export const posicaoDoFantasma = (x: number, y: number): { x: number; y: number } => ({ x: x - FANTASMA.largura / 2, y: y - FANTASMA.altura / 2 });

/** O que o leitor de tela ouve em cada passo do arrasto. */
export const frasesDoArrasto = {
  pegou: (nome: string): string => `Você pegou ${nome}`,
  sobre: (nome: string, alvo: string): string => `${nome} está sobre ${alvo}`,
  fora: (nome: string): string => `${nome} não está sobre uma área para soltar`,
  soltou: (nome: string, alvo: string | null): string => (alvo ? `Você soltou ${nome} em ${alvo}` : `Você soltou ${nome}`),
  cancelou: (nome: string): string => `O arraste de ${nome} foi cancelado`,
};

/** A frota como ela fica depois de soltar: o bot muda de grupo e o grupo inteiro ganha as posições novas. */
export function frotaAoSoltar(agentes: readonly Bot[], id: string, destino: Destino, ordem: readonly string[]): Bot[] {
  const posicao = new Map(ordem.map((x, i) => [x, i]));
  return agentes
    .map((b) => {
      const movido = b.id !== id ? b : destino.grupo === "fixados" ? { ...b, fixado: true } : { ...b, fixado: false, secao: destino.secao };
      return posicao.has(b.id) ? { ...movido, posicao: posicao.get(b.id) ?? null } : movido;
    })
    .sort(compararNaBarra);
}

/**
 * Rolagem automática ao arrastar (definido em 2026-10-06, pedido do Marlon): arrastando para o fim da lista, ela não
 * rolava — a do Chromium só reage a poucos pixels da borda, e a borda de baixo encosta no rodapé do Marketplace. Perto
 * da borda (na faixa), a lista rola na direção dela, mais rápido quanto mais perto; passando da borda (o rodapé, a
 * busca), rola no máximo. Pixels por quadro: negativo sobe, positivo desce.
 */
export const FAIXA_AUTO_ROLAGEM = 56;
export const ROLAGEM_MAX_POR_QUADRO = 16;

export function velocidadeAutoRolagem(y: number, topo: number, base: number, faixa = FAIXA_AUTO_ROLAGEM, max = ROLAGEM_MAX_POR_QUADRO): number {
  if (base - topo <= 0) return 0;
  const f = Math.min(faixa, (base - topo) / 2);
  if (y >= base) return max;
  if (y <= topo) return -max;
  if (y > base - f) return Math.ceil((max * (y - (base - f))) / f);
  if (y < topo + f) return -Math.ceil((max * (topo + f - y)) / f);
  return 0;
}
