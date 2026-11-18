import { expect, it } from "vitest";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { abrirTarefaDaPessoa, fazerAqui, mensagemParaTrabalho } from "../../src/use-cases/coordenar-trabalhos.ts";
import { sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa, autoriaAgente, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-187 §7 (lote B, passo 2, 2026-11-18): a tarefa que a pessoa abre pela tela (⌘N, o "+" da aba). Nada é criado antes
 * da primeira mensagem; ela vira o pedido de uma frente num lote aberto pelo próprio turno (o desenho da rede de 2 min),
 * e o fim acorda o dono uma vez.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

async function montar(trx: Trx) {
  const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { deps, repos } = depsSobre(trx, MARLON);
  const fala = (texto: string, deQuem: "pessoa" | "bot" = "pessoa") =>
    repos.mensagens.criar({ conversaId: ada.conversaId, autoria: deQuem === "pessoa" ? autoriaPessoa(PESSOA_MARLON) : autoriaAgente(ada.agenteId, PESSOA_MARLON), kind: "texto", texto, confianca: "confiavel" });
  return { ada, deps, repos, fala };
}

describeIntegracao("a tarefa aberta pela pessoa (ADR-187 §7)", () => {
  it("a primeira mensagem vira a frente da pessoa, num lote do próprio turno, com a fala na tela da tarefa e fora do chat", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await abrirTarefaDaPessoa(m.deps, { agenteId: m.ada.agenteId, texto: "Escreva o texto da landing do produto novo" });
      const t = r.data.trabalho;
      expect(t).toMatchObject({ origem: "pessoa", forma: "frente", agenteId: m.ada.agenteId, conversaId: m.ada.conversaId, titulo: "Escreva o texto da landing" });
      const turno = (await m.repos.turnos.buscar(r.data.turnoId))!;
      expect(turno).toMatchObject({ estado: "pendente", trabalhoId: t.id, origem: "conversa", entradaConfianca: "confiavel" });
      expect(turno.entradaTexto).toContain("aberta pela pessoa direto na tela de tarefas");
      expect(turno.entradaTexto).toContain("Escreva o texto da landing do produto novo");
      expect(turno.entradaTexto).not.toContain("trouxe para esta tarefa");
      expect(await m.repos.frentes.buscarLote(t.loteId!)).toMatchObject({ abertoPorTurnoId: turno.id, trabalhoId: null, avisarACadaUma: false });
      // A fala da pessoa é a do turno da tarefa: a leitura do chat a marca com o trabalho (mora na tela da tarefa).
      const doChat = await m.repos.mensagens.listarComTurno(m.ada.conversaId, 50);
      const pedido = doChat.find((x) => x.id === turno.mensagemOrigemId);
      expect(pedido).toMatchObject({ texto: "Escreva o texto da landing do produto novo", trabalhoId: t.id });
      expect(doChat.find((x) => x.payload?.kind === "trabalho_aberto")?.texto).toBe(`Você abriu a tarefa ${t.titulo}`);
      expect(r.events?.map((e) => e.kind)).toEqual(expect.arrayContaining(["trabalho_mudou", "mensagem_criada", "turno_criado"]));
    });
  });

  it("com o clipe: os anexos soltos da conversa do bot prendem na fala do pedido e entram no turno; id de fora derruba tudo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const anexo = (await m.repos.anexos.criar({ conversaId: m.ada.conversaId, nome: "briefing.md", mime: "text/markdown", conteudo: new TextEncoder().encode("# briefing") }))!;
      const r = await abrirTarefaDaPessoa(m.deps, { agenteId: m.ada.agenteId, texto: "Leia o briefing e escreva a landing", anexos: [anexo.id] });
      const turno = (await m.repos.turnos.buscar(r.data.turnoId))!;
      expect(turno.entradaAnexos).toEqual([anexo.id]);
      const presos = (await m.repos.anexos.daMensagens([turno.mensagemOrigemId!])).get(turno.mensagemOrigemId!) ?? [];
      expect(presos.map((a) => a.id)).toEqual([anexo.id]);
      // O mesmo anexo, já preso, não serve de novo: nada da segunda tarefa fica gravado.
      await expect(abrirTarefaDaPessoa(m.deps, { agenteId: m.ada.agenteId, texto: "De novo", anexos: [anexo.id] })).rejects.toBeInstanceOf(ErroDeDominio);
    });
  });

  it("levando a conversa: as últimas falas do chat entram na entrada, sem as das outras tarefas", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.fala("Quero uma landing para escolas, em tom leve");
      await m.fala("Combinado: o que é, como funciona e preços por turma.", "bot");
      const outra = await abrirTarefaDaPessoa(m.deps, { agenteId: m.ada.agenteId, texto: "Revise o contrato da escola piloto" });
      const r = await abrirTarefaDaPessoa(m.deps, { agenteId: m.ada.agenteId, texto: "Escreva o texto da landing.", levarConversa: true });
      const entrada = (await m.repos.turnos.buscar(r.data.turnoId))!.entradaTexto;
      expect(entrada).toContain("trouxe para esta tarefa as últimas falas da conversa");
      expect(entrada).toContain("- pessoa: Quero uma landing para escolas, em tom leve");
      expect(entrada).toContain("- Ada: Combinado: o que é, como funciona e preços por turma.");
      expect(entrada).not.toContain("Revise o contrato");
      expect(outra.data.trabalho.id).not.toBe(r.data.trabalho.id);
    });
  });

  it("a tarefa que termina acorda o dono uma vez, na conversa, fora da tarefa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await abrirTarefaDaPessoa(m.deps, { agenteId: m.ada.agenteId, texto: "Levante os números do trimestre" });
      await m.repos.turnos.assentar(r.data.turnoId, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, r.data.trabalho.id);
      expect((await m.repos.trabalhos.buscar(r.data.trabalho.id))?.estado).toBe("terminado");
      const retornos = (await m.repos.turnos.listarDaConversa(m.ada.conversaId, 50)).filter((x) => x.origem === "retomada" && x.retomaTurnoId === r.data.turnoId);
      expect(retornos).toHaveLength(1);
      expect(retornos[0]).toMatchObject({ trabalhoId: null, estado: "pendente" });
    });
  });

  it("a pessoa segue falando na tarefa e o Fazer aqui devolve o pedido sem a moldura", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const r = await abrirTarefaDaPessoa(m.deps, { agenteId: m.ada.agenteId, texto: "Compare os planos de hospedagem" });
      const segunda = await mensagemParaTrabalho(m.deps, { trabalhoId: r.data.trabalho.id, texto: "inclua o preço anual" });
      expect(segunda.data.trabalho.id).toBe(r.data.trabalho.id);
      await m.repos.turnos.assentar(r.data.turnoId, { estado: "concluido" });
      await m.repos.turnos.assentar(segunda.data.mensagemTurnoId, { estado: "concluido" });
      const aqui = await fazerAqui(m.deps, { trabalhoId: r.data.trabalho.id });
      const naConversa = (await m.repos.turnos.buscar(aqui.data.turnoId))!;
      expect(naConversa.trabalhoId).toBeNull();
      expect(naConversa.entradaTexto.endsWith("Faça agora:\nCompare os planos de hospedagem")).toBe(true);
      expect(naConversa.entradaTexto).not.toContain("[nod] Tarefa");
    });
  });

  it("sem texto, bot inexistente ou id fora de uuid: nada é criado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await expect(abrirTarefaDaPessoa(m.deps, { agenteId: m.ada.agenteId, texto: "   " })).rejects.toMatchObject({ codigo: "texto_vazio" });
      await expect(abrirTarefaDaPessoa(m.deps, { agenteId: "00000000-0000-4000-8000-000000000000", texto: "oi" })).rejects.toBeInstanceOf(ErroDeDominio);
      await expect(abrirTarefaDaPessoa(m.deps, { agenteId: "nao-e-uuid", texto: "oi" })).rejects.toMatchObject({ codigo: "nao_encontrado" });
      expect(await m.repos.trabalhos.abertosDoAgente(m.ada.agenteId)).toHaveLength(0);
    });
  });
});
