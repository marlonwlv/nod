import type { AcaoComputador } from "../contracts/computador.ts";
import type { EstadoComputadorRelatado } from "../contracts/computador-motor.ts";
import { PRESENCA_MULTIPLICA_SONO, type DadosFrameCursor, type DadosFrameMaquina } from "../contracts/estado-vivo.ts";

/**
 * D (definido em 2026-11-12): o computador do bot ao vivo. Puro: o cursor que cada ação desenha, o estado da máquina que
 * vai no stream e o limite de sono com a presença da pessoa.
 */

export type PosicaoCursor = { x: number; y: number };

/** O botão do xdotool (1 esquerdo, 2 meio, 3 direito) no nome do frame. */
const BOTOES: Record<number, DadosFrameCursor["botao"]> = { 1: "esquerdo", 2: "meio", 3: "direito" };

/**
 * O frame `computador.cursor` de uma ação mandada ao computador, ou null para a que não mexe no ponteiro (observar,
 * navegar, terminal, arquivos…). O cursor fica onde a ação terminou: o arrastar vai ao destino; o rolar, o digitar e a
 * tecla acontecem onde ele estava (`ultimo`; sem nenhum ainda, não sai frame — não há onde desenhar).
 */
export function cursorDaAcao(acao: AcaoComputador, bot: string, ultimo: PosicaoCursor | null, em: number): DadosFrameCursor | null {
  const base = { bot, botao: null, contagem: 0, em };
  switch (acao.tipo) {
    case "clicar":
      return { ...base, tipo: "clicar", x: acao.x, y: acao.y, botao: BOTOES[acao.botao ?? 1] ?? "esquerdo", contagem: acao.vezes ?? 1 };
    case "arrastar":
      return { ...base, tipo: "arrastar", x: acao.destinoX, y: acao.destinoY };
    case "rolar":
      return ultimo ? { ...base, tipo: "rolar", x: ultimo.x, y: ultimo.y } : null;
    case "digitar":
    case "tecla":
      return ultimo ? { ...base, tipo: "digitar", x: ultimo.x, y: ultimo.y } : null;
    default:
      return null;
  }
}

/** O estado da máquina no stream, a partir da foto do supervisor. */
export function maquinaNoStream(maquinaId: string, r: EstadoComputadorRelatado, presente: boolean, em: number): DadosFrameMaquina {
  return {
    maquinaId,
    ligado: r.ligado,
    operacao: r.operacao ? { tipo: r.operacao.tipo, pct: Math.max(0, Math.min(100, Math.round(r.operacao.pct))) } : null,
    telas: r.telas.map((t) => ({ bot: t.agenteId, estado: t.estado, ultimaAcaoEm: t.ultimaAcaoEm, memoriaMb: t.memoriaMb })),
    memoriaTotalMb: r.memoriaTotalMb ?? null,
    presente,
    em,
  };
}

/** A memória em degraus de 10% do total (ou de 256 MB sem o total): a foto que só oscila a memória não vira frame. */
const degrau = (mb: number | null, total: number | null) => (mb === null ? null : Math.round(mb / Math.max(1, total ? total / 10 : 256)));

/**
 * A chave do que importa no estado: muda quando liga/desliga, a operação anda 10%, uma tela abre/fecha ou a memória sobe de
 * degrau. Frames com a mesma chave não saem de novo (a foto chega a cada poucos segundos).
 */
export function chaveDaMaquina(d: DadosFrameMaquina): string {
  return JSON.stringify([d.ligado, d.operacao ? [d.operacao.tipo, Math.floor(d.operacao.pct / 10)] : null, d.presente, d.telas.map((t) => [t.bot, t.estado, degrau(t.memoriaMb, d.memoriaTotalMb)])]);
}

/** O limite de ociosidade valendo agora: com a pessoa presente, o sono espera `PRESENCA_MULTIPLICA_SONO` vezes mais. */
export function limiteDoSono(limiteMs: number, presente: boolean): number {
  return presente ? limiteMs * PRESENCA_MULTIPLICA_SONO : limiteMs;
}
