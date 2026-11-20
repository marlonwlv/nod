import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { abrirVncDocker, VNC_DOCKER_FILA_MAX_BYTES } from "../../../src/adapters/computador/docker.ts";
import { criarSessoesVivo, type LadoVivo } from "../../../src/adapters/computador/vivo.ts";

const RAIZ = join(import.meta.dirname, "../../..");
const ID = "11111111-2222-4333-8444-555555555555";

function processoFalso() {
  const stdout = new EventEmitter();
  const stdin = Object.assign(new EventEmitter(), { writableLength: 0, write: vi.fn(() => true), end: vi.fn() });
  const processo = Object.assign(new EventEmitter(), { stdout, stdin, stderr: new EventEmitter(), kill: vi.fn(() => true) });
  const spawn = vi.fn(() => processo);
  return { processo, stdout, stdin, spawn };
}

function ladoFalso() {
  let dados: ((bytes: Uint8Array) => void) | null = null;
  let fechou: (() => void) | null = null;
  const recebidos: Uint8Array[] = [];
  const lado: LadoVivo = {
    enviar: (bytes) => recebidos.push(bytes),
    aoDados: (fn) => { dados = fn; },
    aoFechar: (fn) => { fechou = fn; },
    fechar: () => { fechou?.(); },
  };
  return { lado, recebidos, chegou: (bytes: Uint8Array) => dados?.(bytes) };
}

describe("VNC contínuo do Docker", () => {
  it("a imagem sobe x11vnc somente em socket Unix e não publica porta", () => {
    const dockerfile = readFileSync(join(RAIZ, "infra/computador/Dockerfile"), "utf8");
    const runtime = readFileSync(join(RAIZ, "infra/computador/runtime.mjs"), "utf8");
    const ponte = readFileSync(join(RAIZ, "infra/computador/vnc-bridge.mjs"), "utf8");
    expect(dockerfile).toContain("x11vnc");
    expect(dockerfile).not.toMatch(/^EXPOSE\s/im);
    expect(runtime).toContain("'-rfbport','0','-rfbportv6','0','-unixsock','/tmp/nod-vnc.sock'");
    expect(ponte).toContain("path: '/tmp/nod-vnc.sock'");
    expect(ponte).not.toMatch(/listen\s*\(/);
    expect(ponte).toContain("process.stdin.destroy()");
  });

  it("atravessa relay → docker exec → ponte VNC em bytes e fecha os dois lados", async () => {
    const f = processoFalso();
    const fluxo = await abrirVncDocker(ID, f.spawn);
    const dados = vi.fn();
    const fechou = vi.fn();
    fluxo.aoDados(dados);
    fluxo.aoFechar(fechou);
    f.stdout.emit("data", Buffer.from([1, 2, 3]));
    fluxo.enviar(Uint8Array.from([4, 5]));
    expect(f.spawn).toHaveBeenCalledWith("docker", ["exec", "-i", `nod-computador-${ID}`, "node", "/opt/nod/vnc-bridge.mjs"], { stdio: ["pipe", "pipe", "pipe"] });
    expect(dados).toHaveBeenCalledWith(Buffer.from([1, 2, 3]));
    expect(f.stdin.write).toHaveBeenCalledWith(Buffer.from([4, 5]));
    fluxo.fechar(1000);
    expect(f.stdin.end).toHaveBeenCalledOnce();
    expect(f.processo.kill).toHaveBeenCalledWith("SIGTERM");
    expect(fechou).toHaveBeenCalledOnce();
  });

  it("preserva o greeting que o x11vnc envia antes do pareamento", async () => {
    const f = processoFalso();
    const fluxo = await abrirVncDocker(ID, f.spawn);
    f.stdout.emit("data", Buffer.from("RFB 003.008\n"));
    f.stdout.emit("data", Buffer.from([1, 1]));

    const dados = vi.fn();
    fluxo.aoDados(dados);

    expect(dados).toHaveBeenCalledOnce();
    expect(dados).toHaveBeenCalledWith(Buffer.concat([Buffer.from("RFB 003.008\n"), Buffer.from([1, 1])]));
  });

  it("fecha o processo se a saída anterior ao pareamento passa do teto", async () => {
    const f = processoFalso();
    const fluxo = await abrirVncDocker(ID, f.spawn);
    const fechou = vi.fn();
    fluxo.aoFechar(fechou);
    f.stdout.emit("data", Buffer.alloc(VNC_DOCKER_FILA_MAX_BYTES));
    f.stdout.emit("data", Buffer.from([1]));

    expect(f.processo.kill).toHaveBeenCalledWith("SIGTERM");
    expect(fechou).toHaveBeenCalledOnce();
  });

  it("prova web → relay escopado → docker exec → VNC nos dois sentidos", async () => {
    const f = processoFalso();
    const origemDocker = await abrirVncDocker(ID, f.spawn);
    const web = ladoFalso();
    const sessoes = criarSessoesVivo();
    const { sessao, token } = sessoes.abrir({
      escopo: { tenantId: "00000000-0000-4000-8000-0000000000a1", pessoaId: "00000000-0000-4000-8000-0000000000b1" },
      agenteId: "agente-1",
      web: web.lado,
      conferir: async () => true,
    });
    expect(sessoes.anexarMotor(sessao, token, origemDocker)).toBe(true);

    web.chegou(Buffer.from("RFB 003.008\n"));
    expect(f.stdin.write).toHaveBeenCalledWith(Buffer.from("RFB 003.008\n"));
    f.stdout.emit("data", Buffer.from([0, 0, 0, 1]));
    expect(web.recebidos).toEqual([Buffer.from([0, 0, 0, 1])]);

    f.stdout.emit("end");
    expect(sessoes.abertas()).toEqual([]);
  });

  it("derruba a ponte quando a fila de entrada passa do teto", async () => {
    const f = processoFalso();
    f.stdin.writableLength = VNC_DOCKER_FILA_MAX_BYTES;
    const fluxo = await abrirVncDocker(ID, f.spawn);
    const fechou = vi.fn();
    fluxo.aoFechar(fechou);
    fluxo.enviar(Uint8Array.from([1]));
    expect(f.stdin.write).not.toHaveBeenCalled();
    expect(f.processo.kill).toHaveBeenCalledWith("SIGTERM");
    expect(fechou).toHaveBeenCalledOnce();
  });

  it("avisa a sessão quando o VNC fecha a saída antes do docker exec", async () => {
    const f = processoFalso();
    const fluxo = await abrirVncDocker(ID, f.spawn);
    const fechou = vi.fn();
    fluxo.aoFechar(fechou);
    f.stdout.emit("end");
    expect(fechou).toHaveBeenCalledOnce();
    expect(f.processo.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
