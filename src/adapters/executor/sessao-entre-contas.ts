import { constants } from "node:fs";
import { access, copyFile, cp, mkdir, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * A sessão do Claude Code mora na pasta da conta que a criou (`<CLAUDE_CONFIG_DIR>/projects/<cwd>/<sessão>.jsonl`), mas o
 * servidor retoma a conversa do Claude em qualquer conta da máquina (emitir-plano-turno.ts: só o Codex fica preso à conta
 * da sessão). Medido em 2026-11-20 na nod-motor-teste: a conversa da Clarice nasceu na conta do gmail (`c-46d88d1f`), a
 * conta saiu da lista da máquina, os turnos passaram a rodar na da Leapy (`c-7560b61d`) e todo `--resume` morria em ~4 s
 * sem chamar a IA — "a IA parou por um erro" em toda fala, até no "oi".
 *
 * Antes do `--resume`, o driver traz a sessão para a pasta da conta do turno: procura nas outras pastas de conta da mesma
 * máquina (as irmãs da pasta da conta e o ~/.claude) e COPIA o transcript e a pasta ao lado (subagentes, resultados de
 * ferramenta). Copiar, não mover: a conta de origem, se voltar, segue retomando a dela. Nunca sobrescreve.
 */

/** O id de sessão que o nod gera e grava (uuid); qualquer outra coisa não vira caminho. */
const ID_DE_SESSAO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const existe = (p: string) => access(p).then(() => true, () => false);

/** A pasta do projeto (`projects/<cwd>`) onde a sessão está nesta pasta de conta, ou null. */
export async function ondeEstaASessao(configDir: string, sessao: string): Promise<string | null> {
  if (!ID_DE_SESSAO.test(sessao)) return null;
  const projetos = join(configDir, "projects");
  const nomes = await readdir(projetos).catch(() => [] as string[]);
  for (const nome of nomes) if (await existe(join(projetos, nome, `${sessao}.jsonl`))) return join(projetos, nome);
  return null;
}

/**
 * As outras pastas de conta do Claude desta máquina: as irmãs da pasta da conta e o ~/.claude, sem a própria. Na conta
 * padrão (sem CLAUDE_CONFIG_DIR, a pasta é o ~/.claude) não há irmãs a procurar: as irmãs seriam as pastas da casa.
 */
export async function outrasPastasDeConta(configDir: string | undefined, home: string): Promise<string[]> {
  if (!configDir) return [];
  const pai = dirname(configDir);
  const irmas = (await readdir(pai, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => join(pai, d.name));
  return [...new Set([...irmas, join(home, ".claude")])].filter((p) => p !== configDir);
}

export type SessaoTrazida = { trouxe: false; motivo: "ja_estava" | "nao_achou" | "id_invalido" } | { trouxe: true; de: string };

/** Garante a sessão na pasta da conta do turno; `de` é o nome da pasta de origem (o id da conta, nunca um caminho com nome de pessoa). */
export async function trazerSessaoDeOutraConta(o: { sessao: string; configDir: string | undefined; home: string }): Promise<SessaoTrazida> {
  if (!ID_DE_SESSAO.test(o.sessao)) return { trouxe: false, motivo: "id_invalido" };
  const alvo = o.configDir ?? join(o.home, ".claude");
  if (await ondeEstaASessao(alvo, o.sessao)) return { trouxe: false, motivo: "ja_estava" };
  for (const outra of await outrasPastasDeConta(o.configDir, o.home)) {
    const origem = await ondeEstaASessao(outra, o.sessao);
    if (!origem) continue;
    const destino = join(alvo, "projects", basename(origem));
    await mkdir(destino, { recursive: true });
    await copyFile(join(origem, `${o.sessao}.jsonl`), join(destino, `${o.sessao}.jsonl`), constants.COPYFILE_EXCL);
    const aoLado = join(origem, o.sessao);
    if (await existe(aoLado)) await cp(aoLado, join(destino, o.sessao), { recursive: true, force: false, errorOnExist: false });
    return { trouxe: true, de: basename(outra) };
  }
  return { trouxe: false, motivo: "nao_achou" };
}
