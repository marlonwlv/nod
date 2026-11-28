import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ligarNavegadorLocal } from "../../../desktop/navegador-local.ts";
import { CANAIS_NAVEGADOR_LOCAL } from "../../../src/contracts/navegador-local.ts";
import type { MotorNavegador } from "../../../src/adapters/navegador/motor-agent-browser.ts";
import type { StreamDoNavegador } from "../../../src/adapters/navegador/stream-local.ts";
import { criarVistaLocal, type VistaLocal } from "../../../src/adapters/navegador/vista-local.ts";
import { gravarEnderecoVistaLocal, lerEnderecoVistaLocal } from "../../../src/adapters/navegador/endereco-vista-local.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 2026-11-28: a ponte do app (processo principal) entre a janela web e a vista local da máquina. O ipcMain e a janela são
 * falsos; a vista local é a de verdade, com motor e stream falsos. O WebSocket é o `ws` (no app, o global do Electron).
 */
const BOT = "00000000-0000-4000-8000-0000000000c1";
const vistas: VistaLocal[] = [];
afterEach(async () => { for (const v of vistas.splice(0)) await v.parar(); });

type Handler = (e: unknown, ...a: unknown[]) => unknown;

function montar(o: { semChrome?: boolean; recusar?: boolean } = {}) {
  const handlers = new Map<string, Handler>();
  let leitor: (t: string) => void = () => undefined;
  const motor = { portaDoStream: async () => (o.semChrome ? null : 1) } as unknown as MotorNavegador;
  const stream: StreamDoNavegador = { enviar: () => undefined, fechar: () => undefined, aoMensagem: (fn) => { leitor = fn; }, aoFechar: () => undefined };
  const v = criarVistaLocal({ motor: async () => motor, conectarStream: async () => stream, relay: async () => true });
  vistas.push(v);
  const recebidas: { id: string; texto: string }[] = [];
  const janela = { isDestroyed: () => false, send: (_c: string, id: string, texto: string) => recebidas.push({ id, texto }), once: () => undefined };
  const evento = { sender: janela };
  ligarNavegadorLocal({
    ipcMain: { handle: (canal: string, fn: Handler) => { handlers.set(canal, fn); } } as never,
    endereco: () => v.iniciar(),
    validar: () => { if (o.recusar) throw new Error("origem_invalida"); },
    WS: WebSocket as never,
  });
  const chamar = (canal: string, ...a: unknown[]) => handlers.get(canal)!(evento, ...a) as Promise<unknown>;
  return { chamar, recebidas, mandarDoStream: (m: object) => leitor(JSON.stringify(m)) };
}

describe("a ponte do app para a vista local", () => {
  it("abre, os quadros descem com o id e a entrada sobe e volta confirmada", async () => {
    const { chamar, recebidas, mandarDoStream } = montar();
    const id = await chamar(CANAIS_NAVEGADOR_LOCAL.abrir, BOT);
    expect(typeof id).toBe("string");
    await new Promise((r) => setTimeout(r, 30));
    mandarDoStream({ type: "frame", data: "/9j/AA", metadata: { deviceWidth: 10, deviceHeight: 10 } });
    await new Promise((r) => setTimeout(r, 30));
    expect(recebidas).toEqual([{ id, texto: JSON.stringify({ type: "frame", data: "/9j/AA", metadata: { deviceWidth: 10, deviceHeight: 10 } }) }]);
    // Sem o CDP, a tecla vai pelo relay (falso, que confirma).
    expect(await chamar(CANAIS_NAVEGADOR_LOCAL.enviar, id, { t: "tecla", evento: "char", texto: "a" })).toBe(true);
    expect(await chamar(CANAIS_NAVEGADOR_LOCAL.enviar, "outro", { t: "tecla", evento: "char", texto: "a" })).toBe(false);
    await chamar(CANAIS_NAVEGADOR_LOCAL.fechar, id);
    expect(await chamar(CANAIS_NAVEGADOR_LOCAL.enviar, id, { t: "tecla", evento: "char", texto: "a" })).toBe(false);
  });

  it("sem o Chrome do bot neste computador, abrir devolve null; bot fora do formato também", async () => {
    const { chamar } = montar({ semChrome: true });
    expect(await chamar(CANAIS_NAVEGADOR_LOCAL.abrir, BOT)).toBeNull();
    expect(await chamar(CANAIS_NAVEGADOR_LOCAL.abrir, "../../x")).toBeNull();
  });

  it("de fora da janela web do servidor, recusa", async () => {
    const { chamar } = montar({ recusar: true });
    await expect(chamar(CANAIS_NAVEGADOR_LOCAL.abrir, BOT)).rejects.toThrow("origem_invalida");
  });
});

describe("o endereço da vista local no PC (o motor grava, o app lê)", () => {
  it("ida e volta; arquivo torto ou ausente é null", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "nod-vl-"));
    try {
      expect(await lerEnderecoVistaLocal(pasta)).toBeNull();
      await gravarEnderecoVistaLocal(pasta, { porta: 51234, token: "x".repeat(43) });
      expect(await lerEnderecoVistaLocal(pasta)).toEqual({ porta: 51234, token: "x".repeat(43) });
      await writeFile(join(pasta, "vista-local.json"), JSON.stringify({ porta: 99999, token: "curto" }));
      expect(await lerEnderecoVistaLocal(pasta)).toBeNull();
    } finally {
      await rm(pasta, { recursive: true, force: true });
    }
  });
});
