import type { BackofficeEuDto, BackofficePessoasDto, BackofficeProblemasDto } from "../../../contracts/backoffice.ts";
import { ehPapelBackoffice } from "../../../domain/backoffice-equipe.ts";
import { janelaDias, montarPainel, montarPainelPessoa, type FatosPessoa } from "../../../domain/backoffice-uso.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { acessosBackofficeRepo, type AcessoBackoffice } from "../../../repositories/backoffice.repo.ts";
import { backofficeUsoRepo } from "../../../repositories/backoffice-uso.repo.ts";
import type { Pessoa } from "../../../repositories/pessoas.repo.ts";
import type { Escopo, Transacao } from "../../../shared/types.ts";
import type { Ctx, Rota } from "../roteador.ts";

/**
 * Backoffice interno (definido em 2026-11-24, ADR-194; nasceu como o painel admin de uso do ADR-193). Tudo GET, só
 * leitura, sob `/api/backoffice` (o roteador confere a sessão e o papel na equipe a cada pedido e dá 404 a quem não é):
 *  - `/eu`: `{ papel, nome, iniciais }` de quem está entrando (a tela abre por aqui);
 *  - `/uso?dias=`: o painel de uso (crescimento, ativação, engajamento, saúde, problemas, pessoas);
 *  - `/problemas?dias=`: o ranking de problemas;
 *  - `/pessoas?dias=`: a lista de pessoas;
 *  - `/pessoas/:id/:pid?dias=`: a tela de uma pessoa (tenant e pessoa).
 *
 * Cada pedido grava um acesso em `acessos_backoffice` (quem, seção, rota, alvo, quando — só metadados) ANTES de
 * responder: sem o registro, o pedido falha. A leitura entre pessoas abre uma transação escopada por pessoa (a RLS
 * segue valendo, sem papel novo no banco) e o resultado fica em cache por um minuto.
 */
export type DepsBackoffice = {
  listarPessoas: () => Promise<Pessoa[]>;
  abrirTx: (escopo: Escopo) => Transacao;
  agora?: () => number;
  cacheMs?: number;
};

const CACHE_MS = 60_000;

function dias(ctx: Ctx): number {
  return janelaDias(new URL(ctx.req.url ?? "/", "http://nod.invalid").searchParams.get("dias"));
}

export function criarRotasBackoffice(d: DepsBackoffice): Rota[] {
  const agora = d.agora ?? Date.now;
  const cacheMs = d.cacheMs ?? CACHE_MS;
  const cache = new Map<number, { ate: number; fatos: Promise<FatosPessoa[]> }>();

  const ref = (p: Pessoa) => ({ tenantId: p.tenantId, pessoaId: p.id, nome: p.nome, iniciais: p.iniciais });
  const inicioDaJanela = (n: number, t: number): Date => new Date(Date.parse(`${new Date(t).toISOString().slice(0, 10)}T00:00:00Z`) - (n - 1) * 86_400_000);

  function fatosDe(p: Pessoa, n: number, t: number): Promise<FatosPessoa> {
    const escopo: Escopo = { tenantId: p.tenantId, pessoaId: p.id };
    return d.abrirTx(escopo)((trx) => backofficeUsoRepo(trx, escopo).fatos(ref(p), inicioDaJanela(n, t), new Date(t)));
  }

  /** Uma pessoa por vez (sem estourar o pool, como os laços de fundo); o cache guarda a promessa, não só o fim. */
  function todosOsFatos(pessoas: Pessoa[], n: number, t: number): Promise<FatosPessoa[]> {
    const atual = cache.get(n);
    if (atual && atual.ate > t) return atual.fatos;
    const fatos = (async () => {
      const lista: FatosPessoa[] = [];
      for (const p of pessoas) lista.push(await fatosDe(p, n, t));
      return lista;
    })();
    cache.set(n, { ate: t + cacheMs, fatos });
    fatos.catch(() => cache.delete(n));
    return fatos;
  }

  async function painel(ctx: Ctx) {
    const n = dias(ctx);
    const t = agora();
    return montarPainel(await todosOsFatos(await d.listarPessoas(), n, t), t, n);
  }

  /** Grava o acesso na transação de quem acessou (escopo da sessão). O caminho vai sem query string. */
  function registrar(ctx: Ctx, secao: string, alvo: AcessoBackoffice["alvo"] = null): Promise<void> {
    const rota = new URL(ctx.req.url ?? "/", "http://nod.invalid").pathname;
    return d.abrirTx(ctx.escopo)((trx) => acessosBackofficeRepo(trx, ctx.escopo).registrar({ secao, rota, alvo }));
  }

  const get = (padrao: RegExp, handler: (ctx: Ctx) => Promise<void>): Rota => ({ metodo: "GET", padrao, backoffice: true, handler });

  return [
    get(/^\/eu$/, async (ctx) => {
      await registrar(ctx, "entrada");
      const papel = ctx.params.papelBackoffice;
      if (!ehPapelBackoffice(papel)) throw new ErroDeDominio("nao_encontrado");
      const eu = (await d.listarPessoas()).find((p) => p.tenantId === ctx.escopo.tenantId && p.id === ctx.escopo.pessoaId);
      const corpo: BackofficeEuDto = { papel, nome: eu?.nome ?? "", iniciais: eu?.iniciais ?? "" };
      ctx.json(200, corpo);
    }),
    get(/^\/uso$/, async (ctx) => {
      await registrar(ctx, "uso");
      ctx.json(200, await painel(ctx));
    }),
    get(/^\/problemas$/, async (ctx) => {
      await registrar(ctx, "problemas");
      const p = await painel(ctx);
      const corpo: BackofficeProblemasDto = { geradoEm: p.geradoEm, dias: p.dias, problemas: p.problemas };
      ctx.json(200, corpo);
    }),
    get(/^\/pessoas$/, async (ctx) => {
      await registrar(ctx, "pessoas");
      const p = await painel(ctx);
      const corpo: BackofficePessoasDto = { geradoEm: p.geradoEm, dias: p.dias, pessoas: p.pessoas };
      ctx.json(200, corpo);
    }),
    get(/^\/pessoas\/(?<id>[^/]+)\/(?<pid>[^/]+)$/, async (ctx) => {
      const alvo = (await d.listarPessoas()).find((p) => p.tenantId === ctx.params.id && p.id === ctx.params.pid);
      if (!alvo) throw new ErroDeDominio("nao_encontrado");
      await registrar(ctx, "pessoa", { tenantId: alvo.tenantId, pessoaId: alvo.id });
      const n = dias(ctx);
      const t = agora();
      ctx.json(200, montarPainelPessoa(await fatosDe(alvo, n, t), t, n));
    }),
  ];
}
