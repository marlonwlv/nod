import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { definirDestinoDoLog } from "../../../src/obs/log.ts";
import { iniciarVarredorExpiracao } from "../../../src/adapters/fundo/varredor-expiracao.ts";
import { ESPERA_APOS_ACORDAR_MS } from "../../../src/domain/presenca.ts";
import type { OpcoesVarredor } from "../../../src/adapters/fundo/varredor-expiracao.ts";
import type { Db } from "../../../src/shared/types.ts";

/**
 * NOD-386-bis (23/11): o mesmo "acordou → espera 3 min" do agendador (ADR-045), agora no varredor de
 * expiração — o tick que acorda não varre de uma vez todas as decisões vencidas acumuladas no sono.
 *
 * `tick()` avança um intervalo normal (uma volta real do setInterval); `dormir(ms)` simula o PC
 * dormindo `ms`: `agora()` salta, mas o timer só dispara UMA vez ao "acordar" (como o Node faz de
 * verdade — o processo suspenso não acumula disparos, só o próximo tick agendado chega atrasado).
 */

const SEM_BANCO = {} as Db;
const INTERVALO = 30_000;

let logs: { evento: string; laco?: string; parado_ms?: number }[];
let paradas: (() => void)[];
let agora: number;
let varreduras: number;

function opcoes(): OpcoesVarredor & { intervaloMs: number } {
  return {
    services: {} as OpcoesVarredor["services"],
    useCases: {} as OpcoesVarredor["useCases"],
    agora: () => agora,
    intervaloMs: INTERVALO,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  agora = 1_000_000;
  logs = [];
  varreduras = 0;
  paradas = [];
  definirDestinoDoLog((linha) => logs.push(JSON.parse(linha) as { evento: string }));
});
afterEach(() => {
  for (const p of paradas) p();
  definirDestinoDoLog(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function tick(): Promise<void> {
  agora += INTERVALO;
  await vi.advanceTimersByTimeAsync(INTERVALO);
}

async function dormir(ms: number): Promise<void> {
  agora += ms;
  await vi.advanceTimersByTimeAsync(INTERVALO); // só o próximo disparo agendado chega, atrasado
}

function iniciar(): { parar(): Promise<void> } {
  const laco = { listarPessoas: async () => { varreduras++; return []; } };
  const s = iniciarVarredorExpiracao(SEM_BANCO, opcoes(), laco);
  paradas.push(() => s.parar());
  return s;
}

describe("varredor de expiração depois de o Mac acordar (ADR-045)", () => {
  it("tick normal dispara a cada volta", async () => {
    iniciar();
    await tick();
    await tick();
    await tick();
    expect(varreduras).toBe(3);
    expect(logs.some((l) => l.evento === "processo_acordou")).toBe(false);
  });

  it("tick atrasado por carga (até 3 intervalos) não é tratado como sono", async () => {
    iniciar();
    await tick();
    expect(varreduras).toBe(1);
    await dormir(3 * INTERVALO); // exatamente 3 intervalos: ainda não é suspensão (processoAcordou exige MAIS que 3)
    expect(varreduras).toBe(2);
    expect(logs.some((l) => l.evento === "processo_acordou")).toBe(false);
  });

  it("salto de relógio maior que 3 intervalos (o PC dormiu) segura a próxima varredura por 3 min e loga processo_acordou", async () => {
    iniciar();
    await tick();
    expect(varreduras).toBe(1);

    await dormir(2 * 3_600_000); // o PC dorme 2 h
    expect(varreduras).toBe(1); // o tick que acorda NÃO varre
    expect(logs).toContainEqual(expect.objectContaining({ evento: "processo_acordou", laco: "varredor_expiracao", parado_ms: 2 * 3_600_000 }));

    // Ticks normais durante a espera continuam sem varrer.
    const voltasDaEspera = ESPERA_APOS_ACORDAR_MS / INTERVALO;
    for (let i = 1; i < voltasDaEspera; i++) {
      await tick();
      expect(varreduras).toBe(1);
    }
    // Passados os 3 min, o varredor volta a disparar.
    await tick();
    expect(varreduras).toBe(2);
  });
});
