import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { paraCadaPessoa, type OpcoesLaco } from "../src/adapters/fundo/escopos-de-fundo.ts";
import { criarDb } from "../src/db/client.ts";
import { log } from "../src/obs/log.ts";
import { computadoresRepo } from "../src/repositories/computadores.repo.ts";
import type { Db } from "../src/shared/types.ts";
import type { Docker } from "./computadores-orfaos.ts";

/**
 * definido em 2026-10-22 (NOD-96 PR 5, ADR-122): a passagem ao computador da pessoa no motor. Os computadores por bot
 * (docker) de cada pessoa são ARQUIVADOS (`arquivado_em`; os bots deixam de apontar para eles) e os containers deles
 * DESLIGADOS — os volumes ficam: guardam o login e os arquivos de alguém, e a pessoa pode querer algo de lá. A web mostra
 * uma vez o "Entre nos sites de novo uma vez" (`aviso_recriado`). Só com NOD_COMPUTADORES=motor.
 *
 *   npm run computador:legado                     # arquiva e desliga (idempotente)
 *   npm run computador:legado -- --apagar-volumes # além disso, apaga containers, rede e volumes arquivados há 30 dias ou mais
 */

export const PRAZO_VOLUMES_MS = 30 * 24 * 60 * 60 * 1000;

export type Legado = { id: string; arquivadoEm: number };
export type Plano = { desligar: string[]; apagar: string[]; aguardando: { id: string; dias: number }[] };
export type MigracaoLegado = { tenantId: string; pessoaId: string; id: string; agenteId: string; destinoId: string; arquivadoEm: number | null };

/** O que fazer com cada legado arquivado: todos desligam; com `--apagar-volumes`, só os de 30 dias ou mais apagam. */
export function planejar(legados: Legado[], agora: number, apagarVolumes: boolean): Plano {
  const plano: Plano = { desligar: legados.map((l) => l.id), apagar: [], aguardando: [] };
  if (!apagarVolumes) return plano;
  for (const l of legados) {
    const falta = l.arquivadoEm + PRAZO_VOLUMES_MS - agora;
    if (falta <= 0) plano.apagar.push(l.id);
    else plano.aguardando.push({ id: l.id, dias: Math.ceil(falta / (24 * 60 * 60 * 1000)) });
  }
  return plano;
}

const nomes = (id: string) => ({ maquina: `nod-computador-${id}`, proxy: `nod-egress-${id}`, rede: `nod-rede-${id}`, volumes: [`nod-computador-${id}-home`, `nod-computador-${id}-workspace`] });
/** O docker diz "No such ..." quando o objeto já não existe: aqui isso é o estado desejado, não falha. */
const jaNaoExiste = (e: unknown) => /no such|not found/i.test(e instanceof Error ? e.message : String(e));

/**
 * Desliga (`docker stop`) e, nos de `apagar`, remove containers, rede e volumes. Desligar NUNCA remove volume. Um item
 * que falha não para os outros.
 */
export function executar(plano: Plano, docker: Docker): { desligados: string[]; apagados: string[]; falhas: string[] } {
  const desligados: string[] = [];
  const apagados: string[] = [];
  const falhas: string[] = [];
  const tentar = (args: string[]): boolean => {
    try {
      docker(args);
      return true;
    } catch (e) {
      return jaNaoExiste(e);
    }
  };
  for (const id of plano.desligar) {
    const n = nomes(id);
    if (tentar(["stop", n.maquina]) && tentar(["stop", n.proxy])) desligados.push(id);
    else falhas.push(id);
  }
  for (const id of plano.apagar) {
    const n = nomes(id);
    const ok = [["rm", "--force", n.maquina], ["rm", "--force", n.proxy], ["network", "rm", n.rede], ...n.volumes.map((v) => ["volume", "rm", v])]
      .map(tentar)
      .every(Boolean);
    if (ok) apagados.push(id);
    else if (!falhas.includes(id)) falhas.push(id);
  }
  return { desligados, apagados, falhas };
}

/**
 * Copia antes de arquivar. A cópia integral fica em `legado/<bot>` e os diretórios conhecidos também entram no lugar
 * ativo sem sobrescrever nada que o computador compartilhado já tenha produzido. O marcador no volume de destino faz
 * a repetição barata e segura; a origem nunca é removida aqui.
 */
export function migrarVolumesDocker(m: Pick<MigracaoLegado, "id" | "agenteId" | "destinoId">, docker: Docker, imagem = "nod-computador:1"): void {
  const origem = nomes(m.id);
  const destino = nomes(m.destinoId);
  const marcador = `/destino/computadores/${m.destinoId}/legado/${m.agenteId}/.concluido`;
  for (const nome of [origem.maquina, origem.proxy]) {
    try { docker(["stop", nome]); } catch (e) { if (!jaNaoExiste(e)) throw e; }
  }
  // O destino precisa estar parado: perfil e workspace não podem mudar durante a reconciliação.
  try {
    const rodando = docker(["inspect", "--format", "{{.State.Running}}", destino.maquina]).trim();
    if (rodando === "true") throw new Error("o computador compartilhado precisa estar parado para migrar o legado");
  } catch (e) {
    if (!jaNaoExiste(e)) throw e;
  }
  docker(["volume", "create", "--label", "nod.computador=true", `${destino.maquina}-home`]);
  const script = [
    "set -eu",
    `marcador=${JSON.stringify(marcador)}`,
    "[ ! -f \"$marcador\" ] || exit 0",
    `base=/destino/computadores/${m.destinoId}`,
    `bot=${m.agenteId}`,
    "tmp=\"$base/legado/.migracao-$bot-$$\"",
    "trap 'rm -rf \"$tmp\"' EXIT",
    "mkdir -p \"$tmp/home\" \"$tmp/workspace\" \"$base/perfis\" \"$base/workspace/$bot\" \"$base/legado\"",
    "cp -a /origem-home/. \"$tmp/home/\"",
    "cp -a /origem-workspace/. \"$tmp/workspace/\"",
    // O perfil antigo continua inteiro no snapshot. A cópia ativa só nasce se o bot ainda não tiver perfil novo.
    "if [ -d /origem-home/profile ] && [ ! -e \"$base/perfis/$bot\" ]; then cp -a /origem-home/profile \"$base/perfis/$bot\"; fi",
    // Não sobrescreve arquivos novos; qualquer colisão continua preservada no snapshot integral.
    "cp -an /origem-workspace/. \"$base/workspace/$bot/\"",
    "mkdir -p \"$base/legado/$bot\"",
    "rm -rf \"$base/legado/$bot/home\" \"$base/legado/$bot/workspace\"",
    "mv \"$tmp/home\" \"$base/legado/$bot/home\"",
    "mv \"$tmp/workspace\" \"$base/legado/$bot/workspace\"",
    "touch \"$marcador\"",
  ].join("; ");
  docker(["run", "--rm", "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "0:0",
    "--cap-add", "CHOWN", "--cap-add", "FOWNER", "--cap-add", "DAC_OVERRIDE",
    "--mount", `type=volume,source=${origem.maquina}-home,target=/origem-home,readonly`,
    "--mount", `type=volume,source=${origem.maquina}-workspace,target=/origem-workspace,readonly`,
    "--mount", `type=volume,source=${destino.maquina}-home,target=/destino`,
    "--entrypoint", "sh", imagem, "-c", script]);
}

/** Descobre a origem e o bot antes de tocar nos volumes. Sem identidade, aborta tudo e preserva os vínculos. */
export async function descobrirMigracoes(db: Db, listarPessoas?: OpcoesLaco["listarPessoas"]): Promise<MigracaoLegado[]> {
  const migracoes: MigracaoLegado[] = [];
  await paraCadaPessoa(db, (escopo, tx) => tx(async (trx) => {
    const repo = computadoresRepo(trx, escopo);
    const destino = await repo.obterDaPessoa();
    for (const l of await repo.legadosParaMigrar(destino.id)) {
      if (!l.agenteId) throw new Error(`legado ${l.id} sem identidade do bot; volume preservado`);
      migracoes.push({ ...escopo, id: l.id, agenteId: l.agenteId, destinoId: destino.id, arquivadoEm: l.arquivadoEm });
    }
  }), { ...(listarPessoas ? { listarPessoas } : {}), aoFalhar: (_escopo, erro) => { throw erro; } });
  return migracoes;
}

/** O recibo e o arquivamento só entram depois da cópia; repetir confirma o mesmo destino, nunca troca silenciosamente. */
export async function confirmarMigracoes(db: Db, migracoes: readonly MigracaoLegado[], agora: number, listarPessoas?: OpcoesLaco["listarPessoas"]): Promise<void> {
  const porPessoa = new Map(migracoes.map((m) => [`${m.tenantId}:${m.pessoaId}:${m.id}`, m]));
  await paraCadaPessoa(db, (escopo, tx) => tx(async (trx) => {
    const repo = computadoresRepo(trx, escopo);
    for (const m of porPessoa.values()) {
      if (m.tenantId !== escopo.tenantId || m.pessoaId !== escopo.pessoaId) continue;
      if (!await repo.concluirMigracaoLegado(m.id, m.agenteId, m.destinoId, agora)) throw new Error(`recibo recusado para o legado ${m.id}`);
    }
  }), { ...(listarPessoas ? { listarPessoas } : {}), aoFalhar: (_escopo, erro) => { throw erro; } });
}

/** Arquiva os por bot de cada pessoa (como nod_app, pessoa por pessoa: RLS) e devolve todos os arquivados. */
export async function arquivarTodos(db: Db, agora: number, listarPessoas?: OpcoesLaco["listarPessoas"]): Promise<Legado[]> {
  const legados: Legado[] = [];
  await paraCadaPessoa(
    db,
    (escopo, tx) => tx(async (trx) => {
      const repo = computadoresRepo(trx, escopo);
      await repo.arquivarLegado(agora);
      legados.push(...(await repo.legadosArquivados()));
    }),
    { ...(listarPessoas ? { listarPessoas } : {}), aoFalhar: (_escopo, erro) => { throw erro; } },
  );
  return legados;
}

const dockerReal: Docker = (args) => {
  const r = spawnSync("docker", args, { encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) throw new Error(`docker ${args.slice(0, 2).join(" ")} falhou: ${(r.stderr || r.error?.message || "").split("\n")[0]}`);
  return r.stdout;
};

async function principal(): Promise<void> {
  try {
    process.loadEnvFile(".env");
  } catch {
    // sem .env: variáveis vêm do ambiente
  }
  const escrever = (s: string) => process.stdout.write(`${s}\n`);
  if (!new Set(["motor", "docker"]).has(process.env.NOD_COMPUTADORES ?? "")) {
    escrever("Nada feito: a passagem ao computador da pessoa só roda com o computador compartilhado.");
    process.exitCode = 1;
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    log("erro", "legado_sem_url", { variavel: "DATABASE_URL" });
    process.exit(1);
  }
  const db = criarDb(url, { max: 1 });
  const agora = Date.now();
  let migracoes: MigracaoLegado[];
  try {
    migracoes = await descobrirMigracoes(db);
    for (const m of migracoes) migrarVolumesDocker(m, dockerReal, process.env.NOD_COMPUTADOR_IMAGEM || "nod-computador:1");
    await confirmarMigracoes(db, migracoes, agora);
  } finally {
    await db.end({ timeout: 2 });
  }
  const legados = migracoes.map((m) => ({ id: m.id, arquivadoEm: m.arquivadoEm ?? agora }));
  const plano = planejar(legados, agora, process.argv.includes("--apagar-volumes"));
  const r = executar(plano, dockerReal);
  escrever(`Computadores por bot migrados e arquivados: ${legados.length} · desligados: ${r.desligados.length}`);
  if (plano.apagar.length || plano.aguardando.length) escrever(`Apagados (30 dias ou mais): ${r.apagados.length}`);
  for (const a of plano.aguardando) escrever(`  ${a.id}: faltam ${a.dias} dia(s) para poder apagar os volumes`);
  if (r.falhas.length) {
    escrever(`Falharam: ${r.falhas.length} (rode de novo ou veja à mão).`);
    for (const id of r.falhas) escrever(`  ${id}`);
    process.exitCode = 1;
  }
  log("info", "computadores_legado", { arquivados: legados.length, desligados: r.desligados.length, apagados: r.apagados.length, falhas: r.falhas.length });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await principal();
