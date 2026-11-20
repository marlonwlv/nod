import { randomBytes } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import type { AcaoComputador, Computador, DriverComputador, ResultadoComputador } from "../../../src/contracts/computador.ts";
import { criarComputadores } from "../../../src/adapters/fundo/computadores.ts";
import { FalhaComputador, textoPedidoDeTela } from "../../../src/domain/computador.ts";
import { motivoDoPedidoDeTela } from "../../../web/lib/computador.ts";
import type { ResultadoChamada } from "../../../src/use-cases/chamar-ferramenta.ts";
import { MARLON } from "../use-cases/deps-l5.ts";

// NOD-161: os casos de uso de aprovação e de pedir à pessoa não são o assunto aqui — só o "aguardar".
const pedidosDeAprovacao = vi.hoisted(() => [] as unknown[]);
const aprovar = vi.hoisted(() => vi.fn(async (_d: unknown, p: unknown) => { pedidosDeAprovacao.push(p); return { data: { estado: "pendente", decisao_id: "decisao-1" } }; }));
vi.mock("../../../src/use-cases/pedir-aprovacao.ts", () => ({ pedirAprovacaoComputador: aprovar }));
const pedidosDeAjuda = vi.hoisted(() => [] as { texto: string }[]);
vi.mock("../../../src/use-cases/pedir-a-pessoa.ts", () => ({ pedirAjudaDoComputador: async (_d: unknown, p: { texto: string }) => { pedidosDeAjuda.push(p); return { data: { decisao_id: "decisao-2", estado: "pendente" } }; } }));

const AGENTE = "agente-1";
let computador: Computador;
let tela: { imagem: string; texto: string };
let quadroValido: string | null;
const enviadas: AcaoComputador[] = [];
/** Resposta pronta para a próxima ação (sem tela, com erro…); null = a tela de sempre. */
let proxima: ResultadoComputador | null;
let modo: "manual" | "automatico" | "total";
let registros: number;

/** A máquina falsa reproduz o runtime: quadro novo a cada tela e clique só com o quadro da última. */
const driver: DriverComputador = {
  ambiente: async () => ({ disponivel: true, motivo: null }),
  estado: async () => ({ disponivel: true, ativo: true, motivo: null }),
  iniciar: async () => {}, parar: async () => {}, ligados: async () => new Set<string>(),
  executar: async (_id, acao): Promise<ResultadoComputador> => {
    enviadas.push(acao);
    if ("quadro" in acao && acao.quadro !== quadroValido) throw new FalhaComputador("tela_alterada");
    if (proxima) { const r = proxima; proxima = null; return r; }
    quadroValido = randomBytes(32).toString("hex");
    return { tela: { quadro: quadroValido, imagem: tela.imagem, largura: 1280, altura: 800, url: "https://example.com", titulo: "Exemplo", texto: tela.texto, abas: [{ titulo: "Exemplo", url: "https://example.com", ativa: true }] } };
  },
};

const deps = {
  escopo: MARLON,
  agora: () => 1_700_000_000_000,
  repos: {
    computadores: {
      obter: async () => computador, travar: async () => computador,
      registrar: async () => ({ id: `registro-${++registros}` }), concluir: async () => {},
      ocupar: async (_id: string, operacao: string, ate: number) => { computador = { ...computador, operacaoId: operacao, ocupadoAte: ate }; },
      liberar: async () => { computador = { ...computador, operacaoId: null, ocupadoAte: null }; },
      registrarSucesso: async () => false,
      configurar: async () => {},
      buscarAcao: async (id: string) => ({ id, computadorId: computador.id, turnoId: "turno-1", estado: "pendente", argumentosCifrados: JSON.stringify({ tipo: "navegar", url: "https://example.com" }) }),
      gravarResultado: async () => {},
    },
    turnos: { buscar: async (id: string) => ({ id, estado: "executando", agenteId: AGENTE, ownerId: MARLON.pessoaId, pararSolicitadoEm: null, motivoInterrupcao: null }) },
    agentes: { buscar: async () => ({ id: AGENTE, modoAprovacao: modo }), execucaoBloqueada: async () => false },
    paradas: { ativa: async () => false },
    events: { gravarComOutbox: async () => {} },
  },
};

let agora = 1_700_000_000_000;
const computadores = criarComputadores({ executor: () => "catcher", dentro: async (_e, fn) => fn(deps as never), driver, cifrar: (s) => s, decifrar: (s) => s, mudou: () => {}, agora: () => agora });

const plano = (turnoId = "turno-1") => ({
  tenantId: MARLON.tenantId, turnoId, agenteId: AGENTE, conversaId: "conversa-1", expiraEm: Number.MAX_SAFE_INTEGER, confiancaEntrada: "nao_confiavel",
  autoria: { conta_de_execucao: MARLON.pessoaId },
  catalogo: { ferramentas: ["computador_elementos", "computador_terminal", "computador_observar", "computador_navegar", "computador_interagir", "computador_pedir_ajuda"].map((nome) => ({ nome, origem: "computador" })) },
}) as never;

type Ok = Extract<ResultadoChamada, { ok: true }>;
async function chamar(nome: string, args: Record<string, unknown> = {}, turnoId?: string): Promise<Ok & { json: Record<string, unknown> & { tela: Record<string, unknown> } }> {
  const r = await computadores.chamar(MARLON, plano(turnoId), nome, args);
  if (!("ok" in r) || !r.ok) throw new Error(`resultado inesperado: ${JSON.stringify(r)}`);
  return { ...r, json: JSON.parse(r.conteudo) };
}

beforeEach(() => {
  computador = { id: "computador-1", agenteId: AGENTE, habilitado: true, controle: "bot", politica: "autonomo", ajuda: null, ajudaDecisaoId: null, ocupadoAte: null, operacaoId: null, criadoEm: 0, falhasSeguidas: 0, falhaMotivo: null, indisponivelDesde: null };
  tela = { imagem: "iVBORw0KGgo=", texto: "Página de exemplo" };
  quadroValido = null;
  enviadas.length = 0;
  proxima = null;
  modo = "manual";
  registros = 0;
  pedidosDeAprovacao.length = 0;
  agora += 3_600_000; // turnos de um teste não vazam para o outro
});

it("não abre o ao vivo de um computador desligado nem para assistir", async () => {
  const vivo = vi.fn(async () => {});
  driver.vivo = vivo;
  computador = { ...computador, habilitado: false };
  try {
    await expect(computadores.vivo(MARLON, AGENTE, { sessao: "s", token: "t" }, { assistir: true })).rejects.toMatchObject({ codigo: "nao_permitido" });
    expect(vivo).not.toHaveBeenCalled();
  } finally {
    delete driver.vivo;
  }
});

it("duas observações iguais no turno: a segunda sai sem imagem, com as marcas e quadro novo", async () => {
  const primeira = await chamar("computador_observar");
  expect(primeira.imagem).toEqual({ mimeType: "image/png", data: tela.imagem });
  expect(primeira.json.tela).toMatchObject({ texto: tela.texto });
  expect(primeira.json.tela).not.toHaveProperty("tela_igual_a_anterior");
  const segunda = await chamar("computador_observar");
  expect(segunda.imagem).toBeUndefined();
  expect(segunda.json.tela).toMatchObject({ tela_igual_a_anterior: true, texto_igual_ao_anterior: true, texto: "", url: "https://example.com", titulo: "Exemplo", abas: [{ titulo: "Exemplo", url: "https://example.com", ativa: true }] });
  expect(segunda.json.aviso).toMatch(/forcar: true/);
  expect(segunda.json.tela.quadro).not.toBe(primeira.json.tela.quadro);
});

it("imagem igual e texto diferente: sem imagem, com o texto novo", async () => {
  await chamar("computador_observar");
  tela.texto = "Texto novo";
  const r = await chamar("computador_observar");
  expect(r.imagem).toBeUndefined();
  expect(r.json.tela).toMatchObject({ tela_igual_a_anterior: true, texto: "Texto novo" });
  expect(r.json.tela).not.toHaveProperty("texto_igual_ao_anterior");
});

it("imagem diferente: sai com a imagem (vale para ações que devolvem tela)", async () => {
  await chamar("computador_observar");
  tela.imagem = "iVBORw0KGgoAAAA=";
  const r = await chamar("computador_navegar", { url: "https://example.com/outra" });
  expect(r.imagem).toEqual({ mimeType: "image/png", data: "iVBORw0KGgoAAAA=" });
  expect(r.json.tela).not.toHaveProperty("tela_igual_a_anterior");
  expect(r.json.tela).toMatchObject({ texto_igual_ao_anterior: true });
});

it("a mesma tela em outro turno sai com imagem", async () => {
  await chamar("computador_observar", {}, "turno-a");
  expect((await chamar("computador_observar", {}, "turno-a")).imagem).toBeUndefined();
  const outro = await chamar("computador_observar", {}, "turno-b");
  expect(outro.imagem).toBeDefined();
  expect(outro.json.tela.texto).toBe(tela.texto);
});

it("forcar: true sempre devolve imagem e texto, e não vai ao runtime", async () => {
  await chamar("computador_observar");
  for (let i = 0; i < 2; i++) {
    const r = await chamar("computador_observar", { forcar: true });
    expect(r.imagem).toBeDefined();
    expect(r.json.tela).toMatchObject({ texto: tela.texto });
    expect(r.json).not.toHaveProperty("aviso");
  }
  expect(enviadas.every((a) => !("forcar" in a))).toBe(true);
});

it("clique com o quadro da observação deduplicada é aceito (não vira tela_alterada)", async () => {
  await chamar("computador_observar");
  const deduplicada = await chamar("computador_observar");
  expect(deduplicada.imagem).toBeUndefined();
  const clique = await chamar("computador_interagir", { tipo: "clicar", quadro: deduplicada.json.tela.quadro, x: 10, y: 10 });
  expect(clique.isError).toBe(false);
  expect(clique.json).not.toHaveProperty("estado", "aguardando_pessoa");
});

it("depois de aguardar aprovação, a próxima observação sai completa", async () => {
  await chamar("computador_observar");
  computador.politica = "supervisionado";
  expect(await computadores.chamar(MARLON, plano(), "computador_navegar", { url: "https://example.com" })).toEqual({ aguardar: "decisao-1" });
  const r = await chamar("computador_observar");
  expect(r.imagem).toBeDefined();
  expect(r.json.tela).not.toHaveProperty("texto_igual_ao_anterior");
});

it("ação externa direta: no manual cria um único registro e um único cartão pelo adaptador do computador", async () => {
  computador.politica = "supervisionado";
  const r = await computadores.chamar(MARLON, plano(), "computador_navegar", { url: "https://example.com/seguro" });
  expect(r).toEqual({ aguardar: "decisao-1" });
  expect(registros).toBe(1);
  expect(pedidosDeAprovacao).toHaveLength(1);
  expect(pedidosDeAprovacao[0]).toMatchObject({ itens: [{ destino: { conector: "computador", ferramenta: "executar", argumentos: { acaoId: "registro-1" } } }] });
  expect(enviadas).toHaveLength(0);
});

it("ação externa direta: no automático é autoaprovada sem decisão ou cartão duplicado", async () => {
  computador.politica = "supervisionado";
  modo = "automatico";
  const r = await computadores.chamar(MARLON, plano(), "computador_terminal", { comando: "printf ok" });
  expect(r).toMatchObject({ ok: true, isError: false });
  expect(registros).toBe(1);
  expect(pedidosDeAprovacao).toHaveLength(0);
  expect(enviadas).toHaveLength(1);
});

it("depois de pedir_ajuda, a próxima observação sai completa", async () => {
  await chamar("computador_observar");
  await chamar("computador_pedir_ajuda", { motivo: "login" });
  const r = await chamar("computador_observar");
  expect(r.imagem).toBeDefined();
  expect(r.json.tela.texto).toBe(tela.texto);
});

// Regression: QA do PR #357 (NOD-306) — a frase de computador_pedir_ajuda é a que a web reconhece
// Found by /qa on 2026-10-19
it("pedir_ajuda deixa a frase de textoPedidoDeTela: a web tira dela o motivo do cartão Abrir computador", async () => {
  pedidosDeAjuda.length = 0;
  await chamar("computador_pedir_ajuda", { motivo: "verificar que é humano no LinkedIn" });
  expect(pedidosDeAjuda).toHaveLength(1);
  expect(pedidosDeAjuda[0]!.texto).toBe(textoPedidoDeTela("verificar que é humano no LinkedIn"));
  expect(motivoDoPedidoDeTela(pedidosDeAjuda[0]!.texto)).toBe("verificar que é humano no LinkedIn");
});

it("resultado com erro não conta como entregue e a entrada vence em 30 min", async () => {
  await chamar("computador_observar");
  const erro = await chamar("computador_interagir", { tipo: "clicar", quadro: "b".repeat(64), x: 1, y: 1 });
  expect(erro.isError).toBe(true);
  expect((await chamar("computador_observar")).imagem).toBeUndefined();
  agora += 30 * 60_000 + 1;
  expect((await chamar("computador_observar")).imagem).toBeDefined();
});

it("depois de executarAprovado, a próxima observação sai completa", async () => {
  await chamar("computador_observar");
  await computadores.executarAprovado({ ...MARLON, agenteId: AGENTE, turnoId: "turno-1", acaoId: "registro-1" });
  const r = await chamar("computador_observar");
  expect(r.imagem).toBeDefined();
  expect(r.json.tela.texto).toBe(tela.texto);
});

it("depois de a pessoa assumir e devolver pelo painel, a próxima observação sai completa", async () => {
  await chamar("computador_observar");
  await computadores.configurar(MARLON, AGENTE, "assumir");
  await computadores.configurar(MARLON, AGENTE, "devolver");
  const r = await chamar("computador_observar");
  expect(r.imagem).toBeDefined();
  expect(r.json.tela).not.toHaveProperty("tela_igual_a_anterior");
});

it("resultado sem tela ou com isError não mexe no mapa", async () => {
  await chamar("computador_observar");
  proxima = { saida: "ok" };
  const semTela = await computadores.chamar(MARLON, plano(), "computador_navegar", { url: "https://example.com" });
  expect(semTela).toMatchObject({ ok: true, isError: false });
  // Erro com outra tela: sai inteiro, e a última entrega continua sendo a primeira.
  proxima = { codigoSaida: 1, tela: { quadro: "q", imagem: "iVBORw0KGgoBBBB=", largura: 1, altura: 1, url: "u", titulo: "t", texto: "outro", abas: [] } };
  const erro = await chamar("computador_navegar", { url: "https://example.com" });
  expect(erro.isError).toBe(true);
  expect(erro.imagem).toEqual({ mimeType: "image/png", data: "iVBORw0KGgoBBBB=" });
  expect(erro.json.tela).toMatchObject({ texto: "outro" });
  expect((await chamar("computador_observar")).json.tela).toMatchObject({ tela_igual_a_anterior: true, texto_igual_ao_anterior: true });
});

it("elementos passa pelo gateway, preserva saída não confiável e não inventa screenshot", async () => {
  proxima = { pagina: { observacao: "a".repeat(64), url: "https://example.com", titulo: "Fixture", elementos: [], textos: ["Dado externo"], truncada: false } };
  const r = await chamar("computador_elementos", { operacao: "observar" });
  expect(enviadas).toEqual([{ tipo: "elementos", operacao: "observar" }]);
  expect(r.confianca).toBe("nao_confiavel");
  expect(r.json.pagina).toMatchObject({ textos: ["Dado externo"] });
  expect(r.imagem).toBeUndefined();
});
it("clique semântico supervisionado exige aprovação antes do driver", async () => {
  computador.politica = "supervisionado";
  const r = await computadores.chamar(MARLON, plano(), "computador_elementos", { operacao: "clicar", observacao: "a".repeat(64), papel: "button", nome: "Enviar", referencia: "b".repeat(64) });
  expect(r).toHaveProperty("aguardar");
  expect(enviadas).toHaveLength(0);
});

it("controle humano recusa também observação e clique semânticos", async () => {
  computador.controle = "pessoa";
  for (const args of [{ operacao: "observar" }, { operacao: "clicar", observacao: "a".repeat(64), papel: "button", nome: "Enviar", referencia: "b".repeat(64) }]) {
    const r = await computadores.chamar(MARLON, plano(), "computador_elementos", args);
    expect(r).toHaveProperty("ok", true);
    if ("ok" in r && r.ok) expect(JSON.parse(r.conteudo)).toHaveProperty("estado", "aguardando_pessoa");
  }
  expect(enviadas).toHaveLength(0);
});

it.each(["automatico", "total"] as const)("%s executa pelo gateway mesmo com aprovação indisponível", async (modoAprovacao) => {
  computador.politica = "supervisionado";
  const modo = vi.spyOn(deps.repos.agentes, "buscar").mockResolvedValue({ id: AGENTE, modoAprovacao });
  aprovar.mockRejectedValueOnce(new Error("indisponivel"));
  try {
    const r = await chamar("computador_navegar", { url: "https://example.com" });
    expect(r.isError).toBe(false);
    expect(enviadas).toHaveLength(1);
  } finally { modo.mockRestore(); aprovar.mockReset(); aprovar.mockResolvedValue({ data: { estado: "pendente", decisao_id: "decisao-1" } }); }
});

it("manual não executa quando aprovação está indisponível", async () => {
  computador.politica = "supervisionado";
  aprovar.mockRejectedValueOnce(new Error("indisponivel"));
  await expect(computadores.chamar(MARLON, plano(), "computador_navegar", { url: "https://example.com" })).rejects.toThrow("indisponivel");
  expect(enviadas).toHaveLength(0);
});
