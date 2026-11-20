import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { pedirAprovacao } from "../../src/use-cases/pedir-aprovacao.ts";
import { REGRA_APROVACAO_SUBSTITUIDA } from "../../src/use-cases/substituir-aprovacoes.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const RESULTADO = { desfecho: "sucesso" as const, texto: "feito", sessaoCli: null, sinais: SINAIS, custoUsd: 0.01, tokens: { entrada: 1, saida: 1, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

/**
 * Item 10 dos acessos devolvidos, rodada 2 (2026-11-16): com aprovação aberta, a mensagem nova da pessoa substitui o
 * pedido (como o app de referência e o bot-hq) — fecha por regra, nada roda, não é recusa, e ninguém o retoma.
 */
describeIntegracao("mensagem nova com aprovação aberta: o pedido é substituído, não negado", () => {
  async function cenario(trx: Trx) {
    const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Frida" });
    const email = await repos.conectores.criar({ nome: "Email", slug: "email", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
    await repos.conectores.registrarSonda(email?.id ?? "", { ok: true, catalogo: [{ nome: "enviar", descricao: "envia", schema: { type: "object" }, readOnlyHint: false }], agora: Date.now() });
    const consentimento = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "consentimento", texto: "ok", confianca: "confiavel" });
    await repos.concessoes.conceder({ agenteId, conectorId: email?.id ?? "", capacidade: "enviar", mensagemId: consentimento?.id ?? "" });
    const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "envie", entradaConfianca: "confiavel", modelo: "m" });
    const machineId = randomUUID();
    expect((await repos.turnos.reivindicar({ machineId, agora: Date.now() }))?.id).toBe(turno?.id);
    const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({}), trx });
    const pedir = async (texto: string) => {
      const p = await pedirAprovacao(deps, { turnoId: turno?.id ?? "", agenteId, conversaId, resumo: texto, itens: [{ texto, destino: { conector: "email", ferramenta: "enviar", argumentos: { texto } } }] });
      if (p.data.estado !== "pendente") throw new Error("esperava pendente");
      return p.data.decisao_id;
    };
    const assentar = () => assentarTurno(deps, { turnoId: turno?.id ?? "", machineId, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: RESULTADO, executor: "catcher" });
    return { repos, deps, turnoId: turno?.id ?? "", conversaId, pedir, assentar };
  }

  it("fecha por regra, desmarca os itens, deixa o recibo 'substituída' e não vira retomada", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const decisaoId = await c.pedir("e-mail para ana");
      const r = await enviarMensagem(c.deps, { conversaId: c.conversaId, texto: "na verdade, faça outra coisa" });
      const decisao = await c.repos.decisoes.buscar(decisaoId);
      expect(decisao?.estado).toBe("decidida");
      expect(decisao?.desfecho).toMatchObject({ tipo: "decidida_por_regra", regra: REGRA_APROVACAO_SUBSTITUIDA });
      const itens = await c.repos.itensAprovacao.listar(decisaoId);
      expect(itens.every((i) => !i.selecionado && i.desfecho === null)).toBe(true);
      expect((r.events ?? []).some((e) => e.kind === "decisao_decidida" && e.dados?.regra === REGRA_APROVACAO_SUBSTITUIDA)).toBe(true);
      const recibos = (await c.repos.mensagens.listarDaConversa(c.conversaId, 50)).filter((m) => m.kind === "resultado_aprovacao");
      expect(recibos).toHaveLength(1);
      expect(recibos[0]?.payload).toMatchObject({ kind: "resultado_aprovacao", decisaoId, substituida: true });
      await c.assentar();
      const retomadas = (await c.repos.turnos.listarDaConversa(c.conversaId, 50)).filter((t) => t.origem === "retomada");
      expect(retomadas).toHaveLength(0);
    });
  });

  it("sem aprovação aberta, a mensagem não fecha nada", async () => {
    await withRollback(MARLON, async (trx) => {
      const c = await cenario(trx);
      const r = await enviarMensagem(c.deps, { conversaId: c.conversaId, texto: "oi" });
      expect((r.events ?? []).some((e) => e.kind === "decisao_decidida")).toBe(false);
    });
  });
});
