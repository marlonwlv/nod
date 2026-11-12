import type { DadosFrameEstadoVivo, EstadoVivoBot, RetratoEstadoVivo } from "../contracts/estado-vivo.ts";
import { aplicarFrame, aplicarSinal, novaProjecao, type ProjecaoEstadoVivo, type RefDoTurno, type SinalDoMotor } from "../domain/estado-vivo.ts";
import type { Barramento } from "./barramento.ts";

/**
 * O estado vivo por bot como dado do servidor (definido em 2026-11-12). SEM BANCO: decora o barramento — todo frame
 * publicado passa pela projeção (src/domain/estado-vivo.ts) depois de sair, e cada bot que mudou sai num frame
 * `agente.estado` com o estado inteiro. O retrato (`retrato`) vai ao navegador quando o SSE conecta.
 *
 * Em memória por pessoa, como o buffer do barramento: o processo que reinicia começa vazio e se refaz com os próximos
 * frames (o turno que segue rodando volta a "rodando" no próximo frame do plano). Decisão aberta antes do reinício só
 * volta ao estado quando outra decisão do bot abrir ou fechar (gatilho de revisão: a tela pedir o retrato do banco).
 */
export interface EstadoVivo {
  /** O barramento decorado: publique por ele para a projeção ver o frame. */
  barramento: Barramento;
  /** Um sinal do motor que não vira frame (compondo, fim do bloco, pensando, texto). */
  sinal(pessoaId: string, ref: RefDoTurno, sinal: SinalDoMotor): void;
  retrato(pessoaId: string): RetratoEstadoVivo;
  estado(pessoaId: string, agenteId: string): EstadoVivoBot | null;
}

export function criarEstadoVivo(interno: Barramento, opcoes: { agora?: () => number } = {}): EstadoVivo {
  const agora = opcoes.agora ?? Date.now;
  const porPessoa = new Map<string, ProjecaoEstadoVivo>();
  const projecao = (pessoaId: string): ProjecaoEstadoVivo => {
    let p = porPessoa.get(pessoaId);
    if (!p) {
      p = novaProjecao();
      porPessoa.set(pessoaId, p);
    }
    return p;
  };
  const publicarMudancas = (pessoaId: string, p: ProjecaoEstadoVivo, agentes: readonly string[]): void => {
    for (const agenteId of agentes) {
      const estado = p.bots.get(agenteId)?.estado;
      if (estado) interno.publicar(pessoaId, "agente.estado", { agenteId, estado } satisfies DadosFrameEstadoVivo);
    }
  };

  const barramento: Barramento = {
    publicar(pessoaId, tipo, dados) {
      const f = interno.publicar(pessoaId, tipo, dados);
      if (tipo !== "agente.estado") {
        const p = projecao(pessoaId);
        publicarMudancas(pessoaId, p, aplicarFrame(p, tipo, dados, agora()));
      }
      return f;
    },
    inscrever: (pessoaId, fn) => interno.inscrever(pessoaId, fn),
    retomar: (pessoaId, since) => interno.retomar(pessoaId, since),
    posicao: (pessoaId) => interno.posicao(pessoaId),
    inscritos: (pessoaId) => interno.inscritos(pessoaId),
  };

  return {
    barramento,
    sinal(pessoaId, ref, s) {
      const p = projecao(pessoaId);
      publicarMudancas(pessoaId, p, aplicarSinal(p, ref, s, agora()));
    },
    retrato(pessoaId) {
      const p = porPessoa.get(pessoaId);
      return { agentes: p ? [...p.bots.values()].map((b) => b.estado) : [], em: agora() };
    },
    estado: (pessoaId, agenteId) => porPessoa.get(pessoaId)?.bots.get(agenteId)?.estado ?? null,
  };
}
