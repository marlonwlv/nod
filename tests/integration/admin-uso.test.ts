import { afterAll, beforeAll, expect, it } from "vitest";
import { criarRotasAdminUso } from "../../src/adapters/http/rotas/admin-uso.ts";
import type { PainelPessoaDto, PainelUsoDto } from "../../src/contracts/admin-uso.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { adminUsoRepo } from "../../src/repositories/admin-uso.repo.ts";
import type { Pessoa } from "../../src/repositories/pessoas.repo.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const TEXTO_PRIVADO = "conteudo-que-nao-pode-sair-no-painel";
const PESSOAS: Pessoa[] = [
  { tenantId: TENANT_PADRAO, id: PESSOA_MARLON, nome: "Pessoa A", iniciais: "PA", email: null },
  { tenantId: TENANT_PADRAO, id: PESSOA_ANA, nome: "Pessoa B", iniciais: "PB", email: null },
];

/** Uma conversa com uma fala da pessoa, uma resposta sem fala do bot e uma ferramenta negada. */
async function semear(trx: Tx): Promise<{ agenteId: string; conversaId: string }> {
  const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
  const criada = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "texto", texto: TEXTO_PRIVADO, confianca: "confiavel" });
  if (!criada) throw new Error("mensagem não criada");
  await repos.trilha.registrar({ agenteId, ferramenta: "Bash", kind: "negacao", motivo: "capacidade_desligada", regra: "regra:teste", regraVersao: 1, em: Date.now() });
  return { agenteId, conversaId };
}

describeIntegracao("painel admin de uso (ADR-193)", () => {
  let trxAtual: Tx | null = null;
  const abrirTx =
    (escopo: Escopo) =>
    async <T,>(fn: (t: Tx) => Promise<T>): Promise<T> => {
      const trx = trxAtual;
      if (!trx) throw new Error("teste sem transação aberta");
      const caixa: { valor?: T } = {};
      await trx.savepoint(async (sp) => {
        await vincularEscopo(sp, escopo);
        caixa.valor = await fn(sp);
      });
      return caixa.valor as T;
    };
  let comAdmin: ServidorDeTeste;
  let semAdmin: ServidorDeTeste;
  let outroAdmin: ServidorDeTeste;

  beforeAll(async () => {
    const base = { listarPessoas: async () => PESSOAS, abrirTx, cacheMs: 0 };
    comAdmin = await servidorDeTeste(criarRotasAdminUso({ ...base, admins: [PESSOA_MARLON] }));
    semAdmin = await servidorDeTeste(criarRotasAdminUso({ ...base, admins: [] }));
    outroAdmin = await servidorDeTeste(criarRotasAdminUso({ ...base, admins: ["alguem@exemplo.test"] }));
  });
  afterAll(async () => {
    await Promise.all([comAdmin.close(), semAdmin.close(), outroAdmin.close()]);
  });

  it("o repositório lê os fatos da pessoa no escopo dela, sem o texto das mensagens", async () => {
    await withRollback(MARLON, async (trx) => {
      const { conversaId } = await semear(trx);
      const ini = new Date(Date.now() - 86_400_000);
      const f = await adminUsoRepo(trx, MARLON).fatos({ tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON, nome: "Pessoa A", iniciais: "PA" }, ini, new Date());
      expect(f.bots.length).toBeGreaterThanOrEqual(1);
      expect(f.mensagens).toBeGreaterThanOrEqual(1);
      expect(f.diasAtivos).toContain(new Date().toISOString().slice(0, 10));
      expect(f.cadastroEm).not.toBeNull();
      const negada = f.problemas.find((c) => c.fonte === "ferramenta_negada");
      expect(negada).toMatchObject({ motivo: "capacidade_desligada", alvo: "Bash" });
      expect(JSON.stringify(f)).not.toContain(TEXTO_PRIVADO);
      expect(f.ultimoUsoEm).not.toBeNull();
      expect(conversaId).toBeTruthy();
    });
  });

  it("a pessoa de outra conta não aparece nos fatos (RLS por pessoa)", async () => {
    await withRollback(MARLON, async (trx) => {
      await semear(trx);
      const ana: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
      const f = await abrirTxNoTeste(trx, ana, (sp) => adminUsoRepo(sp, ana).fatos({ tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA, nome: "Pessoa B", iniciais: "PB" }, new Date(Date.now() - 86_400_000), new Date()));
      expect(f.problemas).toEqual([]);
      expect(f.mensagens).toBe(0);
    });
  });

  it("admin recebe o painel; quem não é admin recebe 404, como rota que não existe", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      try {
        await semear(trx);
        const eu = await comAdmin.entrar("marlon");
        const r = await comAdmin.chamar(eu, "GET", "/admin/uso?dias=7");
        expect(r.status).toBe(200);
        const painel = (await r.json()) as PainelUsoDto;
        expect(painel.dias).toHaveLength(7);
        expect(painel.crescimento.totalPessoas).toBe(2);
        expect(painel.problemas.map((p) => p.chave)).toContain("ferramenta_negada:capacidade_desligada");
        expect(JSON.stringify(painel)).not.toContain(TEXTO_PRIVADO);
        expect(await (await comAdmin.chamar(eu, "GET", "/admin/eu")).json()).toEqual({ admin: true });

        const pessoa = await comAdmin.chamar(eu, "GET", `/admin/uso/pessoas/${TENANT_PADRAO}/${PESSOA_MARLON}`);
        expect(pessoa.status).toBe(200);
        const tela = (await pessoa.json()) as PainelPessoaDto;
        expect(tela.linhaDoTempo.some((e) => e.tipo === "bot_criado")).toBe(true);
        expect(tela.linhaDoTempo.some((e) => e.tipo === "problema" && e.rotulo.includes("Bash"))).toBe(true);
        expect((await comAdmin.chamar(eu, "GET", `/admin/uso/pessoas/${TENANT_PADRAO}/00000000-0000-4000-8000-000000000999`)).status).toBe(404);
        expect((await comAdmin.chamar(eu, "GET", `/admin/uso/pessoas/${TENANT_PADRAO}/nao-uuid`)).status).toBe(404);

        const ana = await comAdmin.entrar("ana");
        expect((await comAdmin.chamar(ana, "GET", "/admin/uso")).status).toBe(404);
        expect((await comAdmin.chamar(ana, "GET", `/admin/uso/pessoas/${TENANT_PADRAO}/${PESSOA_MARLON}`)).status).toBe(404);
        expect(await (await comAdmin.chamar(ana, "GET", "/admin/eu")).json()).toEqual({ admin: false });
        expect((await semAdmin.chamar(await semAdmin.entrar("marlon"), "GET", "/admin/uso")).status).toBe(404);
        expect((await outroAdmin.chamar(await outroAdmin.entrar("marlon"), "GET", "/admin/uso")).status).toBe(404);
      } finally {
        trxAtual = null;
      }
    });
  });
});

async function abrirTxNoTeste<T>(trx: Tx, escopo: Escopo, fn: (t: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await trx.savepoint(async (sp) => {
    await vincularEscopo(sp, escopo);
    caixa.valor = await fn(sp);
  });
  return caixa.valor as T;
}
