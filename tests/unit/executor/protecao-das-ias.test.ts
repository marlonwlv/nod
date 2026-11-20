import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { binarioDoPacote, protegerIasDoNod, resolverBinarioDetalhado } from "../../../src/adapters/executor/caminho.ts";

/**
 * Definido em 2026-11-19: na nod-motor-teste um bot trocou o `~/.local/bin/claude` por um script que recusava
 * `claude auth login`, e o login pela tela falhava sem dizer por quê. Com a proteção do motor, o binário do PATH só vale
 * se for um arquivo do pacote que o nod instalou em `~/.local/lib/node_modules`.
 */
describe("proteção das IAs do nod (o claude do PATH trocado)", () => {
  let casa: string;
  let prefixo: string;
  let bin: string;
  let trocas: { nome: string; achado: string | null; pacote: string }[];

  async function instalarPacote(pacote: string, pkgBin: unknown, arquivo: string): Promise<string> {
    const pasta = join(prefixo, "lib", "node_modules", ...pacote.split("/"));
    await mkdir(join(pasta, "bin"), { recursive: true });
    await writeFile(join(pasta, "package.json"), JSON.stringify({ name: pacote, bin: pkgBin }));
    const binario = join(pasta, arquivo);
    await writeFile(binario, "#!/bin/sh\necho real\n");
    await chmod(binario, 0o755);
    return binario;
  }

  beforeEach(async () => {
    casa = await mkdtemp(join(tmpdir(), "nod-protecao-"));
    prefixo = join(casa, ".local");
    bin = join(prefixo, "bin");
    await mkdir(bin, { recursive: true });
    trocas = [];
  });

  afterEach(async () => {
    protegerIasDoNod(null);
    await rm(casa, { recursive: true, force: true });
  });

  const proteger = () => protegerIasDoNod({ prefixo, aoTrocar: (t) => trocas.push(t) });

  it("o link que o npm criou para o pacote vale como está, sem aviso", async () => {
    const real = await instalarPacote("@anthropic-ai/claude-code", { claude: "bin/claude.exe" }, "bin/claude.exe");
    await symlink(real, join(bin, "claude"));
    proteger();
    expect(await resolverBinarioDetalhado(undefined, bin, casa)).toEqual({ caminho: join(bin, "claude"), origem: "path" });
    expect(trocas).toEqual([]);
  });

  it("um script no lugar do link: o nod usa o binário do pacote e avisa", async () => {
    const real = await instalarPacote("@anthropic-ai/claude-code", { claude: "bin/claude.exe" }, "bin/claude.exe");
    const script = join(bin, "claude");
    await writeFile(script, "#!/bin/sh\necho 'claude: gestão da conta não é permitida neste launcher' >&2\nexit 64\n");
    await chmod(script, 0o755);
    proteger();
    expect(await resolverBinarioDetalhado(undefined, bin, casa)).toEqual({ caminho: real, origem: "nod" });
    expect(trocas).toEqual([{ nome: "claude", achado: script, pacote: real }]);
  });

  it("sem a proteção (Mac, Windows), o script do PATH continua sendo o que vale", async () => {
    await instalarPacote("@anthropic-ai/claude-code", { claude: "bin/claude.exe" }, "bin/claude.exe");
    const script = join(bin, "claude");
    await writeFile(script, "#!/bin/sh\nexit 64\n");
    await chmod(script, 0o755);
    expect(await resolverBinarioDetalhado(undefined, bin, casa)).toEqual({ caminho: script, origem: "path" });
  });

  it("sem o pacote do nod (a IA instalada por fora), nada muda", async () => {
    const outro = join(bin, "claude");
    await writeFile(outro, "#!/bin/sh\necho outro\n");
    await chmod(outro, 0o755);
    proteger();
    expect(await resolverBinarioDetalhado(undefined, bin, casa)).toEqual({ caminho: outro, origem: "path" });
    expect(trocas).toEqual([]);
  });

  it("NOD_CLAUDE_BIN configurado ganha da proteção", async () => {
    await instalarPacote("@anthropic-ai/claude-code", { claude: "bin/claude.exe" }, "bin/claude.exe");
    const meu = join(casa, "meu-claude");
    await writeFile(meu, "#!/bin/sh\n");
    await chmod(meu, 0o755);
    proteger();
    expect(await resolverBinarioDetalhado(meu, bin, casa)).toEqual({ caminho: meu, origem: "configurado" });
    expect(trocas).toEqual([]);
  });

  it("o link apagado do PATH: o pacote ainda serve", async () => {
    const real = await instalarPacote("@anthropic-ai/claude-code", { claude: "bin/claude.exe" }, "bin/claude.exe");
    proteger();
    expect(await resolverBinarioDetalhado(undefined, bin, casa)).toEqual({ caminho: real, origem: "nod" });
    expect(trocas).toEqual([{ nome: "claude", achado: null, pacote: real }]);
  });

  it("vale também para o codex (bin em .js) e não toca em outros nomes", async () => {
    const real = await instalarPacote("@openai/codex", { codex: "bin/codex.js" }, "bin/codex.js");
    const script = join(bin, "codex");
    await writeFile(script, "#!/bin/sh\nexit 1\n");
    await chmod(script, 0o755);
    const gh = join(bin, "gh");
    await writeFile(gh, "#!/bin/sh\n");
    await chmod(gh, 0o755);
    proteger();
    expect(await resolverBinarioDetalhado(undefined, bin, casa, "codex")).toEqual({ caminho: real, origem: "nod" });
    expect(await resolverBinarioDetalhado(undefined, bin, casa, "gh")).toEqual({ caminho: gh, origem: "path" });
  });

  it("binarioDoPacote recusa um bin que sai da pasta do pacote", async () => {
    await instalarPacote("@anthropic-ai/claude-code", { claude: "../../../../bin/claude" }, "bin/claude.exe");
    expect(await binarioDoPacote(prefixo, "claude")).toBeNull();
  });
});
