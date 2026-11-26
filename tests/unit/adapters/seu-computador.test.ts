import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarSeuComputador } from "../../../src/adapters/fundo/seu-computador.ts";
import { iniciarNavegadorDaMaquina, lerComandoNavegador, type CanalNavegadorDaMaquina, type NavegadorDaMaquina } from "../../../src/adapters/executor/navegador.ts";
import { criarCanalNavegador } from "../../../src/adapters/navegador/canal-maquina.ts";
import { lerApps } from "../../../src/adapters/seu-computador/apps-locais.ts";
import { arvoreVazia, caixaDaJanela, criarSeuComputadorLocal, efeitoDoResultado, entregaNaoChegou, escolherJanela, foraDoAlcance, lerResultadoDriver, telaBloqueada } from "../../../src/adapters/seu-computador/driver.ts";
import { FERRAMENTAS_SEU_COMPUTADOR, type PedidoSeuComputador, type RespostaSeuComputador } from "../../../src/contracts/seu-computador.ts";
import type { MotorNavegador } from "../../../src/adapters/navegador/motor-agent-browser.ts";
import { acharApp, liberadosAgora, manifestoBounded, motivoDoBloqueio, textoDoPedido } from "../../../src/domain/seu-computador.ts";
import { comLembrarNoNavegador } from "../../../src/use-cases/decidir.ts";
import { MARLON } from "../use-cases/deps-l5.ts";

/**
 * O computador da pessoa (ADR-197) sem o cua-driver de verdade: as regras puras, o módulo da máquina nos caminhos que
 * não sobem o driver, e o portão do servidor de ponta a ponta pela fila real (canal + laço da máquina) com um
 * "computador" falso do lado da máquina.
 */
const A = "00000000-0000-4000-8000-00000000000a";
const MAQ = "00000000-0000-4000-8000-0000000000c1";
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("regras do computador da pessoa", () => {
  it("o manifesto bounded só leva os apps liberados, nunca os bloqueados, sem a tela inteira", () => {
    const m = manifestoBounded([{ id: "com.apple.iWork.Numbers", nome: "Numbers" }, { id: "com.apple.Terminal", nome: "Terminal" }], "darwin");
    expect(m).toContain('bundle_id: "com.apple.iWork.Numbers"');
    expect(m).not.toContain("Terminal");
    expect(m).toContain("display: false");
    expect(m).toContain("version: 3");
    expect(m).not.toMatch(/run_script|kill_app|get_desktop_state/);
    const w = manifestoBounded([{ id: "C:\\Program Files\\Microsoft Office\\root\\Office16\\EXCEL.EXE", nome: "Excel" }, { id: "C:\\Windows\\System32\\cmd.exe", nome: "cmd" }], "win32");
    expect(w).toContain('executable: "C:\\\\Program Files\\\\Microsoft Office\\\\root\\\\Office16\\\\EXCEL.EXE"');
    expect(w).not.toContain("cmd.exe");
    expect(manifestoBounded([], "darwin")).toContain("apps: []");
  });

  it("acha o app pelo nome do sistema, pelo apelido em inglês e pelo começo; aberto ganha; sem nome, os parecidos", () => {
    const apps = [
      { id: "com.apple.TextEdit", nome: "Editor de Texto", apelido: "TextEdit", aberto: false },
      { id: "com.apple.Notes", nome: "Notas", apelido: "Notes", aberto: true },
      { id: "com.apple.iWork.Numbers", nome: "Numbers", aberto: false },
      { id: "com.microsoft.Excel", nome: "Microsoft Excel", aberto: false },
    ];
    expect(acharApp(apps, "textedit")).toMatchObject({ app: { id: "com.apple.TextEdit" } });
    expect(acharApp(apps, "Notas")).toMatchObject({ app: { id: "com.apple.Notes" } });
    expect(acharApp(apps, "numbers")).toMatchObject({ app: { id: "com.apple.iWork.Numbers" } });
    expect(acharApp(apps, "Excel")).toMatchObject({ app: { id: "com.microsoft.Excel" } });
    expect(acharApp(apps, "Photoshop")).toEqual({ parecidos: [] });
  });

  it("bloqueia senhas, ajustes, terminal e o próprio nod nos dois sistemas", () => {
    expect(motivoDoBloqueio({ id: "com.1password.1password", nome: "1Password" }, "darwin")).toBeTruthy();
    expect(motivoDoBloqueio({ id: "app.nod.desktop", nome: "nod" }, "darwin")).toBeTruthy();
    expect(motivoDoBloqueio({ id: "com.apple.iWork.Numbers", nome: "Numbers" }, "darwin")).toBeNull();
    expect(motivoDoBloqueio({ id: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", nome: "PowerShell" }, "win32")).toBeTruthy();
    expect(motivoDoBloqueio({ id: "C:\\Users\\a\\AppData\\Local\\Programs\\nod\\nod.exe", nome: "nod" }, "win32")).toBeTruthy();
  });

  it("desta vez vence no prazo; Sempre não vence", () => {
    const lista = [{ id: "a.b", nome: "A", ate: 100 }, { id: "c.d", nome: "C", ate: null }, { id: "e.f", nome: "E", ate: 300 }];
    expect(liberadosAgora(lista, 200).map((a) => a.id)).toEqual(["c.d", "e.f"]);
  });

  it("o texto do cartão vem do servidor, com o nome do app do sistema e o motivo cortado", () => {
    const t = textoDoPedido({ bot: "Ada", app: "Numbers", motivo: "lançar  as passagens\nde novembro", plataforma: "darwin" });
    expect(t).toEqual({ titulo: "Ada quer usar seu Mac", texto: "Só o Numbers · lançar as passagens de novembro", sim: "Permitir desta vez", sempre: "Sempre no Numbers", nao: "Agora não" });
    expect(textoDoPedido({ bot: "Ada", app: "Excel", motivo: null, plataforma: "win32" }).titulo).toBe("Ada quer usar seu PC");
  });

  it("lê a lista de apps do sistema e descarta id estranho", () => {
    expect(lerApps(JSON.stringify([{ id: "com.apple.Notes", nome: "Notas", aberto: true, pid: 12, apelido: "Notes" }, { id: "rm -rf /", nome: "x" }]), "darwin"))
      .toEqual([{ id: "com.apple.Notes", nome: "Notas", aberto: true, pid: 12, apelido: "Notes" }]);
    expect(lerApps(JSON.stringify({ id: "C:\\Program Files\\App\\app.exe", nome: "App", aberto: false, pid: null }), "win32")).toHaveLength(1);
    expect(lerApps(JSON.stringify([{ id: "C:\\..\\x.exe", nome: "x" }]), "win32")).toEqual([]);
  });
});

describe("respostas do cua-driver", () => {
  it("texto, estruturado, imagem e recusa", () => {
    const r = lerResultadoDriver({ content: [{ type: "text", text: "Clicked" }, { type: "image", mimeType: "image/jpeg", data: "AAA" }], structuredContent: { effect: "confirmed" } });
    expect(r).toEqual({ texto: "Clicked", estruturado: { effect: "confirmed" }, imagem: { mimeType: "image/jpeg", data: "AAA" }, erro: false });
    expect(efeitoDoResultado(r)).toBe("confirmado");
    expect(lerResultadoDriver({ content: [{ type: "text", text: "no" }], structuredContent: { status: "refused" } }).erro).toBe(true);
    expect(efeitoDoResultado(lerResultadoDriver({ content: [{ type: "text", text: "suspected_noop" }] }))).toBe("sem_efeito");
  });

  it("escolhe a maior janela na tela", () => {
    expect(escolherJanela({ windows: [{ window_id: 1, bounds: { width: 10, height: 10 } }, { window_id: 2, bounds: { width: 800, height: 600 } }, { window_id: 3, bounds: { width: 2000, height: 2000 }, is_on_screen: false }] })).toBe(2);
    expect(escolherJanela({ windows: [] })).toBeNull();
    expect(escolherJanela(null)).toBeNull();
  });

  it("a caixa da janela para a borda âmbar, e a tela bloqueada reconhecida", () => {
    expect(caixaDaJanela({ windows: [{ window_id: 7, bounds: { x: 100, y: 80, width: 900, height: 600 } }] }, 7)).toEqual({ x: 100, y: 80, largura: 900, altura: 600 });
    expect(caixaDaJanela({ windows: [{ window_id: 7, frame: { left: 0, top: 0, w: 10, h: 10 } }] }, 7)).toBeNull();
    expect(caixaDaJanela({ windows: [] }, 7)).toBeNull();
    expect(telaBloqueada(lerResultadoDriver({ content: [{ type: "text", text: "Background input refused (screen_locked)" }], isError: true }))).toBe(true);
    expect(telaBloqueada(lerResultadoDriver({ content: [{ type: "text", text: "ok" }], structuredContent: { degraded_reason: "screen_locked" } }))).toBe(true);
    expect(telaBloqueada(lerResultadoDriver({ content: [{ type: "text", text: "ok" }] }))).toBe(false);
    expect(entregaNaoChegou(lerResultadoDriver({ content: [{ type: "text", text: "Sent 20 char(s) via PostMessage, but the focused field's value did not contain the requested text after dispatch. Retry with delivery_mode:\"foreground\"." }] }))).toBe(true);
    expect(entregaNaoChegou(lerResultadoDriver({ content: [{ type: "text", text: "Inserted 20 char(s) into AXTextArea" }] }))).toBe(false);
    // Medido no Mac do dono: a janela em outro Space / app subindo (árvore vazia; entrada por trás recusada).
    expect(arvoreVazia(lerResultadoDriver({ content: [{ type: "text", text: "window_id=1 pid=2 size=656x422 elements=0 ui_tree_revision=1" }] }))).toBe(true);
    expect(arvoreVazia(lerResultadoDriver({ content: [{ type: "text", text: "window_id=1 elements=346 snapshot_id=s1" }] }))).toBe(false);
    expect(foraDoAlcance(lerResultadoDriver({ content: [{ type: "text", text: "Background input refused (off_space_or_ax_unresolved): window 31635 is not among the process's current AXWindows" }], isError: true }))).toBe(true);
    expect(foraDoAlcance(lerResultadoDriver({ content: [{ type: "text", text: "Inserted 20 char(s)" }] }))).toBe(false);
  });
});

describe("o módulo da máquina sem subir o driver", () => {
  const apps = [{ id: "com.apple.iWork.Numbers", nome: "Numbers", aberto: true, pid: 10 }, { id: "com.apple.Terminal", nome: "Terminal", aberto: true, pid: 11 }];
  let subiu = 0;
  const local = () => criarSeuComputadorLocal({ plataforma: "darwin", pasta: "/tmp/nao-usado", binario: async () => { subiu++; return null; }, listarApps: async () => apps });
  beforeEach(() => { subiu = 0; });

  it("app fora da lista do bot volta precisa_liberar, bloqueado volta bloqueado, desconhecido volta nao_achei — sem tocar no driver", async () => {
    const sc = local();
    const pedido = (app: string, liberados: PedidoSeuComputador["apps"] = []): PedidoSeuComputador => ({ acao: "ver", args: { app }, apps: liberados, bot: "Ada" });
    expect(await sc.executar(A, pedido("Numbers"))).toEqual({ tipo: "precisa_liberar", app: { id: "com.apple.iWork.Numbers", nome: "Numbers" } });
    expect(await sc.executar(A, pedido("Terminal", [{ id: "com.apple.Terminal", nome: "Terminal" }]))).toMatchObject({ tipo: "bloqueado" });
    expect(await sc.executar(A, pedido("Keynote"))).toEqual({ tipo: "nao_achei", parecidos: [] });
    expect(subiu).toBe(0);
  });

  it("liberado mas sem o binário: indisponível; Parar recusa por um tempo", async () => {
    const sc = local();
    expect(await sc.executar(A, { acao: "ver", args: { app: "Numbers" }, apps: [{ id: "com.apple.iWork.Numbers", nome: "Numbers" }], bot: "Ada" })).toMatchObject({ tipo: "indisponivel" });
    expect(subiu).toBe(1);
    await sc.parar(60_000);
    expect(await sc.executar(A, { acao: "apps", args: {}, apps: [], bot: "Ada" })).toEqual({ tipo: "parado" });
  });

  it("a pessoa mexendo no mesmo app pausa o bot; parada há 10 s, ele segue; mexendo por 1 min, volta pessoa_usando", async () => {
    let t = 0;
    let ocioso = 0;
    const atividades: string[] = [];
    const sc = criarSeuComputadorLocal({ plataforma: "darwin", pasta: "/tmp/nao-usado", binario: async () => null, listarApps: async () => apps, agora: () => t,
      pessoa: { naFrente: async (id) => id === "com.apple.iWork.Numbers", ociosoS: () => ocioso },
      dormir: async (ms) => { t += ms; ocioso += ms / 1000; },
      aoAtividade: (a) => atividades.push(a.acao) });
    const pedido: PedidoSeuComputador = { acao: "clicar", args: { app: "Numbers", elemento: "s1:1" }, apps: [{ id: "com.apple.iWork.Numbers", nome: "Numbers" }], bot: "Ada" };
    // Parou de mexer: espera os 10 s e segue (aqui sem binário, então indisponível — mas passou da pausa).
    expect(await sc.executar(A, pedido)).toMatchObject({ tipo: "indisponivel" });
    expect(atividades[0]).toBe("pausado");
    expect(t).toBe(10_000);
    // Continua mexendo: depois de 1 min, desiste e diz ao bot.
    t = 0; ocioso = 0; atividades.length = 0;
    const sempre = criarSeuComputadorLocal({ plataforma: "darwin", pasta: "/tmp/nao-usado", binario: async () => null, listarApps: async () => apps, agora: () => t,
      pessoa: { naFrente: async () => true, ociosoS: () => 0 }, dormir: async (ms) => { t += ms; } });
    expect(await sempre.executar(A, pedido)).toMatchObject({ tipo: "pessoa_usando", app: { nome: "Numbers" } });
    // Ler a janela não pausa.
    t = 0;
    expect(await sempre.executar(A, { ...pedido, acao: "ver", args: { app: "Numbers" } })).toMatchObject({ tipo: "indisponivel" });
    expect(t).toBe(0);
  });

  it("a lista de apps esconde os bloqueados", async () => {
    const r = await local().executar(A, { acao: "apps", args: {}, apps: [], bot: "Ada" });
    expect(r).toEqual({ tipo: "apps", apps: [{ id: "com.apple.iWork.Numbers", nome: "Numbers", aberto: true }] });
  });
});

describe("o comando na fila", () => {
  it("a máquina confere o pedido: ação conhecida, apps com id e nome, bot curto", () => {
    const base = { id: "00000000-0000-4000-8000-0000000000e1", agenteId: A, prazoEm: 1 };
    expect(lerComandoNavegador({ ...base, tipo: "seu_computador", pedido: { acao: "ver", args: { app: "Numbers" }, apps: [{ id: "com.apple.iWork.Numbers", nome: "Numbers" }], bot: "Ada" } })).toMatchObject({ tipo: "seu_computador" });
    expect(lerComandoNavegador({ ...base, tipo: "seu_computador", pedido: { acao: "run_script", args: {}, apps: [], bot: "Ada" } })).toBeNull();
    expect(lerComandoNavegador({ ...base, tipo: "seu_computador", pedido: { acao: "ver", args: {}, apps: [{ id: 3 }], bot: "Ada" } })).toBeNull();
  });
});

describe("o portão do servidor, pela fila, até a máquina", () => {
  let agora: number;
  let laco: NavegadorDaMaquina | null = null;
  let trilha: { kind: string; motivo?: string }[];
  let liberados: { agenteId: string; plataforma: string; appId: string; appNome: string; ate: number | null }[];
  let aprovacoes: { itens: { texto: string; destino: { conector: string; ferramenta: string; argumentos: Record<string, unknown> } }[]; resumo: string }[];
  let recebidos: PedidoSeuComputador[];
  let resposta: (p: PedidoSeuComputador) => RespostaSeuComputador;
  afterEach(() => { laco?.parar(); laco = null; });
  beforeEach(() => {
    agora = 1_700_000_000_000; trilha = []; liberados = []; aprovacoes = []; recebidos = [];
    resposta = () => ({ tipo: "feito", texto: "ok" });
  });

  const deps = () => ({
    escopo: MARLON, agora: () => agora,
    repos: {
      trilha: { registrar: async (t: { kind: string; motivo?: string }) => { trilha.push(t); } },
      turnos: { buscar: async (id: string) => ({ id, estado: "executando", agenteId: A, ownerId: MARLON.pessoaId, conversaId: "c1", pararSolicitadoEm: null, motivoInterrupcao: null }), pedirInterrupcao: async () => {} },
      agentes: { buscar: async (id: string) => (id === A ? { id, ownerId: MARLON.pessoaId, nome: "Ada", soLeitura: false } : null), execucaoBloqueada: async () => false },
      paradas: { ativa: async () => false },
      events: { gravarComOutbox: async () => {} },
      seuComputadorApps: {
        doBot: async (agenteId: string, plataforma: string) => liberados.filter((l) => l.agenteId === agenteId && l.plataforma === plataforma).map((l) => ({ id: l.appId, nome: l.appNome, ate: l.ate })),
        liberar: async (p: (typeof liberados)[number]) => { liberados.push(p); return true; },
      },
    },
  });

  function montar(o: { recursos?: string[]; plataforma?: "darwin" | "win32" | "linux" } = {}) {
    const canal = criarCanalNavegador({ agora: Date.now });
    const daMaquina: CanalNavegadorDaMaquina = {
      puxar: async (recursos) => { canal.presenca(MARLON, MAQ, { plataforma: o.plataforma ?? "darwin", nome: "MacBook da Ana", recursos: o.recursos ?? recursos ?? [] }); await esperar(2); return canal.puxar(MARLON, MAQ); },
      resultado: async (r) => canal.resultado(MARLON, MAQ, r),
      vivo: async () => null,
    };
    laco = iniciarNavegadorDaMaquina({ canal: daMaquina, motor: async () => ({}) as MotorNavegador, dormir: async (ms) => { await esperar(Math.min(ms, 5)); },
      seuComputador: { executar: async (_a, p) => { recebidos.push(p); return resposta(p); } } });
    const sc = criarSeuComputador({
      dentro: async <T>(_e: unknown, fn: (d: never) => Promise<T>) => fn(deps() as never), canal, cifrar: (s) => `c:${s}`, decifrar: (s) => s.slice(2), agora: () => agora, prazoMs: 2_000,
      pedirAprovacao: (async (_d: unknown, input: (typeof aprovacoes)[number]) => {
        aprovacoes.push(input);
        return { data: { estado: "pendente", decisao_id: `decisao-${aprovacoes.length}`, instrucao: "encerre o turno" }, events: [] };
      }) as never,
    });
    return { sc, canal };
  }

  const plano = (ferramentas = Object.keys(FERRAMENTAS_SEU_COMPUTADOR)) => ({
    tenantId: MARLON.tenantId, turnoId: "turno-a", agenteId: A, conversaId: "c1", expiraEm: Number.MAX_SAFE_INTEGER,
    autoria: { conta_de_execucao: MARLON.pessoaId, sob_procuracao_de: null },
    catalogo: { ferramentas: ferramentas.map((nome) => ({ nome, origem: "seu_computador" })) },
  }) as never;
  const corpo = (r: unknown) => JSON.parse((r as { conteudo: string }).conteudo) as Record<string, unknown>;

  it("sem Mac/PC que anuncie seu_computador (app antigo, Linux): indisponível na hora, sem esperar o prazo", async () => {
    const { sc } = montar({ recursos: [] });
    await esperar(10);
    expect(sc.disponivel(MARLON)).toBeNull();
    const t0 = Date.now();
    const r = await sc.chamar(MARLON, plano(), "seu_computador_ver", { app: "Numbers" });
    expect(corpo(r)).toMatchObject({ erro: "indisponivel" });
    expect(Date.now() - t0).toBeLessThan(500);
    laco?.parar();
    const linux = montar({ recursos: ["seu_computador"], plataforma: "linux" });
    await esperar(10);
    expect(linux.sc.disponivel(MARLON)).toBeNull();
  });

  it("fora do catálogo e esquema inválido viram negação na trilha, sem ir à máquina", async () => {
    const { sc } = montar();
    await esperar(10);
    expect(await sc.chamar(MARLON, plano(["seu_computador_ver"]), "seu_computador_clicar", { app: "Numbers", x: 1, y: 1 })).toMatchObject({ ok: false, negacao: { motivo: "fora_do_catalogo" } });
    expect(await sc.chamar(MARLON, plano(), "seu_computador_ver", {})).toMatchObject({ ok: false, negacao: { motivo: "args_invalidos" } });
    expect(recebidos).toEqual([]);
    expect(trilha.map((t) => t.motivo)).toEqual(["fora_do_catalogo", "args_invalidos"]);
  });

  it("primeira vez com o app: o cartão, a liberação Sempre e a segunda chamada roda com o app no manifesto", async () => {
    const { sc } = montar();
    await esperar(10);
    expect(sc.disponivel(MARLON)).toEqual({ plataforma: "darwin", nome: "MacBook da Ana" });
    resposta = (p) => (p.apps.some((a) => a.id === "com.apple.iWork.Numbers") ? { tipo: "feito", texto: "[1] AXTable", imagem: { mimeType: "image/jpeg", data: "QUFB" }, app: { id: "com.apple.iWork.Numbers", nome: "Numbers" }, efeito: "confirmado" } : { tipo: "precisa_liberar", app: { id: "com.apple.iWork.Numbers", nome: "Numbers" } });
    const r1 = await sc.chamar(MARLON, plano(), "seu_computador_ver", { app: "numbers", motivo: "lançar as passagens" });
    expect(r1).toEqual({ aguardar: "decisao-1" });
    const item = aprovacoes[0]!.itens[0]!;
    expect(item.texto).toBe("Ada quer usar seu Mac");
    expect(aprovacoes[0]!.resumo).toBe("Só o Numbers · lançar as passagens");
    expect(item.destino).toMatchObject({ conector: "seu_computador", ferramenta: "executar", argumentos: { app: "Numbers", aparelho: "Mac" } });
    // "Sempre no Numbers" = o `sempre` da decisão, que decidir.ts passa como lembrar.
    const [aExecutar] = comLembrarNoNavegador([{ item: {} as never, conectorId: null, seuComputador: { ...MARLON, agenteId: A, turnoId: "turno-a", acaoId: "acao-1", acao: String(item.destino.argumentos.acao) } }]);
    await sc.executarAprovado(aExecutar!.seuComputador!);
    expect(liberados).toEqual([{ agenteId: A, plataforma: "darwin", appId: "com.apple.iWork.Numbers", appNome: "Numbers", ate: null }]);
    expect(sc.resultadoDaAcao(MARLON, "acao-1")).toContain("liberou o Numbers de vez");
    expect(sc.resultadoDaAcao(MARLON, "acao-1")).toBeNull();
    const r2 = await sc.chamar(MARLON, plano(), "seu_computador_ver", { app: "numbers" });
    expect(r2).toMatchObject({ ok: true, conteudo: "[1] AXTable", confianca: "nao_confiavel", imagem: { mimeType: "image/jpeg", data: "QUFB" } });
    expect(recebidos.at(-1)).toMatchObject({ acao: "ver", apps: [{ id: "com.apple.iWork.Numbers", nome: "Numbers" }], bot: "Ada" });
    expect(sc.vista(MARLON, A)).toMatchObject({ aparelho: "Mac", app: "Numbers", quadro: "data:image/jpeg;base64,QUFB" });
  });

  it("desta vez dura 2 h; a imagem de uma ação vai ao painel, não ao bot", async () => {
    const { sc } = montar();
    await esperar(10);
    resposta = () => ({ tipo: "precisa_liberar", app: { id: "com.apple.Notes", nome: "Notas" } });
    await sc.chamar(MARLON, plano(), "seu_computador_clicar", { app: "Notas", elemento: "s1:3" });
    await sc.executarAprovado({ ...MARLON, agenteId: A, turnoId: "turno-a", acaoId: "acao-2", acao: String(aprovacoes[0]!.itens[0]!.destino.argumentos.acao) });
    expect(liberados[0]!.ate).toBe(agora + 2 * 60 * 60_000);
    resposta = () => ({ tipo: "feito", texto: "Clicked", imagem: { mimeType: "image/jpeg", data: "QkJC" }, app: { id: "com.apple.Notes", nome: "Notas" } });
    const r = await sc.chamar(MARLON, plano(), "seu_computador_clicar", { app: "Notas", elemento: "s1:3" });
    expect(r).toMatchObject({ ok: true, conteudo: "Clicked" });
    expect((r as { imagem?: unknown }).imagem).toBeUndefined();
    expect(sc.vista(MARLON, A)?.quadro).toBe("data:image/jpeg;base64,QkJC");
  });

  it("bloqueado, parado pela pessoa e sem permissão do macOS voltam com a instrução certa", async () => {
    const { sc } = montar();
    await esperar(10);
    resposta = () => ({ tipo: "bloqueado", app: { id: "com.apple.Terminal", nome: "Terminal" }, motivo: "fica de fora" });
    expect(corpo(await sc.chamar(MARLON, plano(), "seu_computador_ver", { app: "Terminal" }))).toMatchObject({ erro: "bloqueado" });
    resposta = () => ({ tipo: "parado" });
    expect(String(corpo(await sc.chamar(MARLON, plano(), "seu_computador_ver", { app: "Notas" })).instrucao)).toContain("apertou Parar");
    resposta = () => ({ tipo: "sem_permissao", falta: ["acessibilidade"] });
    expect(String(corpo(await sc.chamar(MARLON, plano(), "seu_computador_ver", { app: "Notas" })).instrucao)).toContain("Acessibilidade");
    expect(aprovacoes).toEqual([]);
  });

  it("o cartão não sai para app bloqueado mesmo se a máquina pedir liberação", async () => {
    const { sc } = montar();
    await esperar(10);
    resposta = () => ({ tipo: "precisa_liberar", app: { id: "com.1password.1password", nome: "1Password" } });
    expect(corpo(await sc.chamar(MARLON, plano(), "seu_computador_ver", { app: "1Password" }))).toMatchObject({ erro: "bloqueado" });
    expect(aprovacoes).toEqual([]);
  });
});
