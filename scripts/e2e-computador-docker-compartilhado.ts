import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { criarControleDockerCompartilhado } from "../src/adapters/computador/provedores/docker.ts";

const imagem = process.env.NOD_COMPUTADOR_IMAGEM ?? "nod-computador:compartilhado";
const controle = criarControleDockerCompartilhado({
  NOD_COMPUTADORES: "docker",
  NOD_COMPUTADOR_IMAGEM: imagem,
  NOD_CREDENTIAL_KEY: randomBytes(32).toString("hex"),
  NOD_COMPUTADORES_MAX: "10",
});
const pessoa = randomUUID();
const outraPessoa = randomUUID();
const bots = Array.from({ length: 3 }, () => randomUUID());
const manter = process.env.NOD_SMOKE_MANTER === "1";
const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const passo = (nome: string) => process.stdout.write(`ok     ${nome}\n`);
const texto = (r: Awaited<ReturnType<typeof controle.executar>>) => r.tela?.texto ?? "";

async function limpar(id: string) {
  await controle.parar({ id }).catch(() => undefined);
  const maquina = `nod-computador-${id}`;
  for (const args of [
    ["rm", "-f", maquina, `nod-egress-${id}`],
    ["network", "rm", `nod-rede-${id}`],
    ["volume", "rm", `${maquina}-home`, `${maquina}-workspace`],
  ]) try { docker(...args); } catch { /* o ensaio pode falhar antes de criar todos os recursos */ }
}

try {
  await controle.iniciar({ id: pessoa });
  const containerAntes = docker("inspect", "--format", "{{.Id}}", `nod-computador-${pessoa}`);
  const usuario = docker("exec", `nod-computador-${pessoa}`, "id", "-u");
  const privilegios = docker("inspect", "--format", "{{.HostConfig.Privileged}} {{json .HostConfig.CapDrop}} {{json .HostConfig.SecurityOpt}}", `nod-computador-${pessoa}`);
  assert.equal(usuario, "1000");
  assert.match(privilegios, /^false .*ALL.*no-new-privileges/);
  passo("container sem root, sem capacidades e com no-new-privileges");

  const aberturas = await Promise.all(bots.map((agenteId, i) => controle.executar(
    { id: pessoa, agenteId },
    { tipo: "navegar", url: `https://example.com/?bot=${i + 1}` },
  )));
  assert.ok(aberturas.every((r) => /Example Domain|documentation examples/.test(`${r.tela?.titulo} ${texto(r)}`)));
  const processos = docker("exec", `nod-computador-${pessoa}`, "sh", "-c", "ps -eo args | grep -E 'Xvfb :[0-9]+' | grep -v grep");
  assert.equal(new Set(processos.match(/Xvfb :\d+/g)).size, 3);
  assert.equal(docker("ps", "--filter", `name=^nod-computador-${pessoa}$`, "--format", "{{.Names}}").split("\n").filter(Boolean).length, 1);
  passo("três bots simultâneos usam três displays no mesmo container");

  await controle.executar({ id: pessoa, agenteId: bots[0] }, { tipo: "navegar", url: "https://httpbin.org/cookies/set/sessao/compartilhada" });
  const login = await controle.executar({ id: pessoa, agenteId: bots[1] }, { tipo: "navegar", url: "https://httpbin.org/cookies" });
  assert.match(texto(login), /"sessao":\s*"compartilhada"/);
  const perfis = docker("exec", `nod-computador-${pessoa}`, "sh", "-c", "find /home/node/computadores/*/perfis -mindepth 1 -maxdepth 1 -type d ! -name 'casa-*' | wc -l");
  assert.equal(perfis, "3");
  passo("login é compartilhado pela loja cifrada sem compartilhar user-data-dir");

  for (let i = 0; i < bots.length; i++) {
    const r = await controle.executar({ id: pessoa, agenteId: bots[i] }, { tipo: "terminal", comando: `printf bot-${i + 1} > proprio.txt; pwd` });
    assert.equal(r.saida?.trim(), "/workspace");
  }
  const cruzado = await controle.executar({ id: pessoa, agenteId: bots[0] }, { tipo: "terminal", comando: `cat ../${bots[1]}/proprio.txt 2>/dev/null || printf bloqueado` });
  assert.equal(cruzado.saida, "bloqueado");
  passo("terminal recebe agenteId e não atravessa o workspace de outro bot");

  const containerDepois = docker("inspect", "--format", "{{.Id}}", `nod-computador-${pessoa}`);
  assert.equal(containerDepois, containerAntes);
  const trocado = await controle.executar({ id: pessoa, agenteId: bots[2] }, { tipo: "observar" });
  assert.ok(trocado.tela?.imagem);
  passo("trocar de bot muda a tela sem trocar o container");

  docker("restart", "--time", "10", `nod-computador-${pessoa}`);
  const recuperado = await controle.executar({ id: pessoa, agenteId: bots[0] }, { tipo: "observar" });
  assert.ok(recuperado.tela?.imagem);
  const persistiu = await controle.executar({ id: pessoa, agenteId: bots[0] }, { tipo: "terminal", comando: "cat proprio.txt" });
  assert.equal(persistiu.saida, "bot-1");
  passo("supervisor, Chromium, display e arquivos recuperam após restart");

  await controle.iniciar({ id: outraPessoa });
  const outro = await controle.executar({ id: outraPessoa, agenteId: bots[0] }, { tipo: "terminal", comando: "test ! -e proprio.txt && printf isolado" });
  assert.equal(outro.saida, "isolado");
  assert.notEqual(
    docker("inspect", "--format", "{{.Id}}", `nod-computador-${outraPessoa}`),
    containerAntes,
  );
  passo("tenants diferentes recebem containers e volumes diferentes");
  process.stdout.write("\ntodas as checagens Docker compartilhadas passaram\n");
} finally {
  if (manter) process.stdout.write(`recursos mantidos para diagnóstico: ${pessoa} ${outraPessoa}\n`);
  else {
    await limpar(pessoa);
    await limpar(outraPessoa);
  }
}
