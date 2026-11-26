import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARQUIVO_ATIVIDADE, lerAtividade, pedirParada, publicarAtividade, vigiarAtividade, vigiarParada } from "../../../src/adapters/seu-computador/sinal-entre-processos.ts";

/** ADR-197 no PC: o motor publica cada ação e ouve o Parar; o app desenha a ilha. Pelos arquivos de verdade, numa pasta temporária. */
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const A = { agenteId: "00000000-0000-4000-8000-00000000000a", bot: "Ada", app: "Excel", acao: "digitar", em: 0, janela: { x: 10, y: 20, largura: 800, altura: 600 } };

describe("a ilha do PC entre o motor e o app", () => {
  it("lê a atividade conferida; velha, do futuro ou torta não acende a ilha", () => {
    expect(lerAtividade(JSON.stringify({ ...A, em: 1000 }), 2000)).toEqual({ ...A, em: 1000 });
    expect(lerAtividade(JSON.stringify({ ...A, em: 1000 }), 1000 + 16_000)).toBeNull();
    expect(lerAtividade(JSON.stringify({ ...A, em: 10_000_000 }), 0)).toBeNull();
    expect(lerAtividade("{", 0)).toBeNull();
    expect(lerAtividade(JSON.stringify({ ...A, em: 1000, janela: { x: "a" } }), 2000)).toMatchObject({ janela: null });
  });

  it("o motor publica e o app vê; o app pede Parar e o motor ouve", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "nod-sinal-"));
    const vistas: string[] = [];
    const desligarApp = vigiarAtividade(pasta, (a) => vistas.push(a.acao));
    let paradas = 0;
    const desligarMotor = vigiarParada(pasta, () => { paradas++; });
    publicarAtividade(pasta, { ...A, em: Date.now() });
    await esperar(1200);
    pedirParada(pasta, Date.now() + 1);
    await esperar(1300);
    desligarApp();
    desligarMotor();
    expect(vistas).toEqual(["digitar"]);
    expect(paradas).toBe(1);
    writeFileSync(join(pasta, ARQUIVO_ATIVIDADE), "torto");
  });
});

describe("a pessoa no PC (pessoa-windows)", () => {
  it("lê a resposta do PowerShell e o app da frente sem diferenciar maiúsculas", async () => {
    const { lerRespostaPessoa, criarPessoaWindows } = await import("../../../src/adapters/seu-computador/pessoa-windows.ts");
    expect(lerRespostaPessoa('{"frente":"C:\\\\Windows\\\\system32\\\\notepad.exe","ocioso":3}')).toEqual({ frente: "C:\\Windows\\system32\\notepad.exe", ociosoS: 3 });
    expect(lerRespostaPessoa('{"frente":"","ocioso":-1}')).toBeNull();
    expect(lerRespostaPessoa("torto")).toBeNull();
    const { EventEmitter } = await import("node:events");
    const { PassThrough } = await import("node:stream");
    const falso = () => {
      const p = new EventEmitter() as InstanceType<typeof EventEmitter> & { stdin: InstanceType<typeof PassThrough>; stdout: InstanceType<typeof PassThrough>; exitCode: number | null; kill(): void };
      p.stdin = new PassThrough(); p.stdout = new PassThrough(); p.exitCode = null; p.kill = () => undefined;
      p.stdin.on("data", () => p.stdout.write('{"frente":"C:\\\\Windows\\\\System32\\\\NOTEPAD.EXE","ocioso":0}\n'));
      return p;
    };
    const pessoa = criarPessoaWindows({ spawnar: falso as never, env: {} });
    expect(pessoa.ociosoS()).toBe(Number.POSITIVE_INFINITY);
    expect(await pessoa.naFrente("c:\\windows\\system32\\notepad.exe")).toBe(true);
    expect(pessoa.ociosoS()).toBe(0);
    expect(await pessoa.naFrente("C:\\Program Files\\App\\app.exe")).toBe(false);
  });
});
