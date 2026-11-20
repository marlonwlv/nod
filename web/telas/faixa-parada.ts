import type { FaixaParada } from "../../src/contracts/turno.ts";
import { esc, hora } from "../lib/render.ts";

const QUADRADO = '<svg class="faixa-parada-ic" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';

/**
 * Faixa de Parar (E5.4). Revista na validação de 2026-11-16: era uma caixa vermelha com contagens ("1 interrompida(s),
 * 0 não interrompida(s), 0 já entregue(s). Nada foi reenviado.") — alarme para uma ação que a própria pessoa fez. Como
 * no app de referência ("Stopped", rótulo cinza) e no bot-hq ("Stopped.", tom neutro): uma linha discreta na coluna do
 * bot, "Parado por você". Os números só aparecem quando contam algo que a pessoa não espera — um turno que NÃO parou
 * (com o motivo no title) ou uma resposta que já tinha saído. "Nada estava rodando" continua escrito. Some quando a
 * pessoa manda a próxima mensagem (main.ts) ou troca de tela (reducer).
 */
export function renderFaixaParada(f: FaixaParada | null): string {
  if (!f) return "";
  if (f.nadaRodando) return `<div class="faixa faixa-parada" role="status">${QUADRADO}<span>Nada estava rodando.</span></div>`;
  const extras: string[] = [];
  if (f.naoInterrompidas.length) {
    const motivos = f.naoInterrompidas.map((n) => `${n.turnoId.slice(0, 8)}: ${n.motivo}`).join("; ");
    extras.push(`<span title="${esc(motivos)}">${f.naoInterrompidas.length === 1 ? "1 continuou rodando" : `${f.naoInterrompidas.length} continuaram rodando`}</span>`);
  }
  if (f.jaEntregues.length) {
    const quando = f.jaEntregues.map((e) => `às ${hora(e.em)}`).join(", ");
    extras.push(`<span title="${esc(quando)}">${f.jaEntregues.length === 1 ? "1 resposta já tinha saído" : `${f.jaEntregues.length} respostas já tinham saído`}</span>`);
  }
  return `<div class="faixa faixa-parada" role="status">${QUADRADO}<span>Parado por você</span>${extras.map((x) => `<span class="faixa-parada-sep" aria-hidden="true">·</span>${x}`).join("")}</div>`;
}
