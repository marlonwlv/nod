import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const limpar: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const f of limpar.splice(0).reverse()) await f(); });

describe("cliente de uma resposta do supervisor", () => {
  it("imprime uma única foto quando batimentos concorrentes repetem o estado", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nod-cliente-unico-"));
    limpar.push(() => rm(dir, { recursive: true, force: true }));
    const socket = join(dir, "controle.sock");
    const computadorId = "11111111-2222-4333-8444-555555555555";
    const servidor = createServer((conexao) => {
      conexao.once("data", () => {
        const linha = `${JSON.stringify({ tipo: "estado", computadorId, supervisorPub: "pub" })}\n`;
        conexao.write(linha + linha);
      });
    });
    await new Promise<void>((resolve) => servidor.listen(socket, resolve));
    limpar.push(() => new Promise((resolve) => servidor.close(() => resolve(undefined))));

    const filho = spawn(process.execPath, ["infra/computador/cliente-unico.mjs"], {
      env: { ...process.env, NOD_PC_SOCKET: socket }, stdio: ["pipe", "pipe", "pipe"],
    });
    filho.stdin.end(JSON.stringify({ comando: { id: "sonda", computadorId }, sonda: true }));
    let saida = "";
    filho.stdout.on("data", (b) => { saida += b.toString(); });
    await new Promise<void>((resolve, reject) => {
      filho.on("error", reject);
      filho.on("close", (codigo) => codigo === 0 ? resolve() : reject(new Error(`cliente saiu ${codigo}`)));
    });
    expect(JSON.parse(saida)).toMatchObject({ estado: { computadorId, supervisorPub: "pub" } });
  });
});
