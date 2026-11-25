import type { IdHarness } from "../../src/contracts/harness.ts";
import type { ContaAnunciada } from "../../src/contracts/contas-ia.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { PlataformaMaquina } from "../../src/contracts/ponte.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import type { ServidorCompleto } from "./servidor-completo.ts";

/**
 * Lote B das Jornadas da IA (2026-11-22): uma máquina de mentira que fala com o servidor COMPARTILHADO pela ponte HTTP de
 * verdade (`/api/maquina/*`), como o motor e o app fazem. O teste decide o que cada turno devolve (o erro do fornecedor,
 * a sessão sumida, o limite com hora), então o servidor assenta pelo caminho real — classificação, troca de conta,
 * repetição, aviso — sem CLI e sem custo. Nada de relógio decide a ordem: o teste puxa e entrega quando quer.
 */
export type ResultadoFalso = Partial<ResultadoTurno> & Pick<ResultadoTurno, "desfecho">;

export type MaquinaFalsa = {
  id: string;
  nome: string;
  /** Anuncia de novo (IAs e contas atuais); devolve o status HTTP. */
  anunciar(): Promise<number>;
  /** Um puxar com o long-poll do servidor; null = nada na fila desta máquina. */
  puxar(): Promise<PlanoTurno | null>;
  /**
   * Puxa até vir um plano (o despacho é assíncrono); lança no prazo. Com `conversaId`, o plano de outra conversa (a fala de
   * um cenário anterior que voltou sozinha à fila, como manda a regra 1) é respondido com sucesso e a busca segue.
   */
  puxarAte(prazoMs?: number, conversaId?: string): Promise<PlanoTurno>;
  /** Entrega o resultado do turno (sucesso com texto, ou o erro do cenário). */
  entregar(plano: PlanoTurno, r: ResultadoFalso): Promise<number>;
  /** Troca o que a máquina tem (IAs e contas) e reanuncia. */
  mudar(o: { harnesses?: Partial<Record<IdHarness, Inventario>>; contas?: ContaAnunciada[] }): Promise<void>;
  /** As chamadas cruas, para o cenário que precisa de outra rota da ponte. */
  pedir(rota: string, corpo?: unknown): Promise<Response>;
};

const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const TOKENS = { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 };

export const PRONTO = (versao = "teste"): Inventario => ({ estado: "pronto", versao, em: Date.now() });

/** Impressão de conta de teste (64 hex), estável por número. */
export const impressao = (n: number): string => n.toString(16).padStart(64, "0");

export function contaFalsa(n: number, ia: "claude-cli" | "codex-cli", apelido: string, extra: Partial<ContaAnunciada> = {}): ContaAnunciada {
  return { impressao: impressao(n), ia, estado: "pronta", plano: ia === "claude-cli" ? "Max" : "Plus", corporativa: false, logadaEm: Date.now() - 60_000, apelidoSugerido: apelido, ...extra };
}

export async function maquinaFalsa(srv: ServidorCompleto, o: { nome: string; plataforma?: PlataformaMaquina; harnesses: Partial<Record<IdHarness, Inventario>>; contas?: ContaAnunciada[]; versaoApp?: string; atualizaIas?: boolean }): Promise<MaquinaFalsa> {
  const { chave, dados } = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: o.nome });
  let harnesses = o.harnesses;
  let contas = o.contas;
  let seq = 0;
  const pedir = (rota: string, corpo: unknown = {}) => fetch(`${srv.url}/api/maquina/${rota}`, {
    method: "POST",
    headers: { authorization: `Bearer ${chave}`, "content-type": "application/json", "x-nod-versao": o.versaoApp ?? "1.0.0-rc.9" },
    body: JSON.stringify(corpo),
  });
  const anuncio = () => ({
    nome: o.nome,
    plataforma: o.plataforma ?? "linux",
    versaoContrato: 1,
    inventario: harnesses["claude-cli"] ?? harnesses["codex-cli"] ?? PRONTO(),
    harnesses,
    sobreviveReinicio: true,
    ...(contas ? { contas } : {}),
    // A máquina que recebe o pedido de atualizar (reinstalar) a cópia da IA pela tela (NOD-9; o desvio 9 do lote B).
    ...(o.atualizaIas ? { atualizaIas: true } : {}),
  });
  const conectou = await pedir("conectar", anuncio());
  if (conectou.status !== 200) throw new Error(`maquinaFalsa ${o.nome}: conectar → ${conectou.status} ${await conectou.text()}`);
  const m: MaquinaFalsa = {
    id: dados.id,
    nome: o.nome,
    pedir,
    async anunciar() {
      const r = await pedir("inventario", anuncio());
      return r.status;
    },
    async puxar() {
      const r = await pedir("puxar");
      if (r.status !== 200) throw new Error(`maquinaFalsa ${o.nome}: puxar → ${r.status} ${await r.text()}`);
      return ((await r.json()) as { plano: PlanoTurno | null }).plano;
    },
    async puxarAte(prazoMs = 15_000, conversaId?: string) {
      const fim = Date.now() + prazoMs;
      while (Date.now() < fim) {
        const p = await m.puxar();
        if (p && conversaId && p.conversaId !== conversaId) {
          await m.entregar(p, { desfecho: "sucesso", texto: "Feito." });
          continue;
        }
        if (p) return p;
      }
      throw new Error(`maquinaFalsa ${o.nome}: nenhum plano em ${prazoMs} ms`);
    },
    async entregar(plano, r) {
      seq += 1;
      const texto = r.texto ?? "";
      const resultado: ResultadoTurno = { texto, sessaoCli: null, sinais: SINAIS, custoUsd: 0, tokens: TOKENS, ferramentasChamadas: [], negacoesPermissao: [], ...r };
      const resp = await pedir("entregar", { turnoId: plano.turnoId, machineId: dados.id, seqLocal: seq, fala: { tipo: "texto", texto }, resultado });
      return resp.status;
    },
    async mudar(n) {
      if (n.harnesses) harnesses = n.harnesses;
      if (n.contas) contas = n.contas;
      await m.anunciar();
    },
  };
  return m;
}
