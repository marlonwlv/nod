import type { JsonWebKey } from "node:crypto";
import type { PedidoVmDoNod } from "../contracts/vm-do-nod.ts";
import type { ItemDeRevisao, MemoriaDoTime } from "../domain/memoria-de-time.ts";
import type { EstadoDaVez, TipoMembro } from "../domain/vez-na-sala.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms, msOuNull } from "./conversao.ts";

/**
 * definido em 2026-11-12 (0174, frente de comportamento): a persistência das quatro peças que os PRs #732 e
 * #735 deixaram só no domínio — a VM do Nod (ADR-169), a vez na sala e a memória de time (ADR-172) e a passkey do gasto
 * (ADR-177). Só primitivas: as regras moram em src/domain/{vm-do-nod,vez-na-sala,memoria-de-time,passkey}.ts.
 */

export type EstadoVmDoNod = "pedida" | "prevista" | "criando" | "pronta" | "dormindo" | "falhou" | "encerrada";
export type VmDoNodGuardada = { id: string; planoId: string; nome: string; projeto: string; zona: string; requestId: string; driver: "seco" | "gcp"; estado: EstadoVmDoNod; custoMensalCentavos: number; criadoEm: number };

export function vmsDoNodRepo(conn: Conn, escopo: Escopo) {
  type L = { id: string; plano_id: string; nome: string; projeto: string; zona: string; request_id: string; driver: string; estado: string; custo_mensal_centavos: number; criado_em: Date };
  const para = (l: L): VmDoNodGuardada => ({ id: l.id, planoId: l.plano_id, nome: l.nome, projeto: l.projeto, zona: l.zona, requestId: l.request_id, driver: l.driver === "gcp" ? "gcp" : "seco", estado: l.estado as EstadoVmDoNod, custoMensalCentavos: l.custo_mensal_centavos, criadoEm: ms(l.criado_em) });
  // Preguiçoso: criarRepos monta todos os repos com o conn, e quem não usa este não paga (nem quebra com um conn falso).
  const COLS = () => conn`id, plano_id, nome, projeto, zona, request_id, driver, estado, custo_mensal_centavos, criado_em`;
  return {
    /** A VM viva da pessoa (a encerrada não conta). */
    async daPessoa(): Promise<VmDoNodGuardada | null> {
      const [l] = await conn<L[]>`select ${COLS()} from vms_do_nod where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado <> 'encerrada'`;
      return l ? para(l) : null;
    },
    /**
     * Grava o pedido. Idempotente: o mesmo pedido de novo devolve a linha que já existe (o índice parcial impede a 2ª VM
     * viva); um pedido de OUTRO plano com uma VM viva devolve null (quem chama diz que já há uma).
     */
    async pedir(p: PedidoVmDoNod, o: { driver: "seco" | "gcp"; aceitouEm: number }): Promise<VmDoNodGuardada | null> {
      const [l] = await conn<L[]>`insert into vms_do_nod (tenant_id, owner_id, plano_id, nome, projeto, zona, request_id, driver, custo_mensal_centavos, aceitou_cobranca_em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${p.plano.id}, ${p.ref.nome}, ${p.ref.projeto}, ${p.ref.zona}, ${p.requestId}, ${o.driver}, ${p.plano.precoMensalCentavos}, ${data(o.aceitouEm)})
        on conflict (tenant_id, owner_id) where estado <> 'encerrada' do nothing returning ${COLS()}`;
      if (l) return para(l);
      const atual = await this.daPessoa();
      return atual && atual.requestId === p.requestId ? atual : null;
    },
    async mudarEstado(id: string, estado: EstadoVmDoNod): Promise<boolean> {
      const ls = await conn`update vms_do_nod set estado = ${estado}, atualizado_em = clock_timestamp()
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} returning id`;
      return ls.length > 0;
    },
  };
}

export function vezNaSalaRepo(conn: Conn, escopo: Escopo) {
  type L = { pedido_id: string; membro_id: string; membro_tipo: string; estado: string; pedido_em: Date; desde: Date | null };
  return {
    /** O estado da vez (quem fala e a fila, na ordem gravada) para o domínio puro decidir o próximo passo. */
    async estado(salaId: string): Promise<EstadoDaVez> {
      const ls = await conn<L[]>`select pedido_id, membro_id, membro_tipo, estado, pedido_em, desde from vez_na_sala
        where tenant_id = ${escopo.tenantId} and sala_id = ${salaId} and estado in ('na_vez', 'na_fila') order by pedido_em, id`;
      const membro = (l: L) => ({ id: l.membro_id, tipo: (l.membro_tipo === "pessoa" ? "pessoa" : "bot") as TipoMembro });
      const atual = ls.find((l) => l.estado === "na_vez");
      return {
        atual: atual ? { membro: membro(atual), desde: ms(atual.desde ?? atual.pedido_em), pedidoId: atual.pedido_id } : null,
        fila: ls.filter((l) => l.estado === "na_fila").map((l) => ({ membro: membro(l), pedidoId: l.pedido_id, em: ms(l.pedido_em) })),
      };
    },
    /** Trava a sala até o fim da tx: dois pedidos ao mesmo tempo não dão duas vezes. */
    async travar(salaId: string): Promise<void> {
      await conn`select pg_advisory_xact_lock(hashtext(${escopo.tenantId}), hashtext(${`vez:${salaId}`}))`;
    },
    /** Assenta o estado que o domínio devolveu: a vez atual, a fila (com a ordem pelo `em`) e o desfecho de quem saiu. */
    async assentar(salaId: string, e: EstadoDaVez, fechado?: { pedidoId: string; desfecho: "entregou" | "passou" | "vencida" | "saiu" }): Promise<void> {
      if (fechado) {
        await conn`update vez_na_sala set estado = ${fechado.desfecho}, fechado_em = clock_timestamp()
          where tenant_id = ${escopo.tenantId} and sala_id = ${salaId} and pedido_id = ${fechado.pedidoId} and estado in ('na_vez', 'na_fila')`;
      }
      // A vez sai da fila antes de entrar (o índice parcial de uma vez por sala vale a cada linha).
      const abertos = new Set([...(e.atual ? [e.atual.pedidoId] : []), ...e.fila.map((f) => f.pedidoId)]);
      const ls = await conn<{ pedido_id: string }[]>`select pedido_id from vez_na_sala where tenant_id = ${escopo.tenantId} and sala_id = ${salaId} and estado in ('na_vez', 'na_fila')`;
      for (const l of ls) if (!abertos.has(l.pedido_id)) await conn`update vez_na_sala set estado = 'saiu', fechado_em = clock_timestamp() where tenant_id = ${escopo.tenantId} and pedido_id = ${l.pedido_id}`;
      for (const f of e.fila) {
        await conn`insert into vez_na_sala (tenant_id, owner_id, sala_id, pedido_id, membro_id, membro_tipo, estado, pedido_em)
          values (${escopo.tenantId}, ${escopo.pessoaId}, ${salaId}, ${f.pedidoId}, ${f.membro.id}, ${f.membro.tipo}, 'na_fila', ${data(f.em)})
          on conflict (tenant_id, pedido_id) do update set estado = 'na_fila', desde = null`;
      }
      if (e.atual) {
        const a = e.atual;
        await conn`insert into vez_na_sala (tenant_id, owner_id, sala_id, pedido_id, membro_id, membro_tipo, estado, pedido_em, desde)
          values (${escopo.tenantId}, ${escopo.pessoaId}, ${salaId}, ${a.pedidoId}, ${a.membro.id}, ${a.membro.tipo}, 'na_vez', ${data(a.desde)}, ${data(a.desde)})
          on conflict (tenant_id, pedido_id) do update set estado = 'na_vez', desde = ${data(a.desde)}`;
      }
    },
  };
}

export function memoriaDeTimeRepo(conn: Conn, escopo: Escopo) {
  type LI = { id: string; tipo: string; texto: string; proposto_por_agente_id: string; owner_id: string; origem: string | null; estado: string; revisado_por: string | null; revisado_em: Date | null; substitui: string[]; criado_em: Date };
  const paraItem = (l: LI): ItemDeRevisao => ({
    id: l.id, tipo: l.tipo as ItemDeRevisao["tipo"], texto: l.texto, propostoPor: { agenteId: l.proposto_por_agente_id, pessoaId: l.owner_id }, origem: l.origem,
    em: ms(l.criado_em), estado: l.estado as ItemDeRevisao["estado"], revisadoPor: l.revisado_por, revisadoEm: msOuNull(l.revisado_em), ...(l.substitui.length ? { substitui: l.substitui } : {}),
  });
  const COLS = () => conn`id, tipo, texto, proposto_por_agente_id, owner_id, origem, estado, revisado_por, revisado_em, substitui, criado_em`;
  return {
    /** As memórias vivas do time (todo o tenant lê: nascem 'equipe'). */
    async memorias(): Promise<MemoriaDoTime[]> {
      return conn<MemoriaDoTime[]>`select id, texto from memorias_time where tenant_id = ${escopo.tenantId} and substituida_em is null order by criado_em, id`;
    },
    async fila(): Promise<ItemDeRevisao[]> {
      const ls = await conn<LI[]>`select ${COLS()} from itens_memoria_time where tenant_id = ${escopo.tenantId} order by criado_em, id`;
      return ls.map(paraItem);
    },
    /** Grava o item que o domínio montou (proporItem ou consolidar). O item é 'equipe': o time vê a fila. */
    async gravarItem(i: ItemDeRevisao): Promise<ItemDeRevisao> {
      const [l] = await conn<LI[]>`insert into itens_memoria_time (tenant_id, owner_id, visibility, id, tipo, texto, proposto_por_agente_id, origem, estado, substitui, criado_em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, 'equipe', ${i.id}, ${i.tipo}, ${i.texto}, ${i.propostoPor.agenteId}, ${i.origem}, ${i.estado}, ${i.substitui ?? []}, ${data(i.em)})
        returning ${COLS()}`;
      if (!l) throw new Error("item_nao_gravado");
      return paraItem(l);
    },
    /**
     * Assenta a revisão que o domínio decidiu (`revisar`). Aprovada: a memória entra no time e, na fusão, as que ela
     * substitui saem (marcadas, nunca apagadas). Só a dona do item muda a linha (RLS de update da 0001).
     */
    async assentarRevisao(i: ItemDeRevisao): Promise<boolean> {
      const ls = await conn`update itens_memoria_time set estado = ${i.estado}, revisado_por = ${i.revisadoPor}, revisado_em = ${i.revisadoEm === null ? null : data(i.revisadoEm)}
        where tenant_id = ${escopo.tenantId} and id = ${i.id} and estado = 'proposta' returning id`;
      if (ls.length === 0) return false;
      if (i.estado === "aprovada") {
        await conn`insert into memorias_time (tenant_id, owner_id, visibility, texto, item_id) values (${escopo.tenantId}, ${escopo.pessoaId}, 'equipe', ${i.texto}, ${i.id})`;
        if (i.substitui?.length) await conn`update memorias_time set substituida_em = clock_timestamp() where tenant_id = ${escopo.tenantId} and id = any(${i.substitui}::uuid[]) and substituida_em is null`;
      }
      return true;
    },
  };
}

export type PasskeyGuardada = { id: string; credencialId: string; chavePublica: JsonWebKey; rpId: string; contador: number };
export type DesafioGasto = { id: string; compraId: string; centavos: number; moeda: string; nonce: string; desafio: string; expiraEm: number; usadoEm: number | null };

export function passkeysRepo(conn: Conn, escopo: Escopo) {
  const dona = () => conn`tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
  type LP = { id: string; credencial_id: string; chave_publica: JsonWebKey; rp_id: string; contador: string | number };
  type LD = { id: string; compra_id: string; centavos: number; moeda: string; nonce: string; desafio: string; expira_em: Date; usado_em: Date | null };
  const paraP = (l: LP): PasskeyGuardada => ({ id: l.id, credencialId: l.credencial_id, chavePublica: l.chave_publica, rpId: l.rp_id, contador: Number(l.contador) });
  const paraD = (l: LD): DesafioGasto => ({ id: l.id, compraId: l.compra_id, centavos: l.centavos, moeda: l.moeda, nonce: l.nonce, desafio: l.desafio, expiraEm: ms(l.expira_em), usadoEm: msOuNull(l.usado_em) });
  return {
    async registrar(p: { credencialId: string; chavePublica: JsonWebKey; rpId: string; nome?: string }): Promise<PasskeyGuardada> {
      const [l] = await conn<LP[]>`insert into passkeys (tenant_id, owner_id, credencial_id, chave_publica, rp_id, nome)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${p.credencialId}, ${conn.json(p.chavePublica as never)}, ${p.rpId}, ${p.nome ?? null})
        returning id, credencial_id, chave_publica, rp_id, contador`;
      if (!l) throw new Error("passkey_nao_gravada");
      return paraP(l);
    },
    /** A passkey viva da dona com este id de credencial (a revogada não serve). */
    async buscar(credencialId: string): Promise<PasskeyGuardada | null> {
      const [l] = await conn<LP[]>`select id, credencial_id, chave_publica, rp_id, contador from passkeys where ${dona()} and credencial_id = ${credencialId} and revogada_em is null`;
      return l ? paraP(l) : null;
    },
    async criarDesafio(d: { compraId: string; centavos: number; moeda: string; nonce: string; desafio: string; expiraEm: number }): Promise<DesafioGasto> {
      const [l] = await conn<LD[]>`insert into desafios_gasto (tenant_id, owner_id, compra_id, centavos, moeda, nonce, desafio, expira_em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${d.compraId}, ${d.centavos}, ${d.moeda}, ${d.nonce}, ${d.desafio}, ${data(d.expiraEm)})
        returning id, compra_id, centavos, moeda, nonce, desafio, expira_em, usado_em`;
      if (!l) throw new Error("desafio_nao_gravado");
      return paraD(l);
    },
    /**
     * Consome o desafio e sobe o contador da passkey NA MESMA tx, depois de a asserção ser conferida: só o primeiro uso
     * de um desafio válido (não usado, não vencido) devolve true. O segundo, com a mesma asserção, devolve false.
     */
    async consumir(desafioId: string, passkeyId: string, contadorNovo: number, agora: number): Promise<boolean> {
      const ls = await conn`update desafios_gasto set usado_em = ${data(agora)}, passkey_id = ${passkeyId}
        where ${dona()} and id = ${desafioId} and usado_em is null and expira_em > ${data(agora)} returning id`;
      if (ls.length === 0) return false;
      await conn`update passkeys set contador = ${contadorNovo}, usada_em = ${data(agora)} where ${dona()} and id = ${passkeyId}`;
      return true;
    },
  };
}
