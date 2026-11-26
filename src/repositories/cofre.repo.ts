import type { EpochMs } from "../contracts/ids.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms, msOuNull } from "./conversao.ts";

/**
 * O cofre em envelope (0185, ADR-195 §3). O repositório só vê cifra: o valor entra e sai como `v2:…` e a chave do tenant
 * como o texto do provedor da mestra. A listagem nunca leva valor nem chave, nem cifrados. Quem cifra e decifra é
 * src/use-cases/cofre-envelope.ts.
 */
export type TipoItemCofre = "chave" | "login" | "contato" | "cartao";
export type DonoItemCofre = "pessoa" | "time";
export type TipoEventoCofre = "guardado" | "trocado" | "pedido" | "aprovado" | "negado" | "entregue" | "revogado" | "reembrulhado";
export type ModoConcessaoCofre = "sempre" | "perguntar";

/** O item sem nada de segredo: o que a tela, o bot e a listagem podem ver. */
export type ItemDoCofre = {
  id: string;
  ownerId: string;
  tipo: TipoItemCofre;
  nome: string;
  app: string | null;
  publico: Record<string, unknown>;
  dono: DonoItemCofre;
  versao: number;
  revogadoEm: EpochMs | null;
  ultimoUsoEm: EpochMs | null;
  criadoEm: EpochMs;
};

/** As cifras do item, para o servidor decifrar na hora da entrega. Nunca sai do servidor. */
export type CifraDoItem = { valorCifrado: string; chaveItemEmbrulhada: string; chaveTenantVersao: number };

export type ChaveDoTenantGravada = { versao: number; chaveEmbrulhada: string; mestraRef: string; aposentadaEm: EpochMs | null };

export type EventoDoCofre = { id: string; itemId: string | null; agenteId: string | null; tipo: TipoEventoCofre; detalhe: Record<string, unknown>; criadoEm: EpochMs };

const CIFRADO_V2 = /^v2:[0-9]{1,9}:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;
const COLUNAS_ITEM = "id, owner_id, tipo, nome, app, publico, dono, versao, revogado_em, ultimo_uso_em, criado_em";

type LinhaItem = {
  id: string;
  owner_id: string;
  tipo: TipoItemCofre;
  nome: string;
  app: string | null;
  publico: Record<string, unknown>;
  dono: DonoItemCofre;
  versao: number;
  revogado_em: Date | null;
  ultimo_uso_em: Date | null;
  criado_em: Date;
};
const item = (l: LinhaItem): ItemDoCofre => ({
  id: l.id,
  ownerId: l.owner_id,
  tipo: l.tipo,
  nome: l.nome,
  app: l.app,
  publico: l.publico,
  dono: l.dono,
  versao: l.versao,
  revogadoEm: msOuNull(l.revogado_em),
  ultimoUsoEm: msOuNull(l.ultimo_uso_em),
  criadoEm: ms(l.criado_em),
});

type LinhaChave = { versao: number; chave_embrulhada: string; mestra_ref: string; aposentada_em: Date | null };
const chave = (l: LinhaChave): ChaveDoTenantGravada => ({ versao: l.versao, chaveEmbrulhada: l.chave_embrulhada, mestraRef: l.mestra_ref, aposentadaEm: msOuNull(l.aposentada_em) });

export function cofreRepo(conn: Conn, escopo: Escopo) {
  return {
    // ------------------------------------------------------------------------------------------- chave do tenant

    /** A chave viva do tenant (uma por tenant, índice parcial da 0185), ou null antes do primeiro uso. */
    async chaveAtivaDoTenant(): Promise<ChaveDoTenantGravada | null> {
      const [l] = await conn<LinhaChave[]>`
        select versao, chave_embrulhada, mestra_ref, aposentada_em from cofre_chaves_tenant
        where tenant_id = ${escopo.tenantId} and aposentada_em is null`;
      return l ? chave(l) : null;
    },

    /** Uma versão da chave do tenant, viva ou aposentada (o item lê a versão que o embrulhou). */
    async chaveDoTenant(versao: number): Promise<ChaveDoTenantGravada | null> {
      const [l] = await conn<LinhaChave[]>`
        select versao, chave_embrulhada, mestra_ref, aposentada_em from cofre_chaves_tenant
        where tenant_id = ${escopo.tenantId} and versao = ${versao}`;
      return l ? chave(l) : null;
    },

    /** Todas as versões, para o reembrulho da mestra (as aposentadas também: algum item ainda pode apontar para elas). */
    async chavesDoTenant(): Promise<ChaveDoTenantGravada[]> {
      const ls = await conn<LinhaChave[]>`
        select versao, chave_embrulhada, mestra_ref, aposentada_em from cofre_chaves_tenant
        where tenant_id = ${escopo.tenantId} order by versao`;
      return ls.map(chave);
    },

    async maiorVersaoDaChave(): Promise<number> {
      const [l] = await conn<{ v: number | null }[]>`select max(versao) as v from cofre_chaves_tenant where tenant_id = ${escopo.tenantId}`;
      return l?.v ?? 0;
    },

    /**
     * Grava a chave nova do tenant. null = outra transação gravou primeiro (a mesma versão, ou outra viva): quem chamou
     * descarta a dele e lê a vencedora. A linha é do tenant ('equipe') e de quem a criou.
     */
    async criarChaveDoTenant(p: { versao: number; chaveEmbrulhada: string; mestraRef: string }): Promise<ChaveDoTenantGravada | null> {
      const [l] = await conn<LinhaChave[]>`
        insert into cofre_chaves_tenant (tenant_id, owner_id, visibility, versao, chave_embrulhada, mestra_ref)
        values (${escopo.tenantId}, ${escopo.pessoaId}, 'equipe', ${p.versao}, ${p.chaveEmbrulhada}, ${p.mestraRef})
        on conflict do nothing
        returning versao, chave_embrulhada, mestra_ref, aposentada_em`;
      return l ? chave(l) : null;
    },

    /** O reembrulho pela mestra nova (policy nod_equipe_update + trigger que só deixa estas colunas mudarem). */
    async reembrulharChaveDoTenant(versao: number, p: { chaveEmbrulhada: string; mestraRef: string }, agora: number): Promise<boolean> {
      const r = await conn`
        update cofre_chaves_tenant set chave_embrulhada = ${p.chaveEmbrulhada}, mestra_ref = ${p.mestraRef}, reembrulhada_em = ${new Date(agora)}
        where tenant_id = ${escopo.tenantId} and versao = ${versao}`;
      return r.count > 0;
    },

    // ------------------------------------------------------------------------------------------------------ itens

    /**
     * A versão viva de (tipo, nome) para o dono: da pessoa do escopo, ou a do time (de quem a guardou). Sem trava: um
     * SELECT FOR UPDATE passa também pela policy de UPDATE e esconderia o item do time de outra pessoa; quem troca trava
     * pelo UPDATE da revogação.
     */
    async itemVivo(p: { tipo: TipoItemCofre; nome: string; dono: DonoItemCofre }): Promise<ItemDoCofre | null> {
      const [l] = await conn<LinhaItem[]>`
        select ${conn.unsafe(COLUNAS_ITEM)} from cofre_itens
        where tenant_id = ${escopo.tenantId} and tipo = ${p.tipo} and nome = ${p.nome} and dono = ${p.dono} and revogado_em is null
          and (dono = 'time' or owner_id = ${escopo.pessoaId})`;
      return l ? item(l) : null;
    },

    async inserirItem(p: {
      id: string;
      tipo: TipoItemCofre;
      nome: string;
      app: string | null;
      publico: Record<string, unknown>;
      dono: DonoItemCofre;
      versao: number;
      cifra: CifraDoItem | null;
      agora: number;
    }): Promise<ItemDoCofre> {
      if (p.cifra && (!CIFRADO_V2.test(p.cifra.valorCifrado) || !CIFRADO_V2.test(p.cifra.chaveItemEmbrulhada))) {
        throw new ErroDeDominio("entrada_invalida", { cause: "item do cofre sem cifra v2" });
      }
      const quando = new Date(p.agora);
      const [l] = await conn<LinhaItem[]>`
        insert into cofre_itens (tenant_id, owner_id, visibility, id, tipo, nome, app, publico, dono, valor_cifrado,
                                 chave_item_embrulhada, chave_tenant_versao, versao, criado_em, atualizado_em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${p.dono === "time" ? "equipe" : "privado"}, ${p.id}, ${p.tipo}, ${p.nome},
                ${p.app}, ${conn.json(p.publico as never)}, ${p.dono}, ${p.cifra?.valorCifrado ?? null},
                ${p.cifra?.chaveItemEmbrulhada ?? null}, ${p.cifra?.chaveTenantVersao ?? null}, ${p.versao}, ${quando}, ${quando})
        returning ${conn.unsafe(COLUNAS_ITEM)}`;
      return item(l!);
    },

    /** Revoga (só a dona, pela RLS). false = não existe, já revogado ou não é da pessoa. */
    async revogarItem(id: string, agora: number): Promise<boolean> {
      const quando = new Date(agora);
      const r = await conn`
        update cofre_itens set revogado_em = ${quando}, atualizado_em = ${quando}
        where tenant_id = ${escopo.tenantId} and id = ${id} and revogado_em is null`;
      return r.count > 0;
    },

    /** Os itens vivos que a pessoa vê (os dela e os do time), sem nada de cifra. */
    async listarItens(): Promise<ItemDoCofre[]> {
      const ls = await conn<LinhaItem[]>`
        select ${conn.unsafe(COLUNAS_ITEM)} from cofre_itens
        where tenant_id = ${escopo.tenantId} and revogado_em is null
        order by tipo, nome, criado_em`;
      return ls.map(item);
    },

    async buscarItem(id: string): Promise<ItemDoCofre | null> {
      const [l] = await conn<LinhaItem[]>`select ${conn.unsafe(COLUNAS_ITEM)} from cofre_itens where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? item(l) : null;
    },

    /** O item vivo com as cifras, para a entrega (só o servidor). null = não existe, revogado ou não visível. */
    async itemParaEntrega(id: string): Promise<{ item: ItemDoCofre; cifra: CifraDoItem | null } | null> {
      const [l] = await conn<(LinhaItem & { valor_cifrado: string | null; chave_item_embrulhada: string | null; chave_tenant_versao: number | null })[]>`
        select ${conn.unsafe(COLUNAS_ITEM)}, valor_cifrado, chave_item_embrulhada, chave_tenant_versao from cofre_itens
        where tenant_id = ${escopo.tenantId} and id = ${id} and revogado_em is null`;
      if (!l) return null;
      const cifra = l.valor_cifrado && l.chave_item_embrulhada && l.chave_tenant_versao !== null
        ? { valorCifrado: l.valor_cifrado, chaveItemEmbrulhada: l.chave_item_embrulhada, chaveTenantVersao: l.chave_tenant_versao }
        : null;
      return { item: item(l), cifra };
    },

    /** Marca o uso. Item do time de outra pessoa: zero linhas (a RLS dá UPDATE só à dona); o evento registra o uso igual. */
    async marcarUso(id: string, agora: number): Promise<boolean> {
      const r = await conn`update cofre_itens set ultimo_uso_em = ${new Date(agora)} where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return r.count > 0;
    },

    // ----------------------------------------------------------------------------------------------- concessões

    /**
     * Concede o item ao bot. Cartão é sempre 'perguntar' (ADR-195 §3): a regra mora aqui porque o CHECK da 0185 não olha
     * cofre_itens. A concessão de novo para o mesmo bot troca o modo.
     */
    async conceder(p: { itemId: string; agenteId: string; modo: ModoConcessaoCofre }): Promise<boolean> {
      const [alvo] = await conn<{ tipo: TipoItemCofre }[]>`select tipo from cofre_itens where tenant_id = ${escopo.tenantId} and id = ${p.itemId} and revogado_em is null`;
      if (!alvo) return false;
      if (alvo.tipo === "cartao" && p.modo === "sempre") throw new ErroDeDominio("entrada_invalida", { cause: "cartão é sempre perguntar" });
      const ls = await conn<{ id: string }[]>`
        insert into cofre_concessoes (tenant_id, owner_id, item_id, agente_id, modo)
        select ${escopo.tenantId}, ${escopo.pessoaId}, ${p.itemId}, a.id, ${p.modo}
        from agentes a where a.tenant_id = ${escopo.tenantId} and a.id = ${p.agenteId}
        on conflict (tenant_id, item_id, agente_id) do update set modo = excluded.modo
        returning id`;
      return ls.length > 0;
    },

    async concessao(itemId: string, agenteId: string): Promise<ModoConcessaoCofre | null> {
      const [l] = await conn<{ modo: ModoConcessaoCofre }[]>`
        select modo from cofre_concessoes where tenant_id = ${escopo.tenantId} and item_id = ${itemId} and agente_id = ${agenteId}`;
      return l?.modo ?? null;
    },

    /** Tira o acesso do bot ao item. false = não havia (ou não é da pessoa). */
    async revogarConcessao(itemId: string, agenteId: string): Promise<boolean> {
      const ls = await conn<{ id: string }[]>`
        delete from cofre_concessoes where tenant_id = ${escopo.tenantId} and item_id = ${itemId} and agente_id = ${agenteId} returning id`;
      return ls.length > 0;
    },

    /**
     * Entrega 3: trocar a chave cria a versão nova com outro id; quem podia usar a anterior continua podendo, no mesmo modo.
     * Roda na transação da troca, depois do insert da versão nova.
     */
    async copiarConcessoes(deItem: string, paraItem: string): Promise<number> {
      const ls = await conn<{ id: string }[]>`
        insert into cofre_concessoes (tenant_id, owner_id, item_id, agente_id, modo)
        select ${escopo.tenantId}, ${escopo.pessoaId}, ${paraItem}, c.agente_id, c.modo
        from cofre_concessoes c where c.tenant_id = ${escopo.tenantId} and c.item_id = ${deItem}
        on conflict (tenant_id, item_id, agente_id) do nothing
        returning id`;
      return ls.length;
    },

    /** Quem pode usar cada item (Paper C1 e C2), na ordem em que foi concedido. */
    async concessoesDosItens(itemIds: readonly string[]): Promise<{ itemId: string; agenteId: string; modo: ModoConcessaoCofre; criadaEm: EpochMs }[]> {
      if (!itemIds.length) return [];
      const ls = await conn<{ item_id: string; agente_id: string; modo: ModoConcessaoCofre; criada_em: Date }[]>`
        select item_id, agente_id, modo, criada_em from cofre_concessoes
        where tenant_id = ${escopo.tenantId} and item_id = any(${itemIds as string[]}::uuid[]) order by criada_em, id`;
      return ls.map((l) => ({ itemId: l.item_id, agenteId: l.agente_id, modo: l.modo, criadaEm: ms(l.criada_em) }));
    },

    // -------------------------------------------------------------------------------------------------- eventos

    /** Só acrescenta (nod_app sem UPDATE/DELETE). O evento tem a visibilidade do item: o do time, o tenant vê. */
    async gravarEvento(p: { itemId: string | null; agenteId?: string | null; tipo: TipoEventoCofre; detalhe?: Record<string, unknown>; doTime: boolean; agora: number }): Promise<void> {
      await conn`
        insert into cofre_eventos (tenant_id, owner_id, visibility, item_id, agente_id, tipo, detalhe, criado_em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${p.doTime ? "equipe" : "privado"}, ${p.itemId}, ${p.agenteId ?? null}, ${p.tipo},
                ${conn.json((p.detalhe ?? {}) as never)}, ${new Date(p.agora)})`;
    },

    async eventosDoItem(itemId: string): Promise<EventoDoCofre[]> {
      const ls = await conn<{ id: string; item_id: string | null; agente_id: string | null; tipo: TipoEventoCofre; detalhe: Record<string, unknown>; criado_em: Date }[]>`
        select id, item_id, agente_id, tipo, detalhe, criado_em from cofre_eventos
        where tenant_id = ${escopo.tenantId} and item_id = ${itemId} order by criado_em, id`;
      return ls.map((l) => ({ id: l.id, itemId: l.item_id, agenteId: l.agente_id, tipo: l.tipo, detalhe: l.detalhe, criadoEm: ms(l.criado_em) }));
    },

    /**
     * O uso recente de um item e das versões anteriores dele (Paper C2): a troca cria outro id, e o histórico segue a
     * corrente `anterior` gravada no evento 'trocado'. Os mais novos primeiro, até `limite`.
     */
    async eventosRecentes(itemId: string, limite: number): Promise<EventoDoCofre[]> {
      const ls = await conn<{ id: string; item_id: string | null; agente_id: string | null; tipo: TipoEventoCofre; detalhe: Record<string, unknown>; criado_em: Date }[]>`
        with recursive versoes(id, n) as (
          select ${itemId}::uuid, 0
          union all
          select (e.detalhe ->> 'anterior')::uuid, v.n + 1 from versoes v
          join cofre_eventos e on e.tenant_id = ${escopo.tenantId} and e.item_id = v.id and e.tipo = 'trocado'
            and e.detalhe ->> 'anterior' ~ '^[0-9a-f-]{36}$'
          where v.n < 50
        )
        select e.id, e.item_id, e.agente_id, e.tipo, e.detalhe, e.criado_em from cofre_eventos e
        where e.tenant_id = ${escopo.tenantId} and e.item_id in (select id from versoes)
        order by e.criado_em desc, e.id desc limit ${limite}`;
      return ls.map((l) => ({ id: l.id, itemId: l.item_id, agenteId: l.agente_id, tipo: l.tipo, detalhe: l.detalhe, criadoEm: ms(l.criado_em) }));
    },
  };
}
