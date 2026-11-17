import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { DriverComputador } from "../../../contracts/computador.ts";
import type { ResultadoComandoComputador } from "../../../contracts/computador-motor.ts";
import type { CapacidadesProvedor, FluxoTelaAoVivo, ProvedorDeComputador, RefComputador, SaudeComputador } from "../../../contracts/provedor-computador.ts";
import { FalhaComputador, limiteDoAmbiente } from "../../../domain/computador.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { log } from "../../../obs/log.ts";
import { assinarComando, publicaDeAssinatura, seloDoIniciar } from "../selo.ts";
import { abrirVncDocker, criarDriverDocker, docker as dockerPadrao } from "../docker.ts";

/**
 * ADR-168 (definido em 2026-11-12): o Docker próprio do nod (ADR-037) como `ProvedorDeComputador`. O ciclo e o plano de
 * dados continuam no driver de sempre (adapters/computador/docker.ts, com o runtime do nod dentro do container); este
 * arquivo só o veste na interface e acrescenta o que faltava: saúde explícita e snapshot dos volumes.
 *
 * - criar: o container nasce no `iniciar` (subir cria rede, proxy e máquina numa passada só); criar é só validar o id.
 * - retomar: o Docker não guarda memória (`docker pause` não sobrevive ao reinício do host); retomar = iniciar.
 * - snapshot: com o computador DESLIGADO, copia os volumes -home e -workspace para volumes `…-foto-<rótulo>-*`, usando a
 *   própria imagem do computador (sem baixar nada), sem rede. Restaurar copia de volta, também desligado.
 * - excluir: não existe aqui. Volumes guardam logins de alguém; a ADR-037 manda apagar à mão depois da retenção.
 */
export const CAPACIDADES_DOCKER: CapacidadesProvedor = {
  retomarComMemoria: false,
  snapshot: "completo",
  telaAoVivo: "vnc_websocket",
  terminal: "comando",
  navegador: "playwright",
  audio: true,
  onde: "host_do_servidor",
};

type Docker = typeof dockerPadrao;

function donosDosVolumesLegados(valor: string | undefined): ReadonlyMap<string, string> {
  if (!valor) return new Map();
  let bruto: unknown;
  try { bruto = JSON.parse(valor); } catch { throw new Error("NOD_COMPUTADOR_LEGADO_POR_ID precisa ser um objeto JSON"); }
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) throw new Error("NOD_COMPUTADOR_LEGADO_POR_ID precisa ser um objeto JSON");
  const pares = Object.entries(bruto);
  if (pares.some(([id, dono]) => !/^[a-f0-9-]{36}$/.test(id) || typeof dono !== "string" || !/^[a-f0-9]{12}$/.test(dono))) {
    throw new Error("NOD_COMPUTADOR_LEGADO_POR_ID aceita somente UUID:hash-de-12-hex");
  }
  return new Map(pares as Array<[string, string]>);
}

function hashDoEscopo(ref: Pick<RefComputador, "escopo">): string | null {
  return ref.escopo ? createHash("sha256").update(`${ref.escopo.tenantId}:${ref.escopo.pessoaId}`).digest("hex").slice(0, 12) : null;
}

function nomeBaseDocker(ref: Pick<RefComputador, "id" | "escopo">, legados: ReadonlyMap<string, string> = new Map()): string {
  if (!/^[a-f0-9-]{36}$/.test(ref.id)) throw new ErroDeDominio("entrada_invalida");
  // O UUID do computador só é único dentro do tenant. O hash opaco impede dois tenants com o mesmo UUID de
  // convergirem no mesmo container/volume sem publicar tenantId ou pessoaId nos nomes do Docker.
  const hash = hashDoEscopo(ref);
  // O preview anterior já tem volumes sem hash. O deploy fornece explicitamente UUID → hash do dono; sem essa prova,
  // ninguém adota dados legados e um tenant colidente nunca recebe os logins de outro.
  const sufixo = hash && legados.get(ref.id) !== hash ? `${hash}-` : "";
  return `nod-computador-${sufixo}${ref.id}`;
}

type ControleCompartilhado = {
  ambiente(): ReturnType<DriverComputador["ambiente"]>;
  iniciar(ref: RefComputador): Promise<void>;
  parar(ref: RefComputador): Promise<void>;
  executar(ref: RefComputador, acao: Parameters<DriverComputador["executar"]>[1], autor?: "bot" | "pessoa"): Promise<Awaited<ReturnType<DriverComputador["executar"]>>>;
  estado(ref: RefComputador): ReturnType<DriverComputador["estado"]>;
  ligados(): Promise<Set<string>>;
  abrirVivo(ref: RefComputador): Promise<FluxoTelaAoVivo>;
};

/**
 * NOD-498: o Docker hospeda um supervisor por computador da pessoa. As telas são processos do supervisor, não
 * containers; por isso três bots compartilham a loja cifrada de cookies/storage, mas recebem DISPLAY, perfil e
 * workspace próprios. O controle usa o mesmo protocolo assinado do motor (ADR-122), inclusive TOFU.
 */
export function criarControleDockerCompartilhado(env: Readonly<Record<string, string | undefined>>, docker: Docker = dockerPadrao): ControleCompartilhado {
  const imagem = env.NOD_COMPUTADOR_IMAGEM || "nod-computador:1";
  const habilitado = env.NOD_COMPUTADORES === "docker";
  const credencial = env.NOD_CREDENTIAL_KEY ?? "";
  const credencialOk = /^[a-f0-9]{64}$/i.test(credencial);
  const legados = donosDosVolumesLegados(env.NOD_COMPUTADOR_LEGADO_POR_ID);
  const limite = limiteDoAmbiente(env);
  const nomes = (ref: Pick<RefComputador, "id" | "escopo">) => {
    const maquina = nomeBaseDocker(ref, legados);
    const sufixo = maquina.slice("nod-computador-".length);
    return { maquina, proxy: `nod-egress-${sufixo}`, rede: `nod-rede-${sufixo}` };
  };
  const rodando = async (nome: string) => (await docker(["inspect", "--format", "{{.State.Running}}", nome], undefined, 5_000).catch(() => "false")).trim() === "true";
  const esperarPronto = async (maquina: string) => {
    for (let i = 0; i < 120; i++) {
      if (await docker(["exec", maquina, "test", "-S", "/tmp/nod-computer.sock"], undefined, 2_000).then(() => true, () => false)) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new FalhaComputador("nao_ficou_pronto", { detalhe: "o supervisor Docker não abriu o socket" });
  };
  const subidas = new Map<string, Promise<void>>();
  // A leitura do teto e a criação precisam ser uma única região crítica. Sem a fila, duas pessoas que ligassem
  // máquinas diferentes no mesmo tick viam a mesma foto de `docker ps` e ambas passavam pelo último lugar.
  let filaDeCapacidade: Promise<void> = Promise.resolve();
  const nomesLigados = async () => {
    const saida = await docker(["ps", "--filter", "label=nod.computador=true", "--filter", "name=^nod-computador-", "--format", "{{.Names}}"], undefined, 5_000);
    return new Set(saida.split("\n").map((l) => l.trim()).filter((nome) => /^nod-computador-(?:[a-f0-9]{12}-)?[a-f0-9-]{36}$/.test(nome)));
  };
  const ligados = async () => new Set([...await nomesLigados()].map((nome) => nome.slice(-36)));
  async function subirUma(ref: Pick<RefComputador, "id" | "escopo">): Promise<void> {
    if (!habilitado || !credencialOk) throw new ErroDeDominio("nao_permitido");
    const n = nomes(ref);
    let maquinaJaRodando = false;
    const existe = await docker(["inspect", n.maquina], undefined, 5_000).then(() => true, () => false);
    if (existe) {
      const [cmd, imagemAtual, imagemNova] = await Promise.all([
        docker(["inspect", "--format", "{{json .Config.Cmd}}", n.maquina], undefined, 5_000).catch(() => ""),
        docker(["inspect", "--format", "{{.Image}}", n.maquina], undefined, 5_000).catch(() => ""),
        docker(["image", "inspect", "--format", "{{.Id}}", imagem], undefined, 5_000, "imagem_ausente"),
      ]);
      // Container da arquitetura antiga: preserva os volumes, troca só o processo dono deles. Sem isto um preview com
      // container já criado continuaria abrindo um Chromium/runtime por bot mesmo depois do deploy.
      if (!cmd.includes("docker-runtime.mjs") || imagemAtual.trim() !== imagemNova.trim()) {
        if (await rodando(n.maquina)) await docker(["stop", "--time", "20", n.maquina], undefined, 30_000).catch(() => undefined);
        await docker(["rm", n.maquina], undefined, 30_000, "nao_iniciou");
      } else if (await rodando(n.maquina)) {
        maquinaJaRodando = true;
        // `docker restart` devolve quando o init já subiu, não quando os sockets dos filhos estão prontos. Sem esta
        // espera, a primeira ação após um restart podia falhar no TOFU embora o container estivesse saudável.
        const proxyExiste = await docker(["inspect", n.proxy], undefined, 5_000).then(() => true, () => false);
        if (proxyExiste) {
          if (!await rodando(n.proxy)) await docker(["start", n.proxy], undefined, 70_000, "nao_iniciou");
          await esperarPronto(n.maquina);
          return;
        }
        // Um proxy removido à mão é reconstruído abaixo sem reiniciar a máquina que já está viva.
      }
    }
    const ativos = await nomesLigados();
    if (!ativos.has(n.maquina) && ativos.size >= limite.maximo) throw new FalhaComputador("limite_de_computadores", { limite, detalhe: `${ativos.size} ligados, máximo ${limite.maximo}` });
    await docker(["image", "inspect", imagem], undefined, 5_000, "imagem_ausente");
    await docker(["network", "inspect", n.rede], undefined, 5_000).catch(() => docker(["network", "create", "--internal", "--label", "nod.computador=true", n.rede], undefined, 70_000, "nao_iniciou"));
    if (!await docker(["inspect", n.proxy], undefined, 5_000).then(() => true, () => false)) {
      await docker(["create", "--name", n.proxy, "--label", "nod.computador=true", "--restart", "unless-stopped", "--network", "bridge", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only", "--memory", "128m", "--pids-limit", "64", imagem, "node", "egress.mjs"], undefined, 70_000, "nao_iniciou");
      await docker(["network", "connect", "--alias", "egress", n.rede, n.proxy], undefined, 70_000, "nao_iniciou");
    }
    if (!await rodando(n.proxy)) await docker(["start", n.proxy], undefined, 70_000, "nao_iniciou");
    for (const volume of [`${n.maquina}-home`, `${n.maquina}-workspace`]) await docker(["volume", "create", "--label", "nod.computador=true", volume], undefined, 30_000, "nao_iniciou");
    // Um volume nomeado vazio nasce root:root, inclusive no Docker rootless. A máquina roda como uid 1000 e sem
    // capacidades; este init efêmero é o único processo root, sem rede, e só entrega a raiz dos dois volumes ao uid.
    await docker([
      "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL", "--cap-add", "CHOWN", "--user", "0:0",
      "--mount", `type=volume,source=${n.maquina}-home,target=/home/node`, "--mount", `type=volume,source=${n.maquina}-workspace,target=/workspace`,
      "--entrypoint", "chown", imagem, "1000:1000", "/home/node", "/workspace",
    ], undefined, 30_000, "nao_iniciou");
    if (!await docker(["inspect", n.maquina], undefined, 5_000).then(() => true, () => false)) await docker([
      "create", "--name", n.maquina, "--label", "nod.computador=true", "--restart", "unless-stopped", "--network", n.rede,
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only", "--memory", "2g", "--cpus", "2", "--pids-limit", "768", "--shm-size", "512m",
      "--tmpfs", "/tmp:rw,nosuid,size=512m,uid=1000,gid=1000", "--tmpfs", "/run:rw,nosuid,size=64m,uid=1000,gid=1000",
      "--env", "NOD_PC_CHROMIUM_SANDBOX=nao", "--env", "NOD_PC_BWRAP=nao", "--env", "NOD_PC_TERMINAL_EXTERNO=sim",
      "--mount", `type=volume,source=${n.maquina}-home,target=/home/node`, "--mount", `type=volume,source=${n.maquina}-workspace,target=/workspace`,
      ...(env.NOD_COMPUTADOR_RUNTIME ? ["--runtime", env.NOD_COMPUTADOR_RUNTIME] : []), imagem,
    ], undefined, 70_000, "nao_iniciou");
    if (!maquinaJaRodando) await docker(["start", n.maquina], undefined, 70_000, "nao_iniciou");
    await esperarPronto(n.maquina);
  }
  function subir(ref: Pick<RefComputador, "id" | "escopo">): Promise<void> {
    const chave = nomes(ref).maquina;
    const atual = subidas.get(chave);
    if (atual) return atual;
    const nova = filaDeCapacidade.catch(() => undefined).then(() => subirUma(ref));
    filaDeCapacidade = nova.then(() => undefined, () => undefined);
    void nova.finally(() => subidas.delete(chave)).catch(() => undefined);
    subidas.set(chave, nova);
    return nova;
  }
  async function unico(ref: Pick<RefComputador, "id" | "escopo">, comando: object, sonda = false): Promise<{ estado?: { supervisorPub?: string }; resultado?: ResultadoComandoComputador }> {
    const n = nomes(ref);
    const saida = await docker(["exec", "-i", n.maquina, "node", "/opt/nod/cliente-unico.mjs"], JSON.stringify({ comando, sonda }), 70_000, "sem_resposta");
    try { return JSON.parse(saida) as { estado?: { supervisorPub?: string }; resultado?: ResultadoComandoComputador }; } catch { throw new FalhaComputador("sem_resposta", { detalhe: "resposta ilegível do supervisor Docker" }); }
  }
  async function enviar(ref: RefComputador, tipo: "iniciar" | "acao" | "fechar_tela" | "parar", acao?: Parameters<DriverComputador["executar"]>[1], autor?: "bot" | "pessoa"): Promise<ResultadoComandoComputador> {
    const sondaId = randomUUID();
    const foto = await unico(ref, { id: sondaId, computadorId: ref.id, tipo: "parar", uso: "equilibrado", prazoMs: Date.now() + 60_000, assinatura: "" }, true);
    const pub = foto.estado?.supervisorPub;
    if (!pub) throw new FalhaComputador("nao_ficou_pronto", { detalhe: "o supervisor Docker não anunciou sua chave" });
    const extra = tipo === "iniciar"
      ? { segredoSelado: seloDoIniciar(credencial, ref.id, pub), servidorPub: publicaDeAssinatura(credencial, ref.id) }
      : tipo === "acao" ? { acao, ...(autor === "pessoa" ? { pessoa: true as const } : {}) } : {};
    const comando = assinarComando(credencial, { id: randomUUID(), computadorId: ref.id, tipo, ...(ref.agenteId && tipo !== "iniciar" && tipo !== "parar" ? { agenteId: ref.agenteId } : {}), uso: "equilibrado", prazoMs: Date.now() + 60_000, ...extra });
    const resposta = (await unico(ref, comando)).resultado;
    if (!resposta) throw new FalhaComputador("sem_resposta");
    return resposta;
  }
  async function iniciar(ref: RefComputador) {
    await subir(ref);
    const r = await enviar(ref, "iniciar");
    if (r.desfecho !== "ok") throw new FalhaComputador(r.motivo ?? "nao_iniciou");
  }
  async function abrirVivo(ref: RefComputador): Promise<FluxoTelaAoVivo> {
    if (!ref.agenteId) throw new FalhaComputador("nao_iniciou", { detalhe: "a tela ao vivo precisa da identidade do bot" });
    await iniciar(ref);
    const comando = assinarComando(credencial, { id: randomUUID(), computadorId: ref.id, tipo: "vivo", agenteId: ref.agenteId, uso: "equilibrado", prazoMs: Date.now() + 60_000, vivo: { sessao: "docker-local", token: randomUUID() } });
    const p = spawn("docker", ["exec", "-i", nomes(ref).maquina, "node", "/opt/nod/client.mjs"], { stdio: ["pipe", "pipe", "pipe"] });
    p.stdin.write(`${JSON.stringify({ tipo: "vivo", comando })}\n`);
    let dados: ((bytes: Uint8Array) => void) | null = null;
    let fechou: (() => void) | null = null;
    let cabecalho = Buffer.alloc(0);
    let vivo = false;
    let encerrado = false;
    const terminar = () => { if (encerrado) return; encerrado = true; fechou?.(); };
    p.stdout.on("data", (b: Buffer) => {
      if (vivo) { dados?.(b); return; }
      cabecalho = Buffer.concat([cabecalho, b]);
      for (;;) {
        const i = cabecalho.indexOf(10);
        if (i < 0) return;
        const linha = cabecalho.subarray(0, i).toString();
        cabecalho = cabecalho.subarray(i + 1);
        let m: { tipo?: string; ok?: boolean } = {};
        try { m = JSON.parse(linha) as typeof m; } catch { continue; }
        if (m.tipo !== "vivo") continue;
        if (!m.ok) { p.kill("SIGTERM"); terminar(); return; }
        vivo = true;
        if (cabecalho.length) { const resto = cabecalho; cabecalho = Buffer.alloc(0); dados?.(resto); }
        return;
      }
    });
    p.stdout.on("end", terminar); p.stdout.on("error", terminar); p.stdin.on("error", terminar); p.on("error", terminar); p.on("close", terminar);
    p.stderr.on("data", () => undefined);
    return {
      enviar(bytes) { if (!encerrado) p.stdin.write(Buffer.from(bytes)); },
      aoDados(fn) { dados = fn; },
      aoFechar(fn) { fechou = fn; if (encerrado) queueMicrotask(fn); },
      fechar() { if (!encerrado) { p.stdin.end(); p.kill("SIGTERM"); terminar(); } },
    };
  }
  return {
    async ambiente() {
      if (!habilitado) return { disponivel: false, motivo: "Configure NOD_COMPUTADORES=docker no servidor." };
      if (!credencialOk) return { disponivel: false, motivo: "Configure a chave de credenciais do servidor para proteger os logins." };
      const ok = await docker(["image", "inspect", imagem], undefined, 5_000).then(() => true, () => false);
      return { disponivel: ok, limite, motivo: ok ? null : "Prepare o ambiente com npm run computador:build e Docker em execução." };
    },
    iniciar,
    async parar(ref) {
      if (!await rodando(nomes(ref).maquina)) return;
      const r = await enviar(ref, ref.agenteId ? "fechar_tela" : "parar");
      if (r.desfecho !== "ok") throw new FalhaComputador(r.motivo ?? "acao_falhou");
      if (!ref.agenteId) for (const nome of [nomes(ref).maquina, nomes(ref).proxy]) if (await rodando(nome)) await docker(["stop", "--time", "20", nome], undefined, 30_000);
    },
    async executar(ref, acao, autor) {
      await iniciar(ref);
      const r = await enviar(ref, "acao", acao, autor);
      if (r.desfecho !== "ok") throw new FalhaComputador(r.motivo ?? "acao_falhou");
      if (acao.tipo === "terminal" && (r.resultado as { terminalExterno?: unknown } | undefined)?.terminalExterno === true) {
        if (!ref.agenteId) throw new FalhaComputador("acao_falhou");
        const n = nomes(ref);
        const saida = await docker([
          "run", "--rm", "-i", "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only", "--user", "1000:1000",
          "--tmpfs", "/tmp:rw,nosuid,size=64m,uid=1000,gid=1000", "--workdir", "/workspace",
          "--mount", `type=volume,source=${n.maquina}-workspace,target=/workspace,volume-subpath=${ref.id}/${ref.agenteId}`,
          "--entrypoint", "node", imagem, "/opt/nod/terminal-sidecar.mjs",
        ], JSON.stringify({ comando: acao.comando }), 30_000, "acao_falhou");
        try { return JSON.parse(saida) as Awaited<ReturnType<DriverComputador["executar"]>>; } catch { throw new FalhaComputador("sem_resposta"); }
      }
      return r.resultado ?? {};
    },
    async estado(ref) {
      const a = await this.ambiente();
      const ativo = a.disponivel && await rodando(nomes(ref).maquina);
      return { ...a, ativo, reinicios: null };
    },
    ligados,
    abrirVivo,
  };
}

const ROTULO = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function criarProvedorDocker(env: Readonly<Record<string, string | undefined>>, extra: { driver?: DriverComputador; controle?: ControleCompartilhado; docker?: Docker; abrirVivo?: typeof abrirVncDocker } = {}): ProvedorDeComputador {
  const driver = extra.driver ?? criarDriverDocker(env);
  const controle = extra.controle ?? (extra.driver ? null : criarControleDockerCompartilhado(env, extra.docker));
  const docker = extra.docker ?? dockerPadrao;
  const imagem = env.NOD_COMPUTADOR_IMAGEM || "nod-computador:1";
  const legados = donosDosVolumesLegados(env.NOD_COMPUTADOR_LEGADO_POR_ID);

  async function copiarVolumes(ref: RefComputador, de: (v: "home" | "workspace") => string, para: (v: "home" | "workspace") => string) {
    const ligado = controle ? (await controle.estado(ref)).ativo : (await driver.ligados()).has(ref.id);
    if (ligado) throw new FalhaComputador("ocupado", { detalhe: "desligue o computador antes da foto ou da restauração" });
    for (const v of ["home", "workspace"] as const) {
      await docker(["volume", "create", "--label", "nod.computador=true", para(v)], undefined, 30_000, "nao_iniciou");
      // A própria imagem do computador (já no host), sem rede e sem privilégio: nada baixa, nada sai.
      await docker(["run", "--rm", "--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "0:0", "--cap-add", "CHOWN", "--cap-add", "FOWNER", "--cap-add", "DAC_OVERRIDE",
        "--mount", `type=volume,source=${de(v)},target=/de,readonly`, "--mount", `type=volume,source=${para(v)},target=/para`,
        "--entrypoint", "sh", imagem, "-c", "find /para -mindepth 1 -delete && cp -a /de/. /para/"], undefined, 300_000, "acao_falhou");
    }
  }

  async function saude(ref: RefComputador): Promise<SaudeComputador> {
    const e = controle ? await controle.estado(ref) : await driver.estado(ref.id, ref.escopo);
    if (!e.disponivel) return { estado: "erro", pronto: false, motivo: "docker_indisponivel", detalhe: e.motivo, reinicios: null };
    return { estado: e.ativo ? "ligado" : "parado", pronto: e.ativo, motivo: null, detalhe: null, reinicios: e.reinicios ?? null };
  }

  return {
    id: "docker",
    capacidades: CAPACIDADES_DOCKER,
    ambiente: () => controle ? controle.ambiente() : driver.ambiente(),
    async criar(ref) { nomeBaseDocker(ref, legados); },
    iniciar: (ref) => controle ? controle.iniciar(ref) : driver.iniciar(ref.id, ref.escopo),
    parar: (ref) => controle ? controle.parar(ref) : driver.parar(ref.id, ref.escopo),
    retomar: (ref) => controle ? controle.iniciar(ref) : driver.iniciar(ref.id, ref.escopo),
    async snapshot(ref, rotulo) {
      if (!ROTULO.test(rotulo)) throw new ErroDeDominio("entrada_invalida");
      const base = nomeBaseDocker(ref, legados);
      await copiarVolumes(ref, (v) => `${base}-${v}`, (v) => `${base}-foto-${rotulo}-${v}`);
      log("info", "computador_snapshot", { computador_id: ref.id, provedor: "docker", rotulo });
      return { snapshotId: rotulo };
    },
    async restaurar(ref, snapshotId) {
      if (!ROTULO.test(snapshotId)) throw new ErroDeDominio("entrada_invalida");
      const base = nomeBaseDocker(ref, legados);
      await copiarVolumes(ref, (v) => `${base}-foto-${snapshotId}-${v}`, (v) => `${base}-${v}`);
      log("info", "computador_restaurado", { computador_id: ref.id, provedor: "docker", rotulo: snapshotId });
    },
    saude,
    ligados: () => controle ? controle.ligados() : driver.ligados(),
    executar: (ref, acao, autor) => controle ? controle.executar(ref, acao, autor) : driver.executar(ref.id, acao, ref.escopo, autor),
    abrirTelaAoVivo: (ref) => controle ? controle.abrirVivo(ref) : (extra.abrirVivo ?? abrirVncDocker)(ref.id),
  };
}
