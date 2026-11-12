import type { EventoStream } from "../contracts/turno.ts";
import type { FalaDoMeio } from "./mensagem-no-meio.ts";
import { NARRACAO_MAX_CHARS } from "./stream-json.ts";

/**
 * Fala por bloco (definido em 2026-11-12, estado vivo item 1, para o C · Chat mostrar um balão inteiro por bloco): cada
 * bloco de texto fechado (`texto_bloco`, que o executor Claude solta no `content_block_stop` e o Codex no item de mensagem
 * concluído) vira uma mensagem própria assim que se sabe o que vem depois dele, sem esperar o `result` da volta.
 *
 * O que vem depois decide (o bloco fica pendente até o próximo evento que conta):
 *  - outro bloco de texto: o pendente sai como fala;
 *  - uma ferramenta: sai só se for relatório (> NARRACAO_MAX_CHARS, a mesma regra da comporFala); a frase curta antes da
 *    ferramenta é narração ("Categorizando lote de 11 e-mails") e continua só no cartão de atividade, como antes;
 *  - o `result` da volta: não sai aqui. O último bloco é a fala da volta, que já vai pelo caminho de sempre (a fala
 *    intermediária da sessão viva ou a entrega do turno), e assim a entrega nunca fica vazia.
 *
 * O bloco que sai é marcado em `falados` (o mesmo conjunto da fala do meio, ADR-083 §6), e a classificarResultado já o
 * tira da fala final e da fala da rodada: a pessoa não lê duas vezes. O bloco que a fala do meio já falou é pulado.
 */
export type FalaPorBloco = {
  /** Chamado com cada evento, na ordem, DEPOIS da fala do meio. Devolve o texto a gravar agora (ou null). */
  avaliar(ev: EventoStream): string | null;
};

/** Os eventos que não decidem nada sobre o bloco pendente (ruído entre o fim do bloco e o próximo conteúdo). */
const NEUTROS: ReadonlySet<EventoStream["tipo"]> = new Set<EventoStream["tipo"]>(["ignorado", "delta", "fase", "chamada", "rate_limit", "init"]);

export function criarFalaPorBloco(meio: Pick<FalaDoMeio, "falados" | "marcarFalado">): FalaPorBloco {
  let pendente: Extract<EventoStream, { tipo: "texto_bloco" }> | null = null;
  const sair = (): string | null => {
    const b = pendente;
    pendente = null;
    if (!b || meio.falados.has(b) || b.texto.trim() === "") return null;
    meio.marcarFalado(b);
    return b.texto;
  };
  return {
    avaliar(ev) {
      if (NEUTROS.has(ev.tipo)) return null;
      if (ev.tipo === "texto_bloco") {
        const fala = sair();
        pendente = ev;
        return fala;
      }
      if (ev.tipo === "tool_use") {
        if (pendente && pendente.texto.trim().length <= NARRACAO_MAX_CHARS) pendente = null;
        return sair();
      }
      if (ev.tipo === "result") pendente = null;
      return null;
    },
  };
}
