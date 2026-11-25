import type { NivelVisto } from "../../lib/acessos-otimistas.ts";

/**
 * As contas de um app no Marketplace (ADR-196, Paper "Apps com mais de uma conta", M1–M8), sem React. As regras do nome
 * repetem src/domain/contas-do-app.ts (a web não importa valor de src, ADR-018); tests/unit/domain/contas-do-app.test.ts
 * confere que as duas dão o mesmo resultado.
 */

export const SEPARADOR_DE_CONTA = "--";
export const LIMITE_CONTAS_POR_APP = 5;
export const TAMANHO_MAXIMO_DA_CONTA = 20;
const FORMATO_DA_CONTA = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const contaValida = (conta: string): boolean => conta.length >= 1 && conta.length <= TAMANHO_MAXIMO_DA_CONTA && FORMATO_DA_CONTA.test(conta);

export function normalizarConta(rotulo: string): string {
  return rotulo.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function separarChave(chave: string): { app: string; conta: string | null } | null {
  const i = chave.indexOf(SEPARADOR_DE_CONTA);
  if (i < 0) return chave ? { app: chave, conta: null } : null;
  const app = chave.slice(0, i);
  const conta = chave.slice(i + SEPARADOR_DE_CONTA.length);
  if (!app || !contaValida(conta)) return null;
  return { app, conta };
}

export function rotuloValido(rotulo: string): boolean {
  const r = rotulo.trim();
  return r.length >= 1 && r.length <= TAMANHO_MAXIMO_DA_CONTA && !/[\p{Cc}\p{Cf}()]/u.test(r) && contaValida(normalizarConta(r));
}

export const chaveDaConta = (app: string, conta: string): string => `${app}${SEPARADOR_DE_CONTA}${conta}`;

/**
 * ADR-196 §9: só o app de login do Composio tem contas a mais (o GitHub e o app de chave seguem com uma). O slug da conta
 * (`<app>--<conta>`, até 20 na conta) cabe nos 64 de `niveis_ferramenta.conector_slug`: o app passa de 42, fica com uma.
 */
export const aceitaContas = (slug: string, chave: boolean): boolean => !chave && slug !== "github" && slug.length + SEPARADOR_DE_CONTA.length + TAMANHO_MAXIMO_DA_CONTA <= 64;

/** O que vai entre parênteses no nome da conta ("Gmail (Família)" → "Família"); a primeira sem parênteses → "". */
export function rotuloDoNome(nomeDoApp: string, nome: string): string {
  const prefixo = `${nomeDoApp} (`;
  return nome.startsWith(prefixo) && nome.endsWith(")") ? nome.slice(prefixo.length, -1) : "";
}

/** O nome inteiro a partir do que a pessoa digitou no Renomear (vazio volta ao nome do app). */
export const nomeComRotulo = (nomeDoApp: string, rotulo: string): string => (rotulo.trim() ? `${nomeDoApp} (${rotulo.trim()})` : nomeDoApp);

/** definido em 2026-11-24 (Paper M2): as sugestões do nome; some a que já é nome de uma conta. */
export const SUGESTOES_DE_CONTA = ["pessoal", "trabalho", "cliente"] as const;
export function sugestoesLivres(usadas: readonly string[]): string[] {
  const ja = new Set(usadas);
  return SUGESTOES_DE_CONTA.filter((s) => !ja.has(s));
}

/** Por que o nome digitado não serve (null = serve). `usadas` são as chaves das contas que já existem. */
export function problemaDoRotulo(rotulo: string, usadas: readonly string[]): string | null {
  const r = rotulo.trim();
  if (!r) return null;
  if (r.length > TAMANHO_MAXIMO_DA_CONTA) return `Até ${TAMANHO_MAXIMO_DA_CONTA} letras.`;
  if (!rotuloValido(r)) return "Use letras e números (sem parênteses).";
  if (usadas.includes(normalizarConta(r))) return "Já tem uma conta com esse nome.";
  return null;
}

type BotComNome = { id: string; nome: string };

/** Quem usa a conta, na linha (Paper M1): "Clarice e mais 2 bots"; ninguém → "Nenhum bot ainda". */
export function resumoDeQuemUsa(bots: readonly BotComNome[], niveis: Readonly<Record<string, NivelVisto>>): string {
  const usam = bots.filter((b) => (niveis[b.id] ?? "nenhum") !== "nenhum");
  if (usam.length === 0) return "Nenhum bot ainda";
  const [primeiro] = usam;
  if (usam.length === 1) return primeiro!.nome;
  const resto = usam.length - 1;
  return `${primeiro!.nome} e mais ${resto} ${resto === 1 ? "bot" : "bots"}`;
}

/** Quem perde o acesso ao remover (Paper M7): os que têm nível, com o nível; os primeiros e o total. */
export function quemPerde(bots: readonly BotComNome[], niveis: Readonly<Record<string, NivelVisto>>): { id: string; nome: string; nivel: NivelVisto }[] {
  return bots.flatMap((b) => {
    const nivel = niveis[b.id] ?? "nenhum";
    return nivel === "nenhum" ? [] : [{ id: b.id, nome: b.nome, nivel }];
  });
}

export function fraseDeQuemPerde(n: number, onde: string): string {
  if (n === 0) return `Nenhum bot usa ${onde} agora.`;
  return `${n === 1 ? "1 bot perde" : `${n} bots perdem`} o acesso a ${onde}.`;
}

export const textoDoLimite = (n: number): string => `${Math.min(n, LIMITE_CONTAS_POR_APP)} de ${LIMITE_CONTAS_POR_APP}`;
