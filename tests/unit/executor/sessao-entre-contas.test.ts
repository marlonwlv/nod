import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ondeEstaASessao, outrasPastasDeConta, trazerSessaoDeOutraConta } from "../../../src/adapters/executor/sessao-entre-contas.ts";

const SESSAO = "9bb58e2c-30eb-4f85-8a0b-305f46b1eeb0";

/** A casa da máquina com as pastas de conta lado a lado, como na nod-motor-teste (executor/claude-cli/<conta>). */
async function maquina() {
  const home = await mkdtemp(join(tmpdir(), "nod-casa-"));
  const contas = join(home, "executor", "claude-cli");
  const antiga = join(contas, "c-antiga");
  const atual = join(contas, "c-atual");
  await mkdir(join(antiga, "projects", "-home-nod-nod-Clarice", SESSAO, "subagents"), { recursive: true });
  await writeFile(join(antiga, "projects", "-home-nod-nod-Clarice", `${SESSAO}.jsonl`), '{"type":"user"}\n');
  await writeFile(join(antiga, "projects", "-home-nod-nod-Clarice", SESSAO, "subagents", "a.jsonl"), "{}\n");
  await mkdir(join(atual, "projects", "-home-nod-nod-Ada"), { recursive: true });
  return { home, antiga, atual };
}

describe("a sessão do Claude que mora em outra conta da máquina (2026-11-20)", () => {
  it("copia o transcript e a pasta ao lado para a conta do turno; a de origem fica como estava", async () => {
    const m = await maquina();
    expect(await ondeEstaASessao(m.atual, SESSAO)).toBeNull();
    expect(await trazerSessaoDeOutraConta({ sessao: SESSAO, configDir: m.atual, home: m.home })).toEqual({ trouxe: true, de: "c-antiga" });
    const destino = join(m.atual, "projects", "-home-nod-nod-Clarice");
    expect(await ondeEstaASessao(m.atual, SESSAO)).toBe(destino);
    expect(await readFile(join(destino, SESSAO, "subagents", "a.jsonl"), "utf8")).toBe("{}\n");
    expect(await ondeEstaASessao(m.antiga, SESSAO)).toBe(join(m.antiga, "projects", "-home-nod-nod-Clarice"));
    // Na volta seguinte já está: nada a copiar.
    expect(await trazerSessaoDeOutraConta({ sessao: SESSAO, configDir: m.atual, home: m.home })).toEqual({ trouxe: false, motivo: "ja_estava" });
  });

  it("nunca sobrescreve a sessão que a conta do turno já tem", async () => {
    const m = await maquina();
    const propria = join(m.atual, "projects", "-home-nod-nod-Clarice");
    await mkdir(propria, { recursive: true });
    await writeFile(join(propria, `${SESSAO}.jsonl`), "minha\n");
    expect(await trazerSessaoDeOutraConta({ sessao: SESSAO, configDir: m.atual, home: m.home })).toEqual({ trouxe: false, motivo: "ja_estava" });
    expect(await readFile(join(propria, `${SESSAO}.jsonl`), "utf8")).toBe("minha\n");
  });

  it("acha no ~/.claude da conta padrão; sem a sessão em lugar nenhum, diz que não achou", async () => {
    const m = await maquina();
    const padrao = join(m.home, ".claude", "projects", "-home-nod-nod-Ada");
    const outra = "11111111-2222-3333-4444-555555555555";
    await mkdir(padrao, { recursive: true });
    await writeFile(join(padrao, `${outra}.jsonl`), "{}\n");
    expect(await trazerSessaoDeOutraConta({ sessao: outra, configDir: m.atual, home: m.home })).toEqual({ trouxe: true, de: ".claude" });
    expect(await trazerSessaoDeOutraConta({ sessao: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", configDir: m.atual, home: m.home })).toEqual({ trouxe: false, motivo: "nao_achou" });
  });

  it("id que não é uuid não vira caminho; conta padrão não procura nas pastas da casa", async () => {
    const m = await maquina();
    expect(await trazerSessaoDeOutraConta({ sessao: "../../etc/passwd", configDir: m.atual, home: m.home })).toEqual({ trouxe: false, motivo: "id_invalido" });
    expect(await outrasPastasDeConta(undefined, m.home)).toEqual([]);
    expect((await outrasPastasDeConta(m.atual, m.home)).sort()).toEqual([join(m.home, ".claude"), m.antiga].sort());
  });
});
