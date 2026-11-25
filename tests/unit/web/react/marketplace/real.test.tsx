import { describe, expect, it, vi } from "vitest";
import type { Conector } from "../../../../../src/contracts/conector.ts";
import { estadoInicial, type Estado } from "../../../../../web/estado/reducer.ts";
import { ErroApi } from "../../../../../web/lib/erro-api.ts";
import { criarApiReal, montarFoto, motivoDaAtencao, type DepsDoMarketplaceReal } from "../../../../../web/react/marketplace/real.ts";
import { ErroDoFormulario } from "../../../../../web/react/marketplace/tipos.ts";

/**
 * O adaptador real do modal: lê o reducer com os helpers de sempre (situacaoDoApp, conectorDoApp, nivelDoBot) e fala com
 * api.ts. A foto só troca de objeto quando algo que o modal mostra mudou.
 */
const conector = (slug: string, p: Partial<Conector> = {}): Conector => ({
  tenantId: "t", id: `c-${slug}`, ownerId: "p", visibility: "privado", nome: slug, slug, transporte: "http", comando: null, args: [], url: "https://x/mcp", env: {}, declaracao: "toca",
  habilitado: true, catalogo: [{ nome: "LER", descricao: "", schema: {}, readOnlyHint: true, grupo: "ler" }], sondadoEm: 100, ultimaFalha: null, foraDoArDesde: null, criadoEm: 0, ...p,
});
const agente = { id: "a1", tenantId: "t", ownerId: "p", nome: "Clarice", titulo: "Assistente", descricao: "", cor: "c-blue", forma: "shape-circle", conversaId: "c1", confirmado: true } as never;

const estado = (p: Partial<Estado> = {}): Estado => ({
  ...estadoInicial,
  sessao: { tenantId: "t", pessoaId: "p" } as never,
  frota: { agentes: [agente], negacoes: [] } as never,
  composioConfigurado: true,
  marketplace: [
    { slug: "slack", nome: "Slack", descricao: "Conversas.", categoria: "Comunicação", logo: null },
    { slug: "fireflies", nome: "Fireflies", descricao: "Reuniões.", categoria: "Reuniões", logo: null, conexao: "chave", doCatalogo: true },
    { slug: "github", nome: "GitHub", descricao: "Código.", categoria: "Desenvolvimento", logo: null },
  ],
  conectores: [
    conector("slack"),
    conector("fireflies", { ultimaFalha: { motivo: "conector_indisponivel", em: 200, causa: "acesso_recusado" }, foraDoArDesde: 200 }),
    conector("github", { habilitado: false, sondadoEm: null }),
  ],
  concessoes: { a1: [{ tenantId: "t", id: "g1", agenteId: "a1", conectorId: "c-slack", capacidade: "LER", criadoEm: 0 } as never] },
  ...p,
});

function deps(e: () => Estado, p: Partial<DepsDoMarketplaceReal> = {}): DepsDoMarketplaceReal {
  return {
    estado: e, api: () => null, iniciarConexao: vi.fn(), cancelarConexao: vi.fn(), garantirAcessos: vi.fn(), acessos: () => null, definirNivel: vi.fn(),
    aplicarLote: vi.fn(async () => null), desfazerLote: vi.fn(async () => null), desconectar: vi.fn(async () => undefined), definirPadrao: vi.fn(async () => undefined), conectou: vi.fn(), abrirAvancado: vi.fn(), renomear: vi.fn(async () => undefined), removerConta: vi.fn(async () => undefined), ...p,
  };
}

describe("o adaptador real do Marketplace em modal", () => {
  it("a foto: o app de chave, a atenção com o motivo, o desligado e o nível de cada bot", () => {
    const f = montarFoto(estado(), () => ({ padrao: "leitura", seguePadrao: new Set(["a1"]) }));
    const por = new Map(f.apps.map((a) => [a.slug, a]));
    expect(por.get("slack")).toMatchObject({ situacao: "conectado", conectorId: "c-slack", chave: false, niveis: { a1: "leitura" }, recomendado: true });
    expect(por.get("fireflies")).toMatchObject({ situacao: "atencao", chave: true, falha: "A chave parou de funcionar · foi apagada ou trocada no Fireflies", recomendado: false });
    expect(por.get("github")).toMatchObject({ situacao: "nao_conectado", desligado: true, conectorId: "c-github" });
    expect(f.bots.map((b) => b.nome)).toEqual(["Clarice"]);
    expect(f.acessos["c-slack"]?.padrao).toBe("leitura");
    expect(f.total).toBe(3);
  });

  it("o motivo da atenção muda com o jeito de conectar", () => {
    expect(motivoDaAtencao("Slack", false, { ultimaFalha: { motivo: "conector_indisponivel", em: 1, causa: "acesso_recusado" } })).toBe("O Slack recusou o acesso · entre de novo para liberar");
    expect(motivoDaAtencao("Slack", false, { ultimaFalha: { motivo: "timeout_transporte", em: 1 } })).toContain("parou de responder");
  });

  it("um render que não mexe em nada do modal não troca a foto nem avisa; uma mudança troca só o app que mudou", () => {
    let e = estado();
    const api = criarApiReal(deps(() => e));
    const ouvinte = vi.fn();
    api.assinar(ouvinte);
    const antes = api.ler();
    e = { ...e, agora: 999 };
    api.avisar();
    expect(api.ler()).toBe(antes);
    expect(ouvinte).not.toHaveBeenCalled();
    e = { ...e, conectando: { github: { url: null, falhou: null } } };
    api.avisar();
    const depois = api.ler();
    expect(ouvinte).toHaveBeenCalledTimes(1);
    expect(depois).not.toBe(antes);
    expect(depois.apps.find((a) => a.slug === "slack")).toBe(antes.apps.find((a) => a.slug === "slack"));
    expect(depois.apps.find((a) => a.slug === "github")?.situacao).toBe("conectando");
  });

  it("conectar com a chave: os valores vão só no corpo; o 403 vira 'recusada' e o 409 dos campos vira 'não configurado'", async () => {
    const conectarComChave = vi.fn(async () => ({ conectado: true, conectorId: "c-novo", conector: conector("x") }));
    const conectou = vi.fn();
    const api = criarApiReal(deps(() => estado(), { conectou, api: () => ({ conectarComChave, camposDoApp: async () => { throw new ErroApi(409, "integracao_nao_configurada", "x"); } }) as never }));
    expect(await api.conectarComChave("fireflies", { api_key: "k" })).toEqual({ tipo: "conectado", conectorId: "c-novo" });
    expect(conectarComChave).toHaveBeenCalledWith("fireflies", { api_key: "k" });
    expect(conectou).toHaveBeenCalledWith("c-novo");
    conectarComChave.mockRejectedValueOnce(new ErroApi(403, "integracao_autenticacao", "x"));
    expect(await api.conectarComChave("fireflies", { api_key: "k" })).toEqual({ tipo: "recusada" });
    await expect(api.campos("fireflies")).rejects.toEqual(new ErroDoFormulario("nao_configurado"));
  });
});
