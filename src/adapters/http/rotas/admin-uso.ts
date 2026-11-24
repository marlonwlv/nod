import { ehAdmin, janelaDias, montarPainel, montarPainelPessoa, type FatosPessoa } from "../../../domain/admin-uso.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { adminUsoRepo } from "../../../repositories/admin-uso.repo.ts";
import type { Pessoa } from "../../../repositories/pessoas.repo.ts";
import type { Escopo, Transacao } from "../../../shared/types.ts";
import type { Ctx, Rota } from "../roteador.ts";

/**
 * Painel admin de uso (definido em 2026-11-23, ADR-193). Três GETs, todos só leitura:
 *  - `/admin/eu`: `{ admin }`, para a tela saber se mostra o link (não revela nada além disso);
 *  - `/admin/uso?dias=`: o painel inteiro (crescimento, ativação, engajamento, saúde, problemas, pessoas);
 *  - `/admin/uso/pessoas/:id/:pid?dias=`: a tela de uma pessoa (tenant e pessoa).
 *
 * Quem é admin vem de NOD_ADMINS (id ou e-mail, por variável de ambiente: o repositório é público) e é conferido AQUI,
 * no servidor, a cada pedido. Quem não é recebe 404, como rota que não existe, nunca 403. A leitura entre
 * pessoas abre uma transação escopada por pessoa (a RLS segue valendo, sem papel novo) e o resultado fica em cache por
 * um minuto, para recarregar a tela não varrer o banco de novo.
 */
export type DepsAdminUso = {
  admins: readonly string[];
  listarPessoas: () => Promise<Pessoa[]>;
  abrirTx: (escopo: Escopo) => Transacao;
  agora?: () => number;
  cacheMs?: number;
};

const CACHE_MS = 60_000;

function dias(ctx: Ctx): number {
  return janelaDias(new URL(ctx.req.url ?? "/", "http://nod.invalid").searchParams.get("dias"));
}

export function criarRotasAdminUso(d: DepsAdminUso): Rota[] {
  const agora = d.agora ?? Date.now;
  const cacheMs = d.cacheMs ?? CACHE_MS;
  const cache = new Map<number, { ate: number; fatos: Promise<FatosPessoa[]> }>();

  async function exigirAdmin(escopo: Escopo): Promise<Pessoa[]> {
    if (d.admins.length === 0) throw new ErroDeDominio("nao_encontrado");
    const pessoas = await d.listarPessoas();
    const eu = pessoas.find((p) => p.tenantId === escopo.tenantId && p.id === escopo.pessoaId) ?? null;
    if (!ehAdmin(d.admins, eu ? { id: eu.id, email: eu.email } : null)) throw new ErroDeDominio("nao_encontrado");
    return pessoas;
  }

  const ref = (p: Pessoa) => ({ tenantId: p.tenantId, pessoaId: p.id, nome: p.nome, iniciais: p.iniciais });
  const inicioDaJanela = (n: number, t: number): Date => new Date(Date.parse(`${new Date(t).toISOString().slice(0, 10)}T00:00:00Z`) - (n - 1) * 86_400_000);

  function fatosDe(p: Pessoa, n: number, t: number): Promise<FatosPessoa> {
    const escopo: Escopo = { tenantId: p.tenantId, pessoaId: p.id };
    return d.abrirTx(escopo)((trx) => adminUsoRepo(trx, escopo).fatos(ref(p), inicioDaJanela(n, t), new Date(t)));
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

  return [
    {
      metodo: "GET",
      padrao: /^\/admin\/eu$/,
      async handler(ctx) {
        const admin = await exigirAdmin(ctx.escopo).then(() => true, (e: unknown) => {
          if (e instanceof ErroDeDominio && e.codigo === "nao_encontrado") return false;
          throw e;
        });
        ctx.json(200, { admin });
      },
    },
    {
      metodo: "GET",
      padrao: /^\/admin\/uso$/,
      async handler(ctx) {
        const pessoas = await exigirAdmin(ctx.escopo);
        const n = dias(ctx);
        const t = agora();
        ctx.json(200, montarPainel(await todosOsFatos(pessoas, n, t), t, n));
      },
    },
    {
      metodo: "GET",
      padrao: /^\/admin\/uso\/pessoas\/(?<id>[^/]+)\/(?<pid>[^/]+)$/,
      async handler(ctx) {
        const pessoas = await exigirAdmin(ctx.escopo);
        const alvo = pessoas.find((p) => p.tenantId === ctx.params.id && p.id === ctx.params.pid);
        if (!alvo) throw new ErroDeDominio("nao_encontrado");
        const n = dias(ctx);
        const t = agora();
        ctx.json(200, montarPainelPessoa(await fatosDe(alvo, n, t), t, n));
      },
    },
  ];
}
