import { randomUUID } from "node:crypto";
import type { PlataformaMaquina } from "../../contracts/ponte.ts";
import type { ComandoNavegadorMaquina, MotivoFalhaNavegador, ResultadoComandoNavegador } from "../../contracts/navegador-maquina.ts";
import { log } from "../../obs/log.ts";
import type { Escopo } from "../../shared/types.ts";

/**
 * A fila do navegador do bot entre o servidor e a máquina da pessoa (ADR-190, decisão 5), no molde do canal do computador
 * (`src/adapters/computador/canal.ts`, ADR-021): em memória, o servidor nunca disca, a máquina puxa. Cada comando é de UMA
 * máquina e de UMA pessoa: a puxada só entrega à conexão cuja chave é a máquina e cujo escopo é o dono do comando.
 *
 * Presença: a máquina que roda o navegador faz o long-poll `navegador/puxar` sem parar (até 20 s cada); a que puxou há
 * menos de PRESENCA_MS está "ligada" para o navegador. Uma máquina conectada mas sem o long-poll (app antigo, Windows) NÃO
 * conta: o lugar diz isso em vez de esperar o prazo de um comando que ninguém vai levar.
 *
 * Um servidor reiniciado perde a fila: o resultado que chegar depois é ignorado (id desconhecido) e quem esperava já
 * recebeu o erro.
 */

/** definido em 2026-11-20: o long-poll dura 20 s; sem puxar há 45 s (dois long-polls e folga), a máquina saiu. */
export const PRESENCA_MS = 45_000;
/** definido em 2026-11-20: o resultado tem esta folga além do prazo do comando (a ida e a volta pela rede). */
export const FOLGA_RESULTADO_MS = 10_000;

type Pendente = { comando: ComandoNavegadorMaquina; maquinaId: string; escopo: Escopo; reservado: boolean; resolver: (r: ResultadoComandoNavegador) => void; relogio: ReturnType<typeof setTimeout> };
type Presenca = { escopo: Escopo; plataforma: PlataformaMaquina; nome: string; em: number; recursos: readonly string[] };

/** O comando sem o que a fila põe (id e prazo). */
export type PedidoNavegadorMaquina = ComandoNavegadorMaquina extends infer C ? (C extends ComandoNavegadorMaquina ? Omit<C, "id" | "prazoEm"> : never) : never;

export type MaquinaComNavegador = { maquinaId: string; plataforma: PlataformaMaquina; nome: string; em: number; /** ADR-197: o que a máquina atende além do navegador (`seu_computador`). */ recursos: readonly string[] };

export type CanalNavegador = ReturnType<typeof criarCanalNavegador>;

export function criarCanalNavegador(o: {
  agora: () => number;
  folgaMs?: number;
  /** A máquina passou a puxar o navegador agora (não estava ligada): o "Quando o Mac ligar" (K1) continua os pedidos. */
  aoLigar?: (escopo: Escopo, maquinaId: string, plataforma: PlataformaMaquina) => void;
}) {
  const pendentes = new Map<string, Pendente>();
  const presencas = new Map<string, Presenca>();
  const folga = o.folgaMs ?? FOLGA_RESULTADO_MS;
  const mesmaPessoa = (a: Escopo, b: Escopo) => a.tenantId === b.tenantId && a.pessoaId === b.pessoaId;

  function ligada(escopo: Escopo, maquinaId: string): boolean {
    const p = presencas.get(maquinaId);
    return !!p && mesmaPessoa(p.escopo, escopo) && o.agora() - p.em < PRESENCA_MS;
  }

  type SemId = { ok: true; valor?: unknown } | { ok: false; motivo: MotivoFalhaNavegador; detalhe: string };
  function sair(id: string, r: SemId): void {
    const p = pendentes.get(id);
    if (!p) return;
    pendentes.delete(id);
    clearTimeout(p.relogio);
    p.resolver({ ...r, id } as ResultadoComandoNavegador);
  }

  return {
    /** A máquina puxou agora (o long-poll do navegador): conta como ligada por PRESENCA_MS. */
    presenca(escopo: Escopo, maquinaId: string, m: { plataforma: PlataformaMaquina; nome: string; recursos?: readonly string[] }): void {
      const nova = !ligada(escopo, maquinaId);
      presencas.set(maquinaId, { escopo: { tenantId: escopo.tenantId, pessoaId: escopo.pessoaId }, plataforma: m.plataforma, nome: m.nome, em: o.agora(), recursos: m.recursos ?? [] });
      if (nova) { try { o.aoLigar?.(escopo, maquinaId, m.plataforma); } catch (e) { log("aviso", "navegador_ao_ligar_falhou", { erro: e instanceof Error ? e.name : "desconhecido" }); } }
    },
    ligada,
    /** As máquinas da pessoa com o navegador ligado agora, a de contato mais recente primeiro. */
    ligadas(escopo: Escopo): MaquinaComNavegador[] {
      const agora = o.agora();
      return [...presencas.entries()].filter(([, p]) => mesmaPessoa(p.escopo, escopo) && agora - p.em < PRESENCA_MS)
        .map(([maquinaId, p]) => ({ maquinaId, plataforma: p.plataforma, nome: p.nome, em: p.em, recursos: p.recursos })).sort((a, b) => b.em - a.em);
    },
    /**
     * Põe o comando na fila da máquina e devolve a resposta dela. Máquina sem o navegador ligado: volta na hora como
     * `indisponivel`. Sem resposta até o prazo (mais a folga): `tempo_esgotado`, e o resultado atrasado é ignorado.
     */
    enviar(escopo: Escopo, maquinaId: string, pedido: PedidoNavegadorMaquina, prazoMs: number): Promise<ResultadoComandoNavegador> {
      const id = randomUUID();
      if (!ligada(escopo, maquinaId)) return Promise.resolve({ id, ok: false, motivo: "indisponivel", detalhe: "a máquina não está conectada" });
      const comando = { ...pedido, id, prazoEm: o.agora() + prazoMs } as ComandoNavegadorMaquina;
      return new Promise((resolver) => {
        const relogio = setTimeout(() => sair(id, { ok: false, motivo: "tempo_esgotado", detalhe: "a máquina não respondeu a tempo" }), prazoMs + folga);
        relogio.unref?.();
        pendentes.set(id, { comando, maquinaId, escopo, reservado: false, resolver, relogio });
      });
    },
    /** O que a máquina leva nesta puxada: os comandos dela, da mesma pessoa, no prazo e ainda não levados. Cada um sai uma vez. */
    puxar(escopo: Escopo, maquinaId: string): ComandoNavegadorMaquina[] {
      const agora = o.agora();
      const saem: ComandoNavegadorMaquina[] = [];
      for (const p of pendentes.values()) {
        if (p.maquinaId !== maquinaId || !mesmaPessoa(p.escopo, escopo) || p.reservado || p.comando.prazoEm <= agora) continue;
        p.reservado = true;
        saem.push(p.comando);
      }
      return saem;
    },
    temPara(escopo: Escopo, maquinaId: string): boolean {
      const agora = o.agora();
      for (const p of pendentes.values()) if (p.maquinaId === maquinaId && mesmaPessoa(p.escopo, escopo) && !p.reservado && p.comando.prazoEm > agora) return true;
      return false;
    },
    /**
     * A resposta de um comando. Idempotente: a segunda vez o id já saiu e é ignorada. Id desconhecido (servidor
     * reiniciado, já vencido) ou de outra máquina/pessoa: ignorado, com log — nunca resolve o comando alheio.
     */
    resultado(escopo: Escopo, maquinaId: string, r: ResultadoComandoNavegador): boolean {
      const p = pendentes.get(r.id);
      if (!p || p.maquinaId !== maquinaId || !mesmaPessoa(p.escopo, escopo)) {
        log("aviso", "navegador_resultado_ignorado", { comando_id: r.id, maquina_id: maquinaId, conhecido: Boolean(p) });
        return false;
      }
      sair(r.id, r.ok ? { ok: true, valor: r.valor } : { ok: false, motivo: r.motivo, detalhe: r.detalhe });
      return true;
    },
    /** A máquina saiu (desconectou): deixa de contar como ligada e quem esperava dela recebe `indisponivel` na hora. */
    esquecerMaquina(maquinaId: string): void {
      presencas.delete(maquinaId);
      for (const [id, p] of [...pendentes]) if (p.maquinaId === maquinaId) sair(id, { ok: false, motivo: "indisponivel", detalhe: "a máquina saiu" });
    },
    /** Só testes. */
    pendentes: () => [...pendentes.values()].map((p) => ({ id: p.comando.id, maquinaId: p.maquinaId, tipo: p.comando.tipo, reservado: p.reservado })),
  };
}
