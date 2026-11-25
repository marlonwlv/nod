import { chaveDaConta, separarChave } from "../domain/contas-do-app.ts";
import type { Conn, Escopo } from "../shared/types.ts";

/**
 * `toolkit` é o slug do app no nod ("gmail"); `conta` é o nome da conta a mais ("pessoal"), null na primeira
 * (ADR-196). `email` só aparece na tela, quando o Composio o devolveu.
 */
export type SessaoComposio = { toolkit: string; sessaoId: string; contaId: string; conectorId: string; conta?: string | null; email?: string | null };

/**
 * ADR-196: a coluna `toolkit` guarda a chave do conector — o slug do app na primeira conta ("gmail"), `<app>--<conta>` na
 * conta a mais ("gmail--pessoal"). O UNIQUE (tenant, owner, toolkit) da 0009 vale para as duas sem mudar.
 */
type LinhaSessao = { toolkit: string; sessao_id: string; conta_id: string; conector_id: string; email: string | null };
const daLinha = (r: LinhaSessao): SessaoComposio => {
  const partes = separarChave(r.toolkit);
  return { toolkit: partes?.app ?? r.toolkit, conta: partes?.conta ?? null, sessaoId: r.sessao_id, contaId: r.conta_id, conectorId: r.conector_id, email: r.email };
};

export function composioRepo(conn: Conn, escopo: Escopo) {
  return {
    /** ADR-041: a chave é do TENANT — quem configurou não importa para ler. */
    async chave(): Promise<string | null> {
      const [r] = await conn<{ chave_cifrada: string }[]>`select chave_cifrada from composio_configuracoes where tenant_id = ${escopo.tenantId}`;
      return r?.chave_cifrada ?? null;
    },
    /** O conflito é por tenant: a segunda pessoa TROCA a chave do time (nod_equipe_update), não cria a sua. */
    async salvarChave(cifrada: string): Promise<void> {
      await conn`insert into composio_configuracoes (tenant_id, owner_id, visibility, chave_cifrada) values (${escopo.tenantId}, ${escopo.pessoaId}, 'equipe', ${cifrada})
        on conflict (tenant_id) do update set chave_cifrada = excluded.chave_cifrada`;
    },
    /** NOD-50: grava só se o time ainda não tem chave (o cartão do bot não troca a que existe); false = já havia. */
    async salvarChaveSeAusente(cifrada: string): Promise<boolean> {
      const r = await conn`insert into composio_configuracoes (tenant_id, owner_id, visibility, chave_cifrada) values (${escopo.tenantId}, ${escopo.pessoaId}, 'equipe', ${cifrada})
        on conflict (tenant_id) do nothing`;
      return r.count === 1;
    },
    /**
     * A sessão da pessoa pela chave do conector (ADR-196): "gmail" é a primeira conta do Gmail, "gmail--pessoal" a conta
     * a mais. Quem lê o app inteiro (importar o Linear, pedir e guardar credencial) passa o slug do app e recebe a primeira.
     */
    async sessao(chave: string): Promise<SessaoComposio | null> {
      if (!separarChave(chave)) return null;
      const [r] = await conn<LinhaSessao[]>`select toolkit, sessao_id, conta_id, conector_id, email from composio_sessoes
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and toolkit = ${chave}`;
      return r ? daLinha(r) : null;
    },
    /** As contas da pessoa num app, a primeira antes (ADR-196 §7: o limite conta todas). */
    async sessoesDoApp(app: string): Promise<SessaoComposio[]> {
      const linhas = await conn<LinhaSessao[]>`select toolkit, sessao_id, conta_id, conector_id, email from composio_sessoes
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and (toolkit = ${app} or left(toolkit, ${app.length + 2}) = ${`${app}--`})
        order by (toolkit = ${app}) desc, toolkit`;
      return linhas.map(daLinha).filter((s) => s.toolkit === app);
    },
    /**
     * Revisão do PR (corrida no limite): duas abas conectando contas diferentes ao mesmo tempo contariam cada uma quatro e
     * criariam a sexta. A trava vale até o fim da transação, por pessoa e app.
     */
    async travarApp(app: string): Promise<void> {
      await conn`select pg_advisory_xact_lock(hashtextextended(${`composio-contas:${escopo.tenantId}:${escopo.pessoaId}:${app}`}, 0))`;
    },
    async salvarSessao(s: SessaoComposio): Promise<void> {
      const chave = chaveDaConta(s.toolkit, s.conta ?? null);
      await conn`insert into composio_sessoes (tenant_id, owner_id, toolkit, sessao_id, conta_id, conector_id) values (${escopo.tenantId}, ${escopo.pessoaId}, ${chave}, ${s.sessaoId}, ${s.contaId}, ${s.conectorId})
        on conflict (tenant_id, owner_id, toolkit) do update set sessao_id = excluded.sessao_id, conta_id = excluded.conta_id, conector_id = excluded.conector_id, email = null`;
    },
    /** O e-mail que o Composio devolveu para a conta (só para a tela); null apaga o que havia. */
    async salvarEmail(conectorId: string, email: string | null): Promise<void> {
      await conn`update composio_sessoes set email = ${email} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and conector_id = ${conectorId}`;
    },
  };
}
