import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { criarAvisoNavegadorMudou, INTERVALO_AVISO_MS, type DadosNavegadorMudou } from "../../../src/adapters/navegador/aviso-mudou.ts";
import type { VistaNavegador } from "../../../src/contracts/navegador-do-bot.ts";

/** O frame `navegador.mudou` (ADR-190): só o bot e os campos que mudaram, no máximo ~4 por segundo por bot. */
const ESCOPO = { tenantId: "t", pessoaId: "p" };
const vista = (o: Partial<VistaNavegador> = {}) => ({ agenteId: "a", estado: "ao_vivo", controle: "bot", abas: [], atividadeEm: 0, ...o }) as never as VistaNavegador;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it("o primeiro sai na hora; os do meio se juntam no próximo; o que voltou ao que era não sai", () => {
  const saidos: { pessoaId: string; dados: DadosNavegadorMudou }[] = [];
  const aviso = criarAvisoNavegadorMudou({ publicar: (pessoaId, dados) => saidos.push({ pessoaId, dados }), agora: () => Date.now() });
  aviso.mudou(ESCOPO, vista());
  expect(saidos).toHaveLength(1);
  aviso.mudou(ESCOPO, vista({ controle: "pessoa" }));
  aviso.mudou(ESCOPO, vista({ controle: "pessoa", atividadeEm: 5 }));
  aviso.mudou(ESCOPO, vista({ controle: "pessoa", estado: "pausa", atividadeEm: 5 }));
  expect(saidos).toHaveLength(1);
  vi.advanceTimersByTime(INTERVALO_AVISO_MS);
  expect(saidos[1]).toEqual({ pessoaId: "p", dados: { agenteId: "a", mudou: ["estado", "controle", "atividadeEm"] } });
  // Dentro da janela: muda e volta ao que era; a próxima saída compara com a última publicada e não tem o que dizer.
  aviso.mudou(ESCOPO, vista({ controle: "bot", estado: "pausa", atividadeEm: 5 }));
  aviso.mudou(ESCOPO, vista({ controle: "pessoa", estado: "pausa", atividadeEm: 5 }));
  vi.advanceTimersByTime(INTERVALO_AVISO_MS);
  expect(saidos).toHaveLength(2);
  // Outro bot tem a própria janela.
  aviso.mudou(ESCOPO, vista({ agenteId: "b" }));
  expect(saidos[2]!.dados.agenteId).toBe("b");
  aviso.parar();
});
