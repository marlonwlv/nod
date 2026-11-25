import { afterAll, beforeAll, expect, it } from "vitest";
import { criarRotasBackoffice } from "../../src/adapters/http/rotas/backoffice.ts";
import { listen } from "../../src/adapters/http/server.ts";
import { cunharCookie } from "../../src/adapters/http/sessao.ts";
import type { BackofficeEuDto, BackofficePessoasDto, BackofficeProblemasDto, PainelPessoaDto, PainelUsoDto } from "../../src/contracts/backoffice.ts";
import { acessosBackofficeRepo, fatosDaEquipe } from "../../src/repositories/backoffice.repo.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { backofficeUsoRepo } from "../../src/repositories/backoffice-uso.repo.ts";
import type { Pessoa } from "../../src/repositories/pessoas.repo.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollbackDono } from "../helpers/db-dono.ts";
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

describeIntegracao("backoffice interno: uso, guarda e auditoria (ADR-193, ADR-194)", () => {
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
  const SEGREDO = "segredo-de-teste-backoffice";
  const papelDe = new Map<string, "dono" | "leitura">([[PESSOA_MARLON, "dono"]]);
  let srv: { port: number; close: () => Promise<void> };
  const sessao = (pessoaId: string) => ({ cookie: `nod_sessao=${cunharCookie({ tenantId: TENANT_PADRAO, pessoaId }, SEGREDO)}` });
  const get = (caminho: string, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${srv.port}${caminho}`, { headers });

  beforeAll(async () => {
    srv = await listen(0, "127.0.0.1", {
      rotas: criarRotasBackoffice({ listarPessoas: async () => PESSOAS, abrirTx, cacheMs: 0 }),
      segredoSessao: SEGREDO,
      backoffice: { papel: async (e) => papelDe.get(e.pessoaId) ?? null },
    });
  });
  afterAll(async () => {
    await srv.close();
  });

  it("o repositório lê os fatos da pessoa no escopo dela, sem o texto das mensagens", async () => {
    await withRollback(MARLON, async (trx) => {
      const { conversaId } = await semear(trx);
      const ini = new Date(Date.now() - 86_400_000);
      const f = await backofficeUsoRepo(trx, MARLON).fatos({ tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON, nome: "Pessoa A", iniciais: "PA" }, ini, new Date());
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
      const f = await abrirTxNoTeste(trx, ana, (sp) => backofficeUsoRepo(sp, ana).fatos({ tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA, nome: "Pessoa B", iniciais: "PB" }, new Date(Date.now() - 86_400_000), new Date()));
      expect(f.problemas).toEqual([]);
      expect(f.mensagens).toBe(0);
    });
  });

  it("a equipe recebe uso, problemas, pessoas e a tela da pessoa; cada acesso fica auditado, só com metadados", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      try {
        await semear(trx);
        const eu = sessao(PESSOA_MARLON);
        expect(await (await get("/api/backoffice/eu", eu)).json()).toEqual({ papel: "dono", nome: "Pessoa A", iniciais: "PA" } satisfies BackofficeEuDto);

        const r = await get("/api/backoffice/uso?dias=7", eu);
        expect(r.status).toBe(200);
        const painel = (await r.json()) as PainelUsoDto;
        expect(painel.dias).toHaveLength(7);
        expect(painel.crescimento.totalPessoas).toBe(2);
        expect(painel.problemas.map((p) => p.chave)).toContain("ferramenta_negada:capacidade_desligada");
        expect(JSON.stringify(painel)).not.toContain(TEXTO_PRIVADO);

        const problemas = (await (await get("/api/backoffice/problemas?dias=7", eu)).json()) as BackofficeProblemasDto;
        expect(problemas.problemas.map((p) => p.chave)).toContain("ferramenta_negada:capacidade_desligada");
        const pessoas = (await (await get("/api/backoffice/pessoas", eu)).json()) as BackofficePessoasDto;
        expect(pessoas.pessoas.map((p) => p.pessoaId).sort()).toEqual([PESSOA_ANA, PESSOA_MARLON].sort());

        const pessoa = await get(`/api/backoffice/pessoas/${TENANT_PADRAO}/${PESSOA_MARLON}`, eu);
        expect(pessoa.status).toBe(200);
        const tela = (await pessoa.json()) as PainelPessoaDto;
        expect(tela.linhaDoTempo.some((e) => e.tipo === "bot_criado")).toBe(true);
        expect(tela.linhaDoTempo.some((e) => e.tipo === "problema" && e.rotulo.includes("Bash"))).toBe(true);
        expect((await get(`/api/backoffice/pessoas/${TENANT_PADRAO}/00000000-0000-4000-8000-000000000999`, eu)).status).toBe(404);
        expect((await get(`/api/backoffice/pessoas/${TENANT_PADRAO}/nao-uuid`, eu)).status).toBe(404);

        const acessos = await acessosBackofficeRepo(trx, MARLON).recentes();
        expect(acessos.map((a) => a.secao)).toEqual(["pessoa", "pessoas", "problemas", "uso", "entrada"]);
        expect(acessos[0]).toMatchObject({ rota: `/api/backoffice/pessoas/${TENANT_PADRAO}/${PESSOA_MARLON}`, alvo: { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON } });
        expect(acessos[3]).toMatchObject({ rota: "/api/backoffice/uso", alvo: null });
      } finally {
        trxAtual = null;
      }
    });
  });

  it("quem não é da equipe recebe 404 em tudo e não deixa acesso registrado; sem sessão, 401", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      try {
        const ana = sessao(PESSOA_ANA);
        for (const caminho of ["/api/backoffice/eu", "/api/backoffice/uso", "/api/backoffice/problemas", "/api/backoffice/pessoas", `/api/backoffice/pessoas/${TENANT_PADRAO}/${PESSOA_MARLON}`, "/api/backoffice/nada"]) {
          expect((await get(caminho, ana)).status, caminho).toBe(404);
          expect((await get(caminho)).status, caminho).toBe(401);
        }
        const anaEscopo: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
        expect(await abrirTxNoTeste(trx, anaEscopo, (sp) => acessosBackofficeRepo(sp, anaEscopo).recentes())).toEqual([]);
      } finally {
        trxAtual = null;
      }
    });
  });

  it("acessos_backoffice: nod_app insere, mas não muda nem apaga, e não vê o acesso de outra pessoa", async () => {
    await withRollback(MARLON, async (trx) => {
      await expect(trx.savepoint((sp) => acessosBackofficeRepo(sp, MARLON).registrar({ secao: "uso", rota: "/api/backoffice/uso?x=1", alvo: null }))).rejects.toThrow(/acessos_backoffice_rota/);
      await acessosBackofficeRepo(trx, MARLON).registrar({ secao: "uso", rota: "/api/backoffice/uso", alvo: null });
      const ana: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
      expect(await abrirTxNoTeste(trx, ana, (sp) => acessosBackofficeRepo(sp, ana).recentes())).toEqual([]);
      const [priv] = await trx<{ ins: boolean; upd: boolean; del: boolean; equipe_ins: boolean; equipe_sel: boolean }[]>`
        select has_table_privilege('nod_app', 'acessos_backoffice', 'INSERT') as ins, has_table_privilege('nod_app', 'acessos_backoffice', 'UPDATE') as upd,
               has_table_privilege('nod_app', 'acessos_backoffice', 'DELETE') as del, has_table_privilege('nod_app', 'equipe_backoffice', 'INSERT') as equipe_ins,
               has_table_privilege('nod_app', 'equipe_backoffice', 'SELECT') as equipe_sel`;
      expect(priv).toEqual({ ins: true, upd: false, del: false, equipe_ins: false, equipe_sel: true });
    });
  });

  it("equipe_backoffice: vazia libera o bootstrap; preenchida, só ela vale; nod_app só lê", async () => {
    await withRollback(MARLON, async (trx) => {
      expect(await fatosDaEquipe(trx, MARLON)).toEqual({ papel: null, equipeVazia: true });
      await expect(trx.savepoint((sp) => sp`insert into equipe_backoffice (tenant_id, pessoa_id, papel) values (${TENANT_PADRAO}, ${PESSOA_MARLON}, 'dono')`)).rejects.toThrow(/permission denied/);
    });
    await withRollbackDono(async (dono) => {
      await dono`insert into tenants (id, nome) values (${TENANT_PADRAO}, 'Nod') on conflict do nothing`;
      await dono`insert into pessoas (tenant_id, id, nome, iniciais) values (${TENANT_PADRAO}, ${PESSOA_ANA}, 'Pessoa B', 'PB') on conflict do nothing`;
      await dono`insert into equipe_backoffice (tenant_id, pessoa_id, papel) values (${TENANT_PADRAO}, ${PESSOA_ANA}, 'leitura')`;
      expect(await fatosDaEquipe(dono, { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA })).toEqual({ papel: "leitura", equipeVazia: false });
      expect(await fatosDaEquipe(dono, MARLON)).toEqual({ papel: null, equipeVazia: false });
      await expect(dono.savepoint((sp) => sp`insert into equipe_backoffice (tenant_id, pessoa_id, papel) values (${TENANT_PADRAO}, ${PESSOA_MARLON}, 'admin')`)).rejects.toThrow(/equipe_backoffice_papel/);
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
