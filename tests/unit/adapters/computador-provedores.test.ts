import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DriverComputador } from "../../../src/contracts/computador.ts";
import type { PrimitivasDeComputador, ProvedorDeComputador } from "../../../src/contracts/provedor-computador.ts";
import { criarControleDockerCompartilhado, criarProvedorDocker } from "../../../src/adapters/computador/provedores/docker.ts";
import { criarProvedorOrgo, estadoDoOrgo, nomeNoOrgo, teclaParaOrgo, urlVncDoOrgo } from "../../../src/adapters/computador/provedores/orgo.ts";
import { criarExecutorPorPrimitivas, paginar, PEDACO_BASE64 } from "../../../src/adapters/computador/provedores/primitivas.ts";
import { criarDriverPorProvedor } from "../../../src/adapters/computador/provedores/seletor.ts";
import { FalhaComputador } from "../../../src/domain/computador.ts";
import { configDeProvedores, escolherProvedor, lerMapaDeProvedores, provedoresEmUso } from "../../../src/domain/provedor-computador.ts";
import { conferirAssinatura, gerarParX25519, publicaDeAssinatura } from "../../../src/adapters/computador/selo.ts";

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

  it("quadros do mesmo UUID em tenants diferentes não se autorizam", async () => {
    const p = { capturarTela: async () => ({ png: PNG, largura: 1280, altura: 800 }), clicar: vi.fn(async () => undefined) } as unknown as PrimitivasDeComputador;
    const ex = criarExecutorPorPrimitivas(p, { raiz: "/workspace" });
    const outro = { id: ID, escopo: { tenantId: "t2", pessoaId: PESSOA } };
    const { tela } = await ex.executar(ref, { tipo: "observar" });
    await expect(ex.executar(outro, { tipo: "clicar", x: 1, y: 1, quadro: tela!.quadro })).rejects.toMatchObject({ motivo: "tela_alterada" });
    expect(p.clicar).not.toHaveBeenCalled();
  });

  it("quadros de displays diferentes da mesma máquina não invalidam nem autorizam o vizinho", async () => {
    const p = { capturarTela: async () => ({ png: PNG, largura: 1280, altura: 800 }), clicar: vi.fn(async () => undefined) } as unknown as PrimitivasDeComputador;
    const ex = criarExecutorPorPrimitivas(p, { raiz: "/workspace" });
    const a = { ...ref, telaId: "11111111-1111-4111-8111-111111111111", agenteId: BOT };
    const b = { ...ref, telaId: "22222222-2222-4222-8222-222222222222", agenteId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    const qa = (await ex.executar(a, { tipo: "observar" })).tela!.quadro;
    const qb = (await ex.executar(b, { tipo: "observar" })).tela!.quadro;
    await ex.executar(a, { tipo: "clicar", x: 1, y: 1, quadro: qa });
    await ex.executar(b, { tipo: "clicar", x: 2, y: 2, quadro: qb });
    await expect(ex.executar(b, { tipo: "clicar", x: 3, y: 3, quadro: qa })).rejects.toMatchObject({ motivo: "tela_alterada" });
  });

  it("o que a máquina de fora não tem responde acao_falhou com o que fazer, nunca sucesso", async () => {
    const ex = criarExecutorPorPrimitivas({} as PrimitivasDeComputador, { raiz: "/workspace" });
    for (const acao of [{ tipo: "elementos", operacao: "observar" }, { tipo: "audio", segundos: 2 }, { tipo: "dialogo", aceitar: true, quadro: "q" }, { tipo: "anexar", caminho: "a", quadro: "q" }] as const) {
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
    const noLimite = "a".repeat(131071) + "😀";
    await ex.executar(ref, { tipo: "gravar_texto", caminho: "notas/limite.txt", texto: noLimite, revisao: "novo" });
    expect(readFileSync(join(raiz, "notas/limite.txt"), "utf8")).toBe(noLimite);

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
  const screens: { id: string }[] = [];
  const resp = (status: number, corpo: unknown) => ({ status, ok: status < 400, json: async () => corpo, text: async () => JSON.stringify(corpo) });
  const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const caminho = url.replace("https://www.orgo.ai/api", "");
    chamadas.push({ metodo: init.method, url: caminho, corpo: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
    const pc = { id: "orgo-uuid", name: nomeNoOrgo(ID, ESCOPO), status: estado.status, connection_url: "https://www.orgo.ai/desktops/abc", vnc_password: "senha-vnc" };
    if (init.method === "GET" && caminho === "/workspaces") return resp(200, { workspaces: [{ id: "ws1", name: "nod", desktops: estado.existe ? [pc] : [] }] });
    if (init.method === "POST" && caminho === "/computers") { estado.existe = true; estado.status = "running"; return resp(201, pc); }
    if (init.method === "GET" && caminho === "/computers/orgo-uuid") return estado.existe ? resp(200, pc) : resp(404, { error: "não achei" });
    if (init.method === "DELETE" && caminho === "/computers/orgo-uuid") { estado.existe = false; estado.status = "deleted"; return resp(200, { success: true }); }
    if (caminho === "/computers/orgo-uuid/start") { estado.status = "running"; return resp(200, { success: true }); }
    if (caminho === "/computers/orgo-uuid/stop") { estado.status = "frozen"; return resp(200, { success: true }); }
    if (caminho === "/computers/orgo-uuid/health") return resp(200, { overall: estado.saude ?? "healthy", checks: [] });
    if (init.method === "GET" && caminho === "/computers/orgo-uuid/screens") return resp(200, { screens });
    if (init.method === "GET" && caminho.startsWith("/computers/orgo-uuid/screens/")) return screens.some((s) => caminho.endsWith(`/${s.id}`)) ? resp(200, screens.find((s) => caminho.endsWith(`/${s.id}`))) : resp(404, {});
    if (init.method === "POST" && caminho === "/computers/orgo-uuid/screens") { const s = { id: `screen-${screens.length + 1}` }; screens.push(s); return resp(201, s); }
    if (caminho.startsWith("/computers/orgo-uuid/screenshot")) return resp(200, { image: PNG, width: 1280, height: 800 });
    if (caminho.startsWith("/computers/orgo-uuid/bash")) return resp(200, { output: "ok\n", exit_code: 0 });
    if (init.method === "POST" && caminho.startsWith("/computers/orgo-uuid/")) return resp(200, { success: true });
    return resp(404, { error: "não achei" });
  };
  return { chamadas, fetchImpl, screens };
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

  it("produção falha fechada mesmo com a flag até o contrato seguro do template Orgo ser validado", async () => {
    const p = criarProvedorOrgo({ env, chaveDe: async () => CHAVE });
    await expect(p.ambiente({ escopo: ESCOPO })).resolves.toMatchObject({ disponivel: false, motivo: expect.stringMatching(/isolamento e logins compartilhados/) });
    await expect(p.iniciar(ref)).rejects.toMatchObject({ motivo: "nao_iniciou" });
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
    expect(criar.corpo).toMatchObject({ workspace_id: "ws1", name: nomeNoOrgo(ID, ESCOPO), os: "linux", resolution: "1280x800x24" });
    expect(criar.headers["idempotency-key"]).toMatch(new RegExp(`^nod-criar-[a-f0-9]{12}-${ID}$`));
    for (const c of f.chamadas) {
      expect(c.headers.authorization).toBe(`Bearer ${CHAVE}`);
      expect(c.url).not.toContain(CHAVE);
      expect(JSON.stringify(c.corpo ?? {})).not.toContain(CHAVE);
    }
    expect((await p.saude(ref)).pronto).toBe(true);
  });

  it("duas criações concorrentes alugam um display só", async () => {
    const f = orgoFalso({ status: "running", existe: false });
    const p = criarProvedorOrgo({ env, chaveDe: async () => CHAVE, fetchImpl: f.fetchImpl, pausa: async () => undefined });
    await Promise.all([p.criar(ref), p.criar(ref)]);
    expect(f.chamadas.filter((c) => c.metodo === "POST" && c.url === "/computers")).toHaveLength(1);
  });

  it("três bots concorrentes alugam displays distintos na mesma máquina e cada ação leva seu screen", async () => {
    const f = orgoFalso({ status: "running", existe: true });
    const refs = new Map<string, string>();
    const p = criarProvedorOrgo({ env, chaveDe: async () => CHAVE, fetchImpl: f.fetchImpl, pausa: async () => undefined,
      displayRefDe: async (tela) => refs.get(tela) ?? null,
      displaysRefDoComputador: async () => [...refs.values()],
      fixarDisplayRef: async (tela, display) => {
        if (display === null) { refs.delete(tela); return true; }
        if ([...refs.entries()].some(([outra, atual]) => outra !== tela && atual === display)) return false;
        refs.set(tela, display);
        return true;
      },
    });
    const bots = ["ana", "beto", "caio"].map((nome, i) => ({ ...ref, telaId: `${i + 1}1111111-1111-4111-8111-111111111111`, agenteId: nome }));
    await Promise.all(bots.map((bot) => p.iniciar(bot)));
    expect(new Set(refs.values()).size).toBe(3);
    expect(f.chamadas.filter((c) => c.metodo === "POST" && c.url === "/computers")).toHaveLength(0);
    await Promise.all(bots.map((bot) => p.primitivas!.capturarTela!(bot)));
    for (const display of refs.values()) expect(f.chamadas.some((c) => c.url.includes(`screenshot?screen=${display}`))).toBe(true);
  });

  it("a quota de displays continua exata com alugueis concorrentes", async () => {
    const f = orgoFalso({ status: "running", existe: true });
    const refs = new Map<string, string>();
    const p = criarProvedorOrgo({ env: { ...env, NOD_ORGO_DISPLAY_MAX: "2" }, chaveDe: async () => CHAVE, fetchImpl: f.fetchImpl,
      displayRefDe: async (tela) => refs.get(tela) ?? null,
      displaysRefDoComputador: async () => [...refs.values()],
      fixarDisplayRef: async (tela, display) => {
        if (!display) return refs.delete(tela);
        if ([...refs.values()].includes(display)) return false;
        refs.set(tela, display);
        return true;
      },
    });
    const telas = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
    const resultados = await Promise.allSettled(telas.map((telaId, i) => p.iniciar({ ...ref, telaId, agenteId: `00000000-0000-4000-8000-00000000000${i}` })));
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(resultados.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(f.screens).toHaveLength(2);
  });

  it("falha fechada: erro transitório ao validar screen não apaga nem realoca o display", async () => {
    const f = orgoFalso({ status: "running", existe: true });
    let display: string | null = "screen-1";
    let limpar = 0;
    f.screens.push({ id: "screen-1" });
    const fetchImpl = async (...args: Parameters<typeof f.fetchImpl>) => {
      const caminho = args[0].replace("https://www.orgo.ai/api", "");
      if (caminho.endsWith("/screens/screen-1")) return { status: 503, ok: false, json: async () => ({}), text: async () => "" };
      return f.fetchImpl(...args);
    };
    const p = criarProvedorOrgo({ env, chaveDe: async () => CHAVE, fetchImpl, pausa: async () => undefined,
      displayRefDe: async () => display,
      displaysRefDoComputador: async () => display ? [display] : [],
      fixarDisplayRef: async (_tela, ref) => { if (ref === null) limpar++; display = ref; return true; },
    });
    const bot = { ...ref, telaId: "11111111-1111-4111-8111-111111111111", agenteId: BOT };
    await expect(p.primitivas!.capturarTela!(bot)).rejects.toMatchObject({ motivo: "sem_resposta" });
    expect(display).toBe("screen-1");
    expect(limpar).toBe(0);
    expect(f.screens).toHaveLength(1);
  });

  it("criações concorrentes do mesmo UUID de pessoa e computador em tenants diferentes não se juntam", async () => {
    let liberarPrimeira!: () => void;
    const primeiraPendente = new Promise<void>((resolve) => { liberarPrimeira = resolve; });
    const chamadas: { url: string; chave: string; corpo?: Record<string, unknown> }[] = [];
    let primeiraLista = true;
    const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      const caminho = url.replace("https://www.orgo.ai/api", "");
      const chave = init.headers.authorization ?? "";
      chamadas.push({ url: caminho, chave, ...(init.body ? { corpo: JSON.parse(init.body) as Record<string, unknown> } : {}) });
      if (caminho === "/workspaces") {
        if (primeiraLista) { primeiraLista = false; await primeiraPendente; }
        return { status: 200, ok: true, json: async () => ({ workspaces: [{ id: `ws-${chave}`, name: "nod", desktops: [] }] }), text: async () => "" };
      }
      if (caminho === "/computers") {
        return { status: 201, ok: true, json: async () => ({ id: `pc-${chave}`, status: "running" }), text: async () => "" };
      }
      return { status: 404, ok: false, json: async () => ({}), text: async () => "" };
    };
    const p = criarProvedorOrgo({ env, chaveDe: async (escopo) => `chave-${escopo.tenantId}`, fetchImpl });
    const outroTenant = { id: ID, escopo: { tenantId: "t2", pessoaId: PESSOA } };
    const primeira = p.criar(ref);
    await vi.waitFor(() => expect(chamadas).toHaveLength(1));
    const segunda = p.criar(outroTenant);
    await vi.waitFor(() => expect(chamadas.some((c) => c.chave === "Bearer chave-t2")).toBe(true));
    liberarPrimeira();
    await Promise.all([primeira, segunda]);
    const criadas = chamadas.filter((c) => c.url === "/computers");
    expect(criadas).toHaveLength(2);
    expect(new Set(criadas.map((c) => c.corpo?.name)).size).toBe(2);
  });

  it("remoção concorrente espera a criação e vence, sem deixar display órfão", async () => {
    let liberarCriacao!: () => void;
    const criacaoPendente = new Promise<void>((resolve) => { liberarCriacao = resolve; });
    let primeiraLista = true;
    let existe = false;
    const chamadas: string[] = [];
    const pc = () => ({ id: "orgo-uuid", name: nomeNoOrgo(ID, ESCOPO), status: existe ? "running" : "deleted" });
    const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      const caminho = url.replace("https://www.orgo.ai/api", "");
      chamadas.push(`${init.method} ${caminho}`);
      if (caminho === "/workspaces") {
        if (primeiraLista) { primeiraLista = false; await criacaoPendente; }
        return { status: 200, ok: true, json: async () => ({ workspaces: [{ id: "ws1", name: "nod", desktops: existe ? [pc()] : [] }] }), text: async () => "" };
      }
      if (init.method === "POST" && caminho === "/computers") {
        existe = true;
        return { status: 201, ok: true, json: async () => pc(), text: async () => "" };
      }
      if (init.method === "GET" && caminho === "/computers/orgo-uuid") {
        return existe
          ? { status: 200, ok: true, json: async () => pc(), text: async () => "" }
          : { status: 404, ok: false, json: async () => ({}), text: async () => "" };
      }
      if (init.method === "DELETE" && caminho === "/computers/orgo-uuid") {
        existe = false;
        return { status: 200, ok: true, json: async () => ({ success: true }), text: async () => "" };
      }
      return { status: 404, ok: false, json: async () => ({}), text: async () => "" };
    };
    const p = criarProvedorOrgo({ env, chaveDe: async () => CHAVE, fetchImpl });
    const criando = p.criar(ref);
    await vi.waitFor(() => expect(chamadas).toEqual(["GET /workspaces"]));
    const removendo = p.excluir!(ref);
    liberarCriacao();
    await Promise.all([criando, removendo]);
    expect(existe).toBe(false);
    expect(chamadas).toContain("DELETE /computers/orgo-uuid");
  });

  it("remove e recupera o display do mesmo bot sem reutilizar o perfil de outro", async () => {
    const estado = { status: "running", existe: true };
    const f = orgoFalso(estado);
    const p = criarProvedorOrgo({ env, chaveDe: async () => CHAVE, fetchImpl: f.fetchImpl, pausa: async () => undefined });
    await p.excluir!(ref);
    expect(estado.existe).toBe(false);
    await p.iniciar(ref);
    expect(estado.existe).toBe(true);
    expect(f.chamadas.filter((c) => c.metodo === "POST" && c.url === "/computers")).toHaveLength(1);
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

  it("limite do provedor vira orientação fixa e não repete o corpo externo", async () => {
    const p = criarProvedorOrgo({ env, chaveDe: async () => CHAVE, fetchImpl: async () => ({ status: 429, ok: false, json: async () => ({}), text: async () => '{"error":"texto externo com sk_live_vazada"}' }) });
    const e = (await p.iniciar(ref).catch((x: unknown) => x)) as FalhaComputador;
    expect(e.motivo).toBe("limite_de_computadores");
    expect(e.detalhe).toContain("Pare outro computador no Orgo");
    expect(e.detalhe).not.toContain("texto externo");
    expect(e.detalhe).not.toContain("sk_live_vazada");
  });

  it("as ações do bot passam pela camada de primitivas e viram as rotas do Orgo", async () => {
    const f = orgoFalso({ status: "running", existe: true });
    let display: string | null = null;
    const orgo = criarProvedorOrgo({ env, chaveDe: async () => CHAVE, fetchImpl: f.fetchImpl, pausa: async () => undefined,
      displayRefDe: async () => display, displaysRefDoComputador: async () => display ? [display] : [],
      fixarDisplayRef: async (_tela, ref) => { display = ref; return true; },
    });
    const { config } = configDeProvedores({ NOD_COMPUTADOR_PROVEDOR: "orgo" });
    const driver = criarDriverPorProvedor({ config, provedores: { orgo }, localizar: async () => ({ computadorId: ID, telaId: "11111111-1111-4111-8111-111111111111", agenteId: BOT }) });
    const { tela } = await driver.executar(ID, { tipo: "observar" }, ESCOPO);
    expect(tela!.imagem).toBe(PNG);
    await driver.executar(ID, { tipo: "tecla", tecla: "Control+Enter", quadro: tela!.quadro }, ESCOPO);
    expect(f.chamadas.find((c) => c.url.startsWith("/computers/orgo-uuid/key?screen="))!.corpo).toEqual({ key: "ctrl+Return" });
    const t = await driver.executar(ID, { tipo: "terminal", comando: "echo ok" }, ESCOPO);
    expect(t.saida).toBe("ok\n");
    expect((await orgo.acessoTela!(ref)).url).toBe("wss://www.orgo.ai/desktops/abc/ws/websockify");
  });

  it("status e teclas no vocabulário do nod", () => {
    expect(estadoDoOrgo("frozen")).toBe("parado");
    expect(estadoDoOrgo("suspended")).toBe("suspenso");
    expect(estadoDoOrgo("??")).toBe("erro");
    expect(teclaParaOrgo("ArrowDown")).toBe("Down");
    expect(urlVncDoOrgo("https://edge.orgo.ai/desktops/abc?segredo=fora")).toBe("wss://edge.orgo.ai/desktops/abc/ws/websockify");
    expect(() => urlVncDoOrgo("http://127.0.0.1:8080")).toThrowError(expect.objectContaining({ motivo: "sem_resposta" }));
    expect(nomeNoOrgo(ID, ESCOPO)).not.toBe(nomeNoOrgo(ID, { tenantId: "t2", pessoaId: PESSOA }));
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
  it("três bots simultâneos usam uma máquina e três identidades de display", async () => {
    const refs: { id: string; telaId?: string; agenteId?: string }[] = [];
    const provedor = { ...provedorFalso("docker", []), iniciar: async (r: Parameters<ProvedorDeComputador["iniciar"]>[0]) => { refs.push(r); } };
    const { config } = configDeProvedores({ NOD_COMPUTADORES: "docker" });
    const telas = [
      { telaId: "11111111-1111-4111-8111-111111111111", agenteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { telaId: "22222222-2222-4222-8222-222222222222", agenteId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      { telaId: "33333333-3333-4333-8333-333333333333", agenteId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    ];
    const porTela = new Map(telas.map((t) => [t.telaId, t]));
    const driver = criarDriverPorProvedor({ config, provedores: { docker: provedor }, localizar: async (id) => {
      const t = porTela.get(id);
      return t ? { computadorId: ID, ...t } : null;
    } });
    await Promise.all(telas.map((t) => driver.iniciar(t.telaId, ESCOPO)));
    expect(new Set(refs.map((r) => r.id))).toEqual(new Set([ID]));
    expect(new Set(refs.map((r) => r.telaId))).toEqual(new Set(telas.map((t) => t.telaId)));
    expect(new Set(refs.map((r) => r.agenteId))).toEqual(new Set(telas.map((t) => t.agenteId)));
    expect([...await driver.ligados()]).toEqual(expect.arrayContaining(telas.map((t) => t.telaId)));
  });

  it("override por bot não divide a máquina compartilhada da pessoa entre provedores", async () => {
    const eventos: string[] = [];
    const { config } = configDeProvedores({
      NOD_COMPUTADORES: "docker",
      NOD_COMPUTADOR_PROVEDOR_POR_BOT: JSON.stringify({ [BOT]: "orgo" }),
    });
    const driver = criarDriverPorProvedor({ config, provedores: { docker: provedorFalso("docker", eventos), orgo: provedorFalso("orgo", eventos) },
      localizar: async (id) => ({ computadorId: ID, telaId: id, agenteId: id === "tela-a" ? BOT : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
    });
    await driver.iniciar("tela-a", ESCOPO);
    await driver.iniciar("tela-b", ESCOPO);
    expect(eventos).toEqual([`docker:iniciar:${ID}`, `docker:iniciar:${ID}`]);
  });

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

  it("dois bots simultâneos mantêm displays, perfis e quadros isolados", async () => {
    const vistos: string[] = [];
    const primitivas: PrimitivasDeComputador = {
      capturarTela: async (ref) => { vistos.push(ref.id); return { png: Buffer.from(ref.id).toString("base64"), largura: 1280, altura: 800 }; },
      clicar: async () => undefined, arrastar: async () => undefined, digitar: async () => undefined,
      tecla: async () => undefined, rolar: async () => undefined,
      comando: async () => ({ saida: "", codigoSaida: 0 }), abrirUrl: async () => undefined,
    };
    const orgo: ProvedorDeComputador = {
      ...provedorFalso("orgo", []), executar: undefined, primitivas, raizDeTrabalho: "/workspace",
    };
    const { config } = configDeProvedores({ NOD_COMPUTADOR_PROVEDOR: "orgo" });
    const driver = criarDriverPorProvedor({ config, provedores: { orgo }, agenteDe: async (id) => id === ID ? BOT : "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee" });
    const outro = "22222222-3333-4444-8555-666666666666";
    const [a, b] = await Promise.all([
      driver.executar(ID, { tipo: "observar" }, ESCOPO),
      driver.executar(outro, { tipo: "observar" }, ESCOPO),
    ]);
    expect(vistos.sort()).toEqual([ID, outro].sort());
    expect(a.tela?.imagem).not.toBe(b.tela?.imagem);
    await expect(driver.executar(outro, { tipo: "clicar", x: 1, y: 1, quadro: a.tela!.quadro }, ESCOPO)).rejects.toMatchObject({ motivo: "tela_alterada" });
  });

  it("o mesmo computador UUID em tenants diferentes não compartilha quadro nem ciclo de provedor", async () => {
    const eventos: string[] = [];
    const primitivas: PrimitivasDeComputador = {
      capturarTela: async (ref) => ({ png: Buffer.from(ref.escopo!.tenantId).toString("base64"), largura: 1280, altura: 800 }),
      clicar: async () => undefined, arrastar: async () => undefined, digitar: async () => undefined,
      tecla: async () => undefined, rolar: async () => undefined,
      comando: async () => ({ saida: "", codigoSaida: 0 }), abrirUrl: async () => undefined,
    };
    const orgo: ProvedorDeComputador = { ...provedorFalso("orgo", eventos), executar: undefined, primitivas, raizDeTrabalho: "/workspace" };
    const docker = provedorFalso("docker", eventos);
    const mapa: Record<string, "docker" | "orgo"> = { [BOT]: "docker" };
    const config = { padrao: null, global: null, porPessoa: {}, porBot: mapa };
    const outroEscopo = { tenantId: "99999999-0000-4000-8000-000000000001", pessoaId: "99999999-0000-4000-8000-000000000002" };
    const driver = criarDriverPorProvedor({ config, provedores: { docker, orgo }, agenteDe: async (_id, escopo) => escopo.tenantId === ESCOPO.tenantId ? BOT : "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee" });
    mapa["bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee"] = "orgo";

    await driver.iniciar(ID, ESCOPO);
    await driver.iniciar(ID, outroEscopo);
    expect(eventos).toEqual([`docker:iniciar:${ID}`, `orgo:iniciar:${ID}`]);
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

  it("usa o mesmo contrato vivo: Orgo autentica upstream e Docker abre somente a origem local", async () => {
    const eventos: string[] = [];
    const acessoTela = vi.fn(async () => ({ tipo: "vnc_websocket" as const, url: "wss://www.orgo.ai/desktops/pc/ws/websockify", token: "segredo", validoAte: null }));
    const orgo = { ...provedorFalso("orgo", eventos), capacidades: { ...provedorFalso("orgo", eventos).capacidades, telaAoVivo: "vnc_websocket" as const }, acessoTela };
    const origem = { enviar: vi.fn(), aoDados: vi.fn(), aoFechar: vi.fn(), fechar: vi.fn() };
    const abrirVivo = vi.fn(async () => origem);
    const anexarVivo = vi.fn(() => true);
    const config = { padrao: null, global: "orgo" as const, porPessoa: {}, porBot: {} };
    const driver = criarDriverPorProvedor({ config, provedores: { orgo }, agenteDe: async () => BOT, abrirVivo, anexarVivo });
    await driver.vivo!(ID, { sessao: "s", token: "t" }, ESCOPO);
    expect(acessoTela).toHaveBeenCalledWith({ id: ID, escopo: ESCOPO, agenteId: BOT });
    expect(abrirVivo).toHaveBeenCalledWith(expect.objectContaining({ token: "segredo" }));
    expect(anexarVivo).toHaveBeenCalledWith("s", "t", origem);

    const abrirLocal = vi.fn(async () => origem);
    const docker = { ...provedorFalso("docker", eventos), capacidades: { ...provedorFalso("docker", eventos).capacidades, telaAoVivo: "vnc_websocket" as const }, abrirTelaAoVivo: abrirLocal };
    const local = criarDriverPorProvedor({ config: { ...config, global: "docker" }, provedores: { docker }, agenteDe: async () => BOT, abrirVivo, anexarVivo });
    await local.vivo!(ID, { sessao: "sd", token: "td" }, ESCOPO);
    expect(abrirLocal).toHaveBeenCalledWith({ id: ID, escopo: ESCOPO, agenteId: BOT });
    expect(anexarVivo).toHaveBeenLastCalledWith("sd", "td", origem);
    expect(abrirVivo).toHaveBeenCalledTimes(1);
  });

  it("falha ao ler a identidade do bot não cai no provedor global", async () => {
    const eventos: string[] = [];
    const { config } = configDeProvedores({ NOD_COMPUTADOR_PROVEDOR: "docker", NOD_COMPUTADOR_PROVEDOR_POR_BOT: JSON.stringify({ [BOT]: "orgo" }) });
    const driver = criarDriverPorProvedor({
      config,
      provedores: { docker: provedorFalso("docker", eventos), orgo: provedorFalso("orgo", eventos) },
      agenteDe: async () => { throw new Error("banco indisponível"); },
    });
    await expect(driver.executar(ID, { tipo: "observar" }, ESCOPO)).rejects.toThrow("banco indisponível");
    expect(eventos).toEqual([]);
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
    const origem = { enviar: vi.fn(), aoDados: vi.fn(), aoFechar: vi.fn(), fechar: vi.fn() };
    const abrirVivo = vi.fn(async () => origem);
    const p = criarProvedorDocker({}, { driver: base, docker: vi.fn(), abrirVivo });
    expect(await p.executar!({ id: ID }, { tipo: "observar" })).toEqual({ saida: "do runtime" });
    expect(await p.saude({ id: ID })).toMatchObject({ estado: "parado", pronto: false, reinicios: 2 });
    expect(p.capacidades.telaAoVivo).toBe("vnc_websocket");
    expect(await p.abrirTelaAoVivo!({ id: ID, escopo: ESCOPO })).toBe(origem);
    expect(abrirVivo).toHaveBeenCalledWith(ID);
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

    const hash = createHash("sha256").update(`${ESCOPO.tenantId}:${ESCOPO.pessoaId}`).digest("hex").slice(0, 12);
    const dockerLegado = vi.fn(async () => "");
    const migrado = criarProvedorDocker({ NOD_COMPUTADOR_LEGADO_POR_ID: JSON.stringify({ [ID]: hash }) }, { driver: base, docker: dockerLegado });
    await migrado.snapshot!({ id: ID, escopo: ESCOPO }, "segura");
    const copiaLegada = (dockerLegado.mock.calls[1] as unknown as [string[]])[0].join(" ");
    expect(copiaLegada).toContain(`source=nod-computador-${ID}-home,target=/de,readonly`);

    const outroEscopo = { tenantId: "99999999-0000-4000-8000-000000000001", pessoaId: ESCOPO.pessoaId };
    await migrado.snapshot!({ id: ID, escopo: outroEscopo }, "isolada");
    const copiaDoOutro = (dockerLegado.mock.calls[5] as unknown as [string[]])[0].join(" ");
    expect(copiaDoOutro).not.toContain(`source=nod-computador-${ID}-home,target=/de,readonly`);
  });

  it("duas pessoas ligando juntas não furam o teto de máquinas do host", async () => {
    const supervisorPub = gerarParX25519().publica;
    const criados = new Set<string>();
    const rodando = new Set<string>();
    const docker = vi.fn(async (args: string[], entrada?: string) => {
      if (args[0] === "ps") {
        const foto = [...rodando].filter((n) => n.startsWith("nod-computador-")).join("\n");
        await Promise.resolve();
        return foto;
      }
      if (args[0] === "image" && args[1] === "inspect") return "sha256:imagem";
      if (args[0] === "network" && args[1] === "inspect") return "ok";
      if (args[0] === "inspect" && args[1] === "--format") {
        const nome = args.at(-1)!;
        if (!criados.has(nome)) throw new Error("não existe");
        if (args[2] === "{{.State.Running}}") return rodando.has(nome) ? "true\n" : "false\n";
        if (args[2] === "{{json .Config.Cmd}}") return '["node","supervisor.mjs"]';
        if (args[2] === "{{.Image}}") return "sha256:imagem";
      }
      if (args[0] === "inspect") {
        if (!criados.has(args[1]!)) throw new Error("não existe");
        return "ok";
      }
      if (args[0] === "create") { criados.add(args[args.indexOf("--name") + 1]!); return "ok"; }
      if (args[0] === "start") { rodando.add(args[1]!); return "ok"; }
      if (args[0] === "exec" && args.includes("test")) return "";
      if (args[0] === "exec" && args.some((a) => a.endsWith("/cliente-unico.mjs"))) {
        const pedido = JSON.parse(entrada ?? "{}") as { sonda?: boolean; comando?: { id?: string } };
        return pedido.sonda ? JSON.stringify({ estado: { supervisorPub } }) : JSON.stringify({ resultado: { id: pedido.comando?.id, desfecho: "ok" } });
      }
      return "ok";
    });
    const controle = criarControleDockerCompartilhado({ NOD_COMPUTADORES: "docker", NOD_CREDENTIAL_KEY: "a".repeat(64), NOD_COMPUTADORES_MAX: "1" }, docker);
    const outro = "22222222-3333-4444-8555-666666666666";
    const resultados = await Promise.allSettled([controle.iniciar({ id: ID }), controle.iniciar({ id: outro })]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(resultados.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect([...rodando].filter((n) => n.startsWith("nod-computador-"))).toHaveLength(1);
  });

  it("o mesmo UUID em tenants diferentes recebe containers e volumes diferentes", async () => {
    const supervisorPub = gerarParX25519().publica;
    const criados = new Set<string>();
    const chamadas: string[][] = [];
    const docker = vi.fn(async (args: string[], entrada?: string) => {
      chamadas.push(args);
      if (args[0] === "ps") return "";
      if (args[0] === "image" && args[1] === "inspect") return "sha256:imagem";
      if (args[0] === "network" && args[1] === "inspect") return "ok";
      if (args[0] === "inspect" && args[1] === "--format") return "false\n";
      if (args[0] === "inspect") {
        if (!criados.has(args[1]!)) throw new Error("não existe");
        return "ok";
      }
      if (args[0] === "create") { criados.add(args[args.indexOf("--name") + 1]!); return "ok"; }
      if (args[0] === "exec" && args.includes("test")) return "";
      if (args[0] === "exec" && args.some((a) => a.endsWith("/cliente-unico.mjs"))) {
        const pedido = JSON.parse(entrada ?? "{}") as { sonda?: boolean; comando?: { id?: string } };
        return pedido.sonda ? JSON.stringify({ estado: { supervisorPub } }) : JSON.stringify({ resultado: { id: pedido.comando?.id, desfecho: "ok" } });
      }
      return "ok";
    });
    const controle = criarControleDockerCompartilhado({ NOD_COMPUTADORES: "docker", NOD_CREDENTIAL_KEY: "a".repeat(64) }, docker);
    const outroEscopo = { tenantId: "99999999-0000-4000-8000-000000000001", pessoaId: ESCOPO.pessoaId };
    await controle.iniciar({ id: ID, escopo: ESCOPO });
    await controle.iniciar({ id: ID, escopo: outroEscopo });

    const maquinas = chamadas
      .filter((a) => a[0] === "create" && a.includes("--name"))
      .map((a) => a[a.indexOf("--name") + 1]!)
      .filter((nome) => nome.startsWith("nod-computador-"));
    expect(new Set(maquinas).size).toBe(2);
    const volumes = chamadas.filter((a) => a[0] === "volume" && a[1] === "create").map((a) => a.at(-1));
    expect(new Set(volumes).size).toBe(4);
  });

  it("prepara os volumes rootless, desliga só o sandbox interno do Chromium e assina todo comando efetivo", async () => {
    const credencial = "a".repeat(64);
    const supervisorPub = gerarParX25519().publica;
    const criados = new Set<string>();
    const comandos: Array<Record<string, unknown>> = [];
    const chamadas: string[][] = [];
    const docker = vi.fn(async (args: string[], entrada?: string) => {
      chamadas.push(args);
      if (args[0] === "ps") return "";
      if (args[0] === "image" && args[1] === "inspect") return "sha256:imagem";
      if (args[0] === "network" && args[1] === "inspect") return "ok";
      if (args[0] === "inspect" && args[1] === "--format") return "false\n";
      if (args[0] === "inspect") {
        if (!criados.has(args[1]!)) throw new Error("não existe");
        return "ok";
      }
      if (args[0] === "create") { criados.add(args[args.indexOf("--name") + 1]!); return "ok"; }
      if (args[0] === "run" && args.includes("/opt/nod/terminal-sidecar.mjs")) return JSON.stringify({ saida: "/workspace", codigoSaida: 0 });
      if (args[0] === "exec" && args.includes("test")) return "";
      if (args[0] === "exec" && args.some((a) => a.endsWith("/cliente-unico.mjs"))) {
        const pedido = JSON.parse(entrada ?? "{}") as { sonda?: boolean; comando: Record<string, unknown> };
        if (pedido.sonda) return JSON.stringify({ estado: { supervisorPub } });
        comandos.push(pedido.comando);
        const acao = pedido.comando.acao as { tipo?: string } | undefined;
        return JSON.stringify({ resultado: { id: pedido.comando.id, desfecho: "ok", ...(acao?.tipo === "terminal" ? { resultado: { terminalExterno: true } } : {}) } });
      }
      return "ok";
    });
    const controle = criarControleDockerCompartilhado({ NOD_COMPUTADORES: "docker", NOD_CREDENTIAL_KEY: credencial }, docker);
    await controle.iniciar({ id: ID });
    expect(await controle.executar({ id: ID, agenteId: BOT }, { tipo: "terminal", comando: "pwd" })).toMatchObject({ saida: "/workspace", codigoSaida: 0 });

    const init = chamadas.find((a) => a[0] === "run" && a.includes("chown"));
    expect(init).toEqual(expect.arrayContaining(["--network", "none", "--cap-drop", "ALL", "--cap-add", "CHOWN", "--user", "0:0"]));
    const maquina = chamadas.find((a) => a[0] === "create" && a.includes(`nod-computador-${ID}`))!;
    expect(maquina).toEqual(expect.arrayContaining(["--security-opt", "no-new-privileges", "--cap-drop", "ALL", "--env", "NOD_PC_CHROMIUM_SANDBOX=nao", "--env", "NOD_PC_BWRAP=nao", "--env", "NOD_PC_TERMINAL_EXTERNO=sim"]));
    const terminal = chamadas.find((a) => a[0] === "run" && a.includes("/opt/nod/terminal-sidecar.mjs"))!;
    expect(terminal).toEqual(expect.arrayContaining(["--network", "none", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "1000:1000", "--mount", `type=volume,source=nod-computador-${ID}-workspace,target=/workspace,volume-subpath=${ID}/${BOT}`]));
    expect(comandos).toHaveLength(3);
    for (const comando of comandos) expect(conferirAssinatura(publicaDeAssinatura(credencial, ID), comando as never)).toBe(true);
    expect(comandos.at(-1)).toMatchObject({ tipo: "acao", agenteId: BOT });
  });

  it("espera o socket voltar antes do TOFU quando o container já reiniciou", async () => {
    const supervisorPub = gerarParX25519().publica;
    const maquina = `nod-computador-${ID}`;
    let sondasDoSocket = 0;
    const docker = vi.fn(async (args: string[], entrada?: string) => {
      if (args[0] === "inspect" && args[1] === maquina) return "ok";
      if (args[0] === "inspect" && args[1] === "--format") {
        if (args[2] === "{{.State.Running}}") return "true\n";
        if (args[2] === "{{json .Config.Cmd}}") return '["node","docker-runtime.mjs"]';
        if (args[2] === "{{.Image}}") return "sha256:imagem";
      }
      if (args[0] === "image" && args[1] === "inspect") return "sha256:imagem";
      if (args[0] === "exec" && args.includes("test")) {
        sondasDoSocket += 1;
        if (sondasDoSocket < 2) throw new Error("socket ainda não abriu");
        return "";
      }
      if (args[0] === "exec" && args.some((a) => a.endsWith("/cliente-unico.mjs"))) {
        const pedido = JSON.parse(entrada ?? "{}") as { sonda?: boolean; comando?: { id?: string } };
        return pedido.sonda ? JSON.stringify({ estado: { supervisorPub } }) : JSON.stringify({ resultado: { id: pedido.comando?.id, desfecho: "ok" } });
      }
      return "ok";
    });
    const controle = criarControleDockerCompartilhado({ NOD_COMPUTADORES: "docker", NOD_CREDENTIAL_KEY: "a".repeat(64) }, docker);
    await controle.iniciar({ id: ID });
    expect(sondasDoSocket).toBe(2);
  });
});
