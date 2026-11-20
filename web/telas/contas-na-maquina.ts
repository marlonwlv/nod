import type { ContaIa, IaComConta } from "../../src/contracts/contas-ia.ts";
import type { MaquinaDto } from "../../src/contracts/maquina.ts";
import { nomeCurto, nomeDaContaNaTela } from "./contas-lista.ts";
import { quandoNaTela } from "./uso-da-conta.ts";

/**
 * definido em 2026-11-17: o "nenhuma IA está pronta agora" dizia só isso, e a pessoa via em Provedores de IA a conta "Em
 * uso" com cota sobrando — a cota é da conta, a recusa é da MÁQUINA (a conta pronta no Mac não serve ao bot que roda na
 * VM). Esta é a frase do estado de cada conta NA máquina que recusou, para o aviso dizer o que fazer lá.
 */
export type SemIaNaMaquina = {
  maquina: Pick<MaquinaDto, "id" | "nome">;
  /** "nod-motor-teste" (ou "Mac", quando é o único Mac da pessoa), como na lista de contas. */
  nome: string;
  conectada: boolean;
  /** "Contas nessa máquina: …" ou null (sem conta da IA para descrever). */
  frase: string | null;
};

/** Até três nomes; o resto vira "e mais N". */
function nomes(lista: readonly string[]): string {
  const vistos = lista.slice(0, 3);
  const resto = lista.length - vistos.length;
  if (resto > 0) return `${vistos.join(", ")} e mais ${resto}`;
  return vistos.length <= 1 ? (vistos[0] ?? "") : `${vistos.slice(0, -1).join(", ")} e ${vistos.at(-1)}`;
}

/** A volta do limite da conta: a marca da conta e, sem ela, a leitura da cota (a barra "100% · no limite"). */
function limiteAte(c: ContaIa, agora: number): number | null {
  if (c.noLimiteAte !== null && c.noLimiteAte > agora) return c.noLimiteAte;
  if (c.cota?.situacao === "limite" && c.cota.voltaEm !== null && c.cota.voltaEm > agora) return c.cota.voltaEm;
  return null;
}

/**
 * A frase das contas na máquina, em grupos (pronta, limite, login vencido, sem acesso, nunca entrou). `ia` limita às contas
 * da IA do bot fixado; sem ela (o Automático), todas.
 */
export function semIaNaMaquina(p: { maquina: MaquinaDto; maquinas: readonly MaquinaDto[]; contas: readonly ContaIa[]; agora: number; ia?: IaComConta | null }): SemIaNaMaquina {
  const nome = nomeCurto(p.maquina, p.maquinas);
  const base = { maquina: { id: p.maquina.id, nome: p.maquina.nome }, nome, conectada: p.maquina.conectada };
  const contas = [...p.contas].filter((c) => !p.ia || c.ia === p.ia).sort((a, b) => a.posicao - b.posicao);
  if (contas.length === 0) return { ...base, frase: null };
  // Com contas de mais de uma IA, o nome diz o provedor ("Claude · Conta 1"); com uma só, basta o apelido.
  const duasIas = new Set(contas.map((c) => c.ia)).size > 1;
  const nomeDe = (c: ContaIa) => (duasIas ? nomeDaContaNaTela(c) : c.apelido);
  const prontas: string[] = [];
  const foraDaFila: string[] = [];
  const limite: string[] = [];
  const vencido: string[] = [];
  const semAcesso: string[] = [];
  const nunca: string[] = [];
  for (const c of contas) {
    const v = c.maquinas.find((m) => m.maquinaId === p.maquina.id);
    const ate = limiteAte(c, p.agora);
    if (v?.estado === "pronta" && ate !== null) limite.push(`${nomeDe(c)} está no limite até ${quandoNaTela(ate, p.agora)}`);
    else if (v?.estado === "pronta") (c.entraNaTrocaAutomatica ? prontas : foraDaFila).push(nomeDe(c));
    else if (v?.estado === "sem_login") vencido.push(nomeDe(c));
    else if (v?.estado === "sem_acesso") semAcesso.push(nomeDe(c));
    else nunca.push(nomeDe(c));
  }
  const um = (l: readonly string[]) => l.length === 1;
  const partes = [
    prontas.length ? `${nomes(prontas)} ${um(prontas) ? "já está pronta" : "já estão prontas"}` : null,
    foraDaFila.length ? `${nomes(foraDaFila)} ${um(foraDaFila) ? "está pronta, mas fora da fila" : "estão prontas, mas fora da fila"}` : null,
    ...limite,
    vencido.length ? `${nomes(vencido)} ${um(vencido) ? "precisa" : "precisam"} entrar de novo` : null,
    semAcesso.length ? `${nomes(semAcesso)} ${um(semAcesso) ? "perdeu" : "perderam"} o acesso` : null,
    nunca.length ? `${nomes(nunca)} ${um(nunca) ? "nunca entrou" : "nunca entraram"} nela` : null,
  ].filter((x): x is string => x !== null);
  return { ...base, frase: `Contas nessa máquina: ${partes.join("; ")}.` };
}
