import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DriverComputador } from "../../../src/contracts/computador.ts";
import type { PrimitivasDeComputador, ProvedorDeComputador } from "../../../src/contracts/provedor-computador.ts";
import { criarProvedorDocker } from "../../../src/adapters/computador/provedores/docker.ts";
import { criarProvedorOrgo, estadoDoOrgo, nomeNoOrgo, teclaParaOrgo } from "../../../src/adapters/computador/provedores/orgo.ts";
import { criarExecutorPorPrimitivas, paginar, PEDACO_BASE64 } from "../../../src/adapters/computador/provedores/primitivas.ts";
import { criarDriverPorProvedor } from "../../../src/adapters/computador/provedores/seletor.ts";
import { FalhaComputador } from "../../../src/domain/computador.ts";
import { configDeProvedores, escolherProvedor, lerMapaDeProvedores, provedoresEmUso } from "../../../src/domain/provedor-computador.ts";

/**
 * ADR-168: o computador do bot plug and play. Sem rede, sem Docker, sem conta no Orgo: o Docker e o fetch são falsos, e a
 * camada de primitivas roda contra um bash LOCAL numa pasta temporária (coreutils do GNU; no Mac, os g* do Homebrew).
 */
const ID = "11111111-2222-4333-8444-555555555555";
const BOT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PESSOA = "99999999-8888-4777-8666-555555555555";
const ESCOPO = { tenantId: "t1", pessoaId: PESSOA };
const PNG = "iVBORw0KGgo=";

describe("escolha do provedor (domínio)", () => {
  it("bot > pessoa > global > padrão, e o legado NOD_COMPUTADORES=docker é o padrão", () => {
    const { config, avisos } = configDeProvedores({
      NOD_COMPUTADORES: "docker",
      NOD_COMPUTADOR_PROVEDOR_POR_PESSOA: JSON.stringify({ [PESSOA]: "orgo" }),
      NOD_COMPUTADOR_PROVEDOR_POR_BOT: JSON.stringify({ [BOT]: "docker" }),
    });
    expect(avisos).toEqual([]);
    expect(escolherProvedor(config, { pessoaId: PESSOA, agenteId: BOT })).toBe("docker");
    expect(escolherProvedor(config, { pessoaId: PESSOA, agenteId: "outro" })).toBe("orgo");
    expect(escolherProvedor(config, { pessoaId: "outra", agenteId: null })).toBe("docker");
    expect(provedoresEmUso(config)).toEqual(["docker", "orgo"]);
  });

  it("sem configuração nenhuma, nenhum provedor (o computador fica desligado como antes)", () => {
    const { config } = configDeProvedores({});
    expect(escolherProvedor(config, { pessoaId: PESSOA, agenteId: BOT })).toBeNull();
    expect(provedoresEmUso(config)).toEqual([]);
  });

  it("o motor não entra no seletor: segue o caminho próprio (um computador por pessoa)", () => {
    expect(configDeProvedores({ NOD_COMPUTADORES: "motor" }).config.padrao).toBeNull();
  });

  it("valor desconhecido é ignorado com aviso, nunca vira outro provedor", () => {
    const { config, avisos } = configDeProvedores({ NOD_COMPUTADOR_PROVEDOR: "nuvem-qualquer", NOD_COMPUTADOR_PROVEDOR_POR_BOT: "{torto" });
    expect(config.global).toBeNull();
    expect(avisos.join(" ")).toMatch(/nuvem-qualquer/);
    expect(avisos.join(" ")).toMatch(/json_invalido/);
    expect(lerMapaDeProvedores(JSON.stringify({ "nao-uuid": "orgo", [BOT]: "x", [PESSOA]: "orgo" })).mapa).toEqual({ [PESSOA]: "orgo" });
  });
});

/** Um bash local fazendo o papel da máquina de fora. Devolve null se não há coreutils do GNU (o teste pula). */
function maquinaLocal(raiz: string): PrimitivasDeComputador | null {
  const temGnu = spawnSync("bash", ["-c", "realpath -m / && stat -c %s / && base64 -w0 </dev/null"], { encoding: "utf8" }).status === 0;
  let path = process.env.PATH ?? "";
  if (!temGnu) {
    const shim = join(raiz, "..", "shim");
    mkdirSync(shim, { recursive: true });
    for (const t of ["realpath", "stat", "base64", "sha256sum", "mkdir", "dirname", "mv", "head", "cut"]) {
      const g = `/opt/homebrew/bin/g${t}`;
      if (!existsSync(g)) return null;
      if (!existsSync(join(shim, t))) symlinkSync(g, join(shim, t));
    }
    path = `${shim}:${path}`;
  }
  const comandos: string[] = [];
  return Object.assign({
    capturarTela: async () => ({ png: PNG, largura: 1280, altura: 800 }),
    clicar: async () => undefined,
    arrastar: async () => undefined,
    digitar: async () => undefined,
    tecla: async () => undefined,
    rolar: async () => undefined,
    abrirUrl: async () => undefined,
    comando: async (_ref: unknown, comando: string) => {
      comandos.push(comando);
      const r = spawnSync("bash", ["-c", comando], { encoding: "utf8", env: { PATH: path, HOME: raiz }, cwd: raiz, maxBuffer: 16 * 1024 * 1024 });
      return { saida: `${r.stdout}${r.stderr}`, codigoSaida: r.status ?? 1 };
    },
  }, { comandos });
}

describe("ações do nod sobre primitivas (provedor de fora)", () => {
  let base: string;
  let raiz: string;
  let maquina: (PrimitivasDeComputador & { comandos: string[] }) | null;
  beforeAll(() => {
    // realpath: no Mac o tmpdir é /var/… e o realpath da máquina dá /private/var/… (a raiz tem de ser o caminho real).
    base = realpathSync(mkdtempSync(join(tmpdir(), "nod-prov-")));
    raiz = join(base, "workspace");
    mkdirSync(raiz);
    writeFileSync(join(base, "segredo.txt"), "fora");
    maquina = maquinaLocal(raiz) as typeof maquina;
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));
  const ref = { id: ID, escopo: ESCOPO };

  it("quadro: ação com quadro velho é tela_alterada; observar dá um quadro novo que vale uma ação", async () => {
    const p = { ...(maquina ?? maquinaLocal(raiz) ?? ({} as PrimitivasDeComputador)), capturarTela: async () => ({ png: PNG, largura: 1280, altura: 800 }), clicar: vi.fn(async () => undefined) };
    let n = 0;
    let relogio = 1_000;
    const ex = criarExecutorPorPrimitivas(p, { raiz: "/workspace", novoId: () => `id${n++}`, agora: () => relogio });
    await expect(ex.executar(ref, { tipo: "clicar", x: 1, y: 1, quadro: "inventado" })).rejects.toMatchObject({ motivo: "tela_alterada" });
    const { tela } = await ex.executar(ref, { tipo: "observar" });
    await ex.executar(ref, { tipo: "clicar", x: 10, y: 20, quadro: tela!.quadro, botao: 2 });
    expect(p.clicar).toHaveBeenCalledWith(ref, { x: 10, y: 20, botao: "direito", vezes: 1 });
    // O mesmo quadro não vale de novo: a ação trocou a revisão.
    await expect(ex.executar(ref, { tipo: "clicar", x: 10, y: 20, quadro: tela!.quadro })).rejects.toMatchObject({ motivo: "tela_alterada" });
    // E vence em 2 min.
    const { tela: t2 } = await ex.executar(ref, { tipo: "observar" });
    relogio += 120_001;
    await expect(ex.executar(ref, { tipo: "clicar", x: 1, y: 1, quadro: t2!.quadro })).rejects.toMatchObject({ motivo: "tela_alterada" });
  });

  it("o que a máquina de fora não tem responde acao_falhou com o que fazer, nunca sucesso", async () => {
    const ex = criarExecutorPorPrimitivas({} as PrimitivasDeComputador, { raiz: "/workspace" });
    for (const acao of [{ tipo: "audio", segundos: 2 }, { tipo: "dialogo", aceitar: true, quadro: "q" }, { tipo: "anexar", caminho: "a", quadro: "q" }] as const) {
      const e = await ex.executar(ref, acao).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(FalhaComputador);
      expect((e as FalhaComputador).motivo).toBe("acao_falhou");
      expect((e as FalhaComputador).detalhe).toMatch(/pela tela|provedor/);
    }
  });

  it("caminho fora da pasta de trabalho é recusado antes de tocar a máquina", async () => {
    const comando = vi.fn();
    const ex = criarExecutorPorPrimitivas({ comando } as unknown as PrimitivasDeComputador, { raiz: "/workspace" });
    await expect(ex.executar(ref, { tipo: "ler_arquivo", caminho: "../etc/passwd" })).rejects.toMatchObject({ motivo: "acao_falhou" });
    expect(comando).not.toHaveBeenCalled();
  });

  it("arquivos, texto com revisão, link para fora e escrita em pedaços contra um bash de verdade", async (ctx) => {
    if (!maquina) return ctx.skip();
    const ex = criarExecutorPorPrimitivas(maquina, { raiz });
    const novo = await ex.executar(ref, { tipo: "gravar_texto", caminho: "notas/a.txt", texto: "olá ✓", revisao: "novo" });
    expect(readFileSync(join(raiz, "notas/a.txt"), "utf8")).toBe("olá ✓");
    await expect(ex.executar(ref, { tipo: "gravar_texto", caminho: "notas/a.txt", texto: "x", revisao: "novo" })).rejects.toMatchObject({ detalhe: expect.stringMatching(/arquivo_alterado/) });
    const lido = await ex.executar(ref, { tipo: "ler_texto", caminho: "notas/a.txt", inicio: 0 });
    expect(lido.texto).toMatchObject({ conteudo: "olá ✓", proximo: null, revisao: novo.revisao });
    await ex.executar(ref, { tipo: "gravar_texto", caminho: "notas/a.txt", texto: "segunda", revisao: lido.texto!.revisao });
    await expect(ex.executar(ref, { tipo: "gravar_texto", caminho: "notas/a.txt", texto: "terceira", revisao: lido.texto!.revisao })).rejects.toMatchObject({ detalhe: expect.stringMatching(/arquivo_alterado/) });
    expect(readFileSync(join(raiz, "notas/a.txt"), "utf8")).toBe("segunda");

    // Binário maior que um pedaço: vários comandos, cada um abaixo do MAX_ARG_STRLEN, e o arquivo sai igual.
    const grande = Buffer.alloc(150_000, 7);
    maquina.comandos.length = 0;
    await ex.executar(ref, { tipo: "gravar_arquivo", caminho: "bin/g.dat", base64: grande.toString("base64") });
    expect(readFileSync(join(raiz, "bin/g.dat")).equals(grande)).toBe(true);
    expect(maquina.comandos.length).toBeGreaterThan(2);
    for (const c of maquina.comandos) expect(c.length).toBeLessThan(PEDACO_BASE64 + 2048);
    const volta = await ex.executar(ref, { tipo: "ler_arquivo", caminho: "bin/g.dat" });
    expect(Buffer.from(volta.arquivo!.base64, "base64").equals(grande)).toBe(true);

    const lista = await ex.executar(ref, { tipo: "arquivos", caminho: "." });
    expect(lista.arquivos!.map((a) => `${a.nome}:${a.diretorio}`).sort()).toEqual(["bin:true", "notas:true"]);

    // Um link dentro da raiz que aponta para fora: o realpath da máquina recusa.
    symlinkSync(join(base, "segredo.txt"), join(raiz, "atalho"));
    await expect(ex.executar(ref, { tipo: "ler_arquivo", caminho: "atalho" })).rejects.toMatchObject({ detalhe: expect.stringMatching(/fora da pasta/) });

    const t = await ex.executar(ref, { tipo: "terminal", comando: "pwd; exit 3" });
    expect(t.codigoSaida).toBe(3);
    expect(t.saida).toContain("workspace");
  }, 30_000);

  it("a página de texto é a mesma do runtime do nod (5500 escapados, Unicode inteiro)", () => {
    const longo = "a".repeat(6000);
    expect(paginar(longo, 0, "r")).toMatchObject({ inicio: 0, proximo: 5500, total: 6000 });
    expect(paginar("\n".repeat(3000), 0, "r").conteudo.length).toBe(2750);
  });
});

type Chamada = { metodo: string; url: string; corpo: unknown; headers: Record<string, string> };
function orgoFalso(estado: { status: string; existe: boolean; saude?: string }) {
  const chamadas: Chamada[] = [];
  const resp = (status: number, corpo: unknown) => ({ status, ok: status < 400, json: async () => corpo, text: async () => JSON.stringify(corpo) });
  const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const caminho = url.replace("https://www.orgo.ai/api", "");
    chamadas.push({ metodo: init.method, url: caminho, corpo: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    const pc = { id: "orgo-uuid", name: nomeNoOrgo(ID), status: estado.status, connection_url: "https://www.orgo.ai/desktops/abc", vnc_password: "senha-vnc" };
    if (init.method === "GET" && caminho === "/workspaces") return resp(200, { workspaces: [{ id: "ws1", name: "nod", desktops: estado.existe ? [pc] : [] }] });
    if (init.method === "POST" && caminho === "/computers") { estado.existe = true; estado.status = "running"; return resp(201, pc); }
    if (init.method === "GET" && caminho === "/computers/orgo-uuid") return resp(200, pc);
    if (caminho === "/computers/orgo-uuid/start") { estado.status = "running"; return resp(200, { success: true }); }
    if (caminho === "/computers/orgo-uuid/stop") { estado.status = "frozen"; return resp(200, { success: true }); }
    if (caminho === "/computers/orgo-uuid/health") return resp(200, { overall: estado.saude ?? "healthy", checks: [] });
    if (caminho.startsWith("/computers/orgo-uuid/screenshot")) return resp(200, { image: PNG, width: 1280, height: 800 });
    if (caminho === "/computers/orgo-uuid/bash") return resp(200, { output: "ok\n", exit_code: 0 });
    if (init.method === "POST" && caminho.startsWith("/computers/orgo-uuid/")) return resp(200, { success: true });
    return resp(404, { error: "não achei" });
  };
  return { chamadas, fetchImpl };
}

describe("driver Orgo (pela documentação, sem conta)", () => {
  const CHAVE = "sk_live_teste_que_nao_pode_vazar";
  const env = { NOD_COMPUTADOR_ORGO: "1" };
  const ref = { id: ID, escopo: ESCOPO };

  it("desligado sem a flag: não chama a rede", async () => {
    const f = orgoFalso({ status: "running", existe: true });
    const p = criarProvedorOrgo({ env: {}, chaveDe: async () => CHAVE, fetchImpl: f.fetchImpl });
    expect((await p.ambiente()).disponivel).toBe(false);
    await expect(p.iniciar(ref)).rejects.toMatchObject({ motivo: "nao_iniciou" });
    expect(f.chamadas).toEqual([]);
  });

  it("sem a chave no cofre: diz para pedir com pedir_credencial, sem chamar a rede", async () => {
    const f = orgoFalso({ status: "running", existe: true });
    const p = criarProvedorOrgo({ env, chaveDe: async () => null, fetchImpl: f.fetchImpl });
    expect((await p.ambiente({ escopo: ESCOPO })).motivo).toMatch(/chave do Orgo/);
    await expect(p.iniciar(ref)).rejects.toMatchObject({ detalhe: expect.stringMatching(/pedir_credencial/) });
    expect(f.chamadas).toEqual([]);
  });

  it("cria com nome nod-<id> e Idempotency-Key, liga e fica pronto pela saúde; a chave só vai no header", async () => {
    const f = orgoFalso({ status: "running", existe: false });
    const p = criarProvedorOrgo({ env, chaveDe: async () => CHAVE, fetchImpl: f.fetchImpl, pausa: async () => undefined });
    await p.iniciar(ref);
    const criar = f.chamadas.find((c) => c.metodo === "POST" && c.url === "/computers")!;
    expect(criar.corpo).toMatchObject({ workspace_id: "ws1", name: `nod-${ID}`, os: "linux", resolution: "1280x800x24" });
    expect(criar.headers["idempotency-key"]).toBe(`nod-criar-${ID}`);
    for (const c of f.chamadas) {
      expect(c.headers.authorization).toBe(`Bearer ${CHAVE}`);
      expect(c.url).not.toContain(CHAVE);
      expect(JSON.stringify(c.corpo ?? {})).not.toContain(CHAVE);
    }
    expect((await p.saude(ref)).pronto).toBe(true);
  });

  it("parado (frozen) liga com start; parar arquiva com stop", async () => {
    const f = orgoFalso({ status: "frozen", existe: true });
    const p = criarProvedorOrgo({ env, chaveDe: async () => CHAVE, fetchImpl: f.fetchImpl, pausa: async () => undefined });
    await p.iniciar(ref);
    expect(f.chamadas.some((c) => c.url === "/computers/orgo-uuid/start")).toBe(true);
    await p.parar(ref);
    expect(f.chamadas.some((c) => c.url === "/computers/orgo-uuid/stop")).toBe(true);
    expect((await p.saude(ref)).estado).toBe("parado");
  });

  it("401 vira nao_iniciou sem a chave no detalhe", async () => {
    const p = criarProvedorOrgo({ env, chaveDe: async () => CHAVE, fetchImpl: async () => ({ status: 401, ok: false, json: async () => ({}), text: async () => '{"error":"invalid key"}' }) });
    const e = (await p.iniciar(ref).catch((x: unknown) => x)) as FalhaComputador;
    expect(e.motivo).toBe("nao_iniciou");
    expect(e.detalhe).not.toContain(CHAVE);
  });

  it("as ações do bot passam pela camada de primitivas e viram as rotas do Orgo", async () => {
    const f = orgoFalso({ status: "running", existe: true });
    const orgo = criarProvedorOrgo({ env, chaveDe: async () => CHAVE, fetchImpl: f.fetchImpl, pausa: async () => undefined });
    const { config } = configDeProvedores({ NOD_COMPUTADOR_PROVEDOR: "orgo" });
    const driver = criarDriverPorProvedor({ config, provedores: { orgo }, agenteDe: async () => BOT });
    const { tela } = await driver.executar(ID, { tipo: "observar" }, ESCOPO);
    expect(tela!.imagem).toBe(PNG);
    await driver.executar(ID, { tipo: "tecla", tecla: "Control+Enter", quadro: tela!.quadro }, ESCOPO);
    expect(f.chamadas.find((c) => c.url === "/computers/orgo-uuid/key")!.corpo).toEqual({ key: "ctrl+Return" });
    const t = await driver.executar(ID, { tipo: "terminal", comando: "echo ok" }, ESCOPO);
    expect(t.saida).toBe("ok\n");
    expect((await orgo.acessoTela!(ref)).url).toBe("wss://www.orgo.ai/desktops/abc/ws/websockify");
  });

  it("status e teclas no vocabulário do nod", () => {
    expect(estadoDoOrgo("frozen")).toBe("parado");
    expect(estadoDoOrgo("suspended")).toBe("suspenso");
    expect(estadoDoOrgo("??")).toBe("erro");
    expect(teclaParaOrgo("ArrowDown")).toBe("Down");
  });
});

function provedorFalso(id: "docker" | "orgo", eventos: string[]): ProvedorDeComputador {
  return {
    id,
    capacidades: { retomarComMemoria: false, snapshot: "nenhum", telaAoVivo: "capturas", terminal: "comando", navegador: "tela", audio: false, onde: "host_do_servidor" },
    ambiente: async () => ({ disponivel: true, motivo: null }),
    criar: async () => undefined,
    iniciar: async (r) => { eventos.push(`${id}:iniciar:${r.id}`); },
    parar: async (r) => { eventos.push(`${id}:parar:${r.id}`); },
    retomar: async () => undefined,
    saude: async () => ({ estado: "ligado", pronto: true, motivo: null, detalhe: null, reinicios: null }),
    ligados: async () => new Set([`${id}-ligado`]),
    executar: async () => { eventos.push(`${id}:executar`); return { saida: id }; },
  };
}

describe("seletor de provedor (o DriverComputador de sempre)", () => {
  it("cada bot usa o seu provedor; o agente e o portão não mudam", async () => {
    const eventos: string[] = [];
    const { config } = configDeProvedores({ NOD_COMPUTADORES: "docker", NOD_COMPUTADOR_PROVEDOR_POR_BOT: JSON.stringify({ [BOT]: "orgo" }) });
    const outro = "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const driver = criarDriverPorProvedor({ config, provedores: { docker: provedorFalso("docker", eventos), orgo: provedorFalso("orgo", eventos) }, agenteDe: async (id) => (id === ID ? BOT : null) });
    expect((await driver.executar(ID, { tipo: "observar" }, ESCOPO)).saida).toBe("orgo");
    expect((await driver.executar(outro, { tipo: "observar" }, ESCOPO)).saida).toBe("docker");
    expect(await driver.provedorDe(ID, ESCOPO)).toBe("orgo");
    expect([...await driver.ligados()].sort()).toEqual(["docker-ligado", "orgo-ligado"]);
  });

  it("a escolha mudou com o computador ligado: desliga no antigo antes de ligar no novo", async () => {
    const eventos: string[] = [];
    const mapa: Record<string, "docker" | "orgo"> = {};
    const config = { padrao: "docker" as const, global: null, porPessoa: {}, porBot: mapa };
    const driver = criarDriverPorProvedor({ config, provedores: { docker: provedorFalso("docker", eventos), orgo: provedorFalso("orgo", eventos) }, agenteDe: async () => BOT });
    await driver.iniciar(ID, ESCOPO);
    mapa[BOT] = "orgo";
    await driver.iniciar(ID, ESCOPO);
    expect(eventos).toEqual([`docker:iniciar:${ID}`, `docker:parar:${ID}`, `orgo:iniciar:${ID}`]);
  });

  it("provedor escolhido e não montado: falha fechada, sem cair em outro", async () => {
    const config = { padrao: null, global: "orgo" as const, porPessoa: {}, porBot: {} };
    const driver = criarDriverPorProvedor({ config, provedores: { docker: provedorFalso("docker", []) }, agenteDe: async () => null });
    await expect(driver.iniciar(ID, ESCOPO)).rejects.toMatchObject({ motivo: "nao_iniciou" });
    expect((await driver.estado(ID, ESCOPO)).disponivel).toBe(false);
  });
});

describe("Docker como provedor", () => {
  const base: DriverComputador = {
    ambiente: async () => ({ disponivel: true, motivo: null }),
    estado: async () => ({ disponivel: true, ativo: false, motivo: null, reinicios: 2 }),
    iniciar: async () => undefined,
    parar: async () => undefined,
    executar: async () => ({ saida: "do runtime" }),
    ligados: async () => new Set<string>(),
  };

  it("veste o driver de sempre: ações e saúde passam direto", async () => {
    const p = criarProvedorDocker({}, { driver: base, docker: vi.fn() });
    expect(await p.executar!({ id: ID }, { tipo: "observar" })).toEqual({ saida: "do runtime" });
    expect(await p.saude({ id: ID })).toMatchObject({ estado: "parado", pronto: false, reinicios: 2 });
  });

  it("snapshot copia os dois volumes com a imagem local, sem rede; ligado é recusado", async () => {
    const docker = vi.fn(async () => "");
    const p = criarProvedorDocker({}, { driver: base, docker });
    await p.snapshot!({ id: ID }, "antes-do-teste");
    const runs = docker.mock.calls.map((c) => (c as unknown as [string[]])[0]).filter((a) => a[0] === "run");
    expect(runs).toHaveLength(2);
    for (const a of runs) {
      expect(a).toContain("--network");
      expect(a[a.indexOf("--network") + 1]).toBe("none");
      expect(a).toContain("nod-computador:1");
    }
    expect(runs[0]!.join(" ")).toContain(`source=nod-computador-${ID}-home,target=/de,readonly`);
    expect(runs[0]!.join(" ")).toContain(`source=nod-computador-${ID}-foto-antes-do-teste-home,target=/para`);
    const ligado = criarProvedorDocker({}, { driver: { ...base, ligados: async () => new Set([ID]) }, docker });
    await expect(ligado.snapshot!({ id: ID }, "x")).rejects.toMatchObject({ motivo: "ocupado" });
    await expect(p.snapshot!({ id: ID }, "Rótulo Inválido")).rejects.toMatchObject({ codigo: "entrada_invalida" });
  });
});
