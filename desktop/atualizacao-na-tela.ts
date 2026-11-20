/**
 * ADR-188: o que a janela web vê e pede da atualização do app. Sem Electron em tempo de execução (o estado, a decisão do
 * reinício e as preferências entram e saem como dados), testável em tests/unit/desktop/atualizacao-na-tela.test.ts.
 */
import type { AtualizacaoNaTela, PedidoReinicio, RespostaReinicio } from "../src/contracts/desktop-atualizacao.ts";
import { compararVersoesDoApp } from "../src/domain/versao-app.ts";
import type { EstadoAtualizacaoApp } from "./atualizacao.ts";

export type ExtrasNaTela = {
  versaoAtual: string;
  esperandoLivre: boolean;
  reiniciando: boolean;
  sozinho: boolean | null;
  atualizadoDe: string | null;
};

export function estadoNaTela(e: EstadoAtualizacaoApp, x: ExtrasNaTela): AtualizacaoNaTela {
  return {
    fase: e.fase,
    versaoAtual: x.versaoAtual,
    versaoNova: e.fase === "pronta" ? e.versao : null,
    motivo: e.fase === "desligada" ? e.motivo : e.fase === "erro" ? e.mensagem : null,
    procuradaEm: e.fase === "ociosa" ? e.procuradaEm : null,
    // Fora de "pronta" não há o que esperar (um erro numa procura posterior não desarma: a versão baixada continua valendo).
    esperandoLivre: e.fase === "pronta" && x.esperandoLivre,
    reiniciando: x.reiniciando,
    sozinho: x.sozinho,
    atualizadoDe: x.atualizadoDe,
  };
}

export type SinaisReinicio = { pronta: boolean; emLigacao: boolean; turnos: number; telas: number };

/**
 * O que fazer com o pedido da tela. `reiniciar` = o processo principal chama o reinício já confirmado (a tela perguntou o
 * que precisava); `esperar` = arma o "quando terminar"; `cancelar` = desarma. A ligação aberta sempre recusa, inclusive
 * no "Reiniciar agora" da pergunta (ADR-149, item 7).
 */
export function decidirReinicio(p: PedidoReinicio, s: SinaisReinicio): { fazer: "reiniciar" | "esperar" | "cancelar" | "nada"; resposta: RespostaReinicio } {
  if (p.quando === "cancelarEspera") return { fazer: "cancelar", resposta: { ok: true, esperando: false } };
  if (!s.pronta) return { fazer: "nada", resposta: { ok: false, motivo: "naoPronta" } };
  if (s.emLigacao) return { fazer: "nada", resposta: { ok: false, motivo: "emLigacao" } };
  const ocupado = s.turnos > 0 || s.telas > 0;
  if (p.quando === "quandoLivre") return ocupado ? { fazer: "esperar", resposta: { ok: true, esperando: true } } : { fazer: "reiniciar", resposta: { ok: true, esperando: false } };
  if (p.quando === "agora" && ocupado) return { fazer: "nada", resposta: { ok: false, motivo: "ocupado", turnos: s.turnos, telas: s.telas } };
  return { fazer: "reiniciar", resposta: { ok: true, esperando: false } };
}

/** O "quando terminar" armado vira reinício quando nada mais roda e não há ligação. */
export function livreParaReiniciar(s: SinaisReinicio): boolean {
  return s.pronta && !s.emLigacao && s.turnos === 0 && s.telas === 0;
}

export type PrefsAtualizacao = { reiniciarSozinho: boolean; ultimaVersao: string | null };

/** preferencias.json: sem o campo, reiniciar sozinho nasce ligado (era o comportamento da ADR-173 antes do interruptor). */
export function lerPrefsAtualizacao(conteudo: string | null): PrefsAtualizacao {
  let obj: unknown = null;
  try { obj = conteudo === null ? null : JSON.parse(conteudo); } catch { /* corrompido: o padrão */ }
  const o = typeof obj === "object" && obj !== null ? obj : {};
  const sozinho = "reiniciarSozinho" in o && typeof o.reiniciarSozinho === "boolean" ? o.reiniciarSozinho : true;
  const ultima = "ultimaVersao" in o && typeof o.ultimaVersao === "string" && o.ultimaVersao.length <= 32 ? o.ultimaVersao : null;
  return { reiniciarSozinho: sozinho, ultimaVersao: ultima };
}

/**
 * A versão de antes, quando o app voltou maior do que a última vez que abriu (o aviso "nod atualizado para…"). Primeira
 * vez (sem registro), mesma versão, versão menor ou inválida: nada.
 */
export function atualizadoDe(ultimaVersao: string | null, atual: string): string | null {
  if (!ultimaVersao) return null;
  const c = compararVersoesDoApp(atual, ultimaVersao);
  return c !== null && c > 0 ? ultimaVersao : null;
}

const PEDIDOS: readonly PedidoReinicio["quando"][] = ["agora", "forcar", "quandoLivre", "cancelarEspera"];

/** O pedido que veio da página, validado (o processo principal não confia no formato). */
export function lerPedidoReinicio(v: unknown): PedidoReinicio | null {
  if (typeof v !== "object" || v === null || !("quando" in v)) return null;
  const q = (v as { quando: unknown }).quando;
  return typeof q === "string" && (PEDIDOS as readonly string[]).includes(q) ? { quando: q as PedidoReinicio["quando"] } : null;
}
