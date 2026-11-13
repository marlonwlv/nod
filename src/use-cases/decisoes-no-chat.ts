import type { RuntimeEvent } from "../contracts/evento.ts";
import type { PayloadDecisoesResumo, PayloadPropostaDecisoesExportacao, ResultadoDecisoes } from "../contracts/ferramentas-decisoes.ts";
import type { CasoNod, SaidaCasoDeUso } from "../contracts/servicos.ts";
import { diasNoPeriodo } from "../domain/decisoes.ts";
import { ErroDeDominio, ehErroDeDominio } from "../domain/erro.ts";
import { ehNod } from "../domain/nod.ts";
import { autoriaAgente, evento, PRAZO_DECISAO_MS } from "./apoio-l7.ts";
import { exportarDecisoesCsv, lerDecisoes } from "./decisoes-do-bot.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

const MODOS = new Set(["conversa", "criacao"]);
const MAX_ARQUIVOS = 5;
const normalizar = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const recusa = (erro: "fora_da_conversa" | "nao_encontrado" | "entrada_invalida" | "periodo_longo", instrucao: string): SaidaCasoDeUso<ResultadoDecisoes> => ({ data: { ok: false, erro, instrucao } });

function periodosMensais(de: string, ate: string): { de: string; ate: string }[] {
  const partes: { de: string; ate: string }[] = [];
  let cursor = de;
  while (cursor <= ate) {
    const [ano, mes] = cursor.split("-").map(Number);
    if (!ano || !mes) return [];
    const fim = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
    partes.push({ de: cursor, ate: fim < ate ? fim : ate });
    const proximo = new Date(Date.UTC(ano, mes, 1)).toISOString().slice(0, 10);
    cursor = proximo;
  }
  return partes;
}

async function alvo(deps: Deps, agenteId: string, bot?: string) {
  const eu = await deps.repos.agentes.buscar(agenteId);
  if (!eu || eu.ownerId !== deps.escopo.pessoaId) return null;
  if (!bot || normalizar(bot) === normalizar(eu.nome)) return eu;
  if (!ehNod(eu)) return null;
  const agentes = await deps.repos.agentes.listar();
  const achados = agentes.filter((a) => normalizar(a.nome) === normalizar(bot));
  return achados.length === 1 ? achados[0] : null;
}

export const decisoesNoChat: CasoNod<Deps, "decisoes"> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  const modo = input.plano?.modoTurno ?? turno?.origem ?? null;
  if (!turno || turno.agenteId !== input.agenteId || turno.conversaId !== input.conversaId || !modo || !MODOS.has(modo) || turno.sobProcuracaoDe || turno.profundidade > 0) {
    return recusa("fora_da_conversa", "decisoes só vale na conversa direta com a pessoa. Nada mudou.");
  }
  const agente = await alvo(deps, input.agenteId, input.bot);
  if (!agente) return recusa("nao_encontrado", "Não achei esse bot, ou este bot só pode consultar as próprias decisões.");
  const desfecho = input.desfecho ?? "tudo";
  let dias: number;
  try { dias = diasNoPeriodo(input.de, input.ate); } catch { return recusa("entrada_invalida", "Período ou fuso inválido. Nada mudou."); }
  if (dias < 1) return recusa("entrada_invalida", "Período inválido. Nada mudou.");
  const autoria = autoriaAgente(input.agenteId, deps.escopo.pessoaId);
  const events: RuntimeEvent[] = [];

  if (input.acao === "consultar") {
    if (dias > 31) return recusa("periodo_longo", "A consulta no chat aceita até 31 dias; reduza o período ou peça o CSV mensal.");
    try {
      const r = await lerDecisoes(deps, { agenteId: agente.id, de: input.de, ate: input.ate, fuso: input.fuso, desfecho, limite: 4 });
      const total = desfecho === "tudo" ? Object.values(r.data.contagem).reduce((a, b) => a + b, 0) : r.data.contagem[desfecho];
      if (total === 0) return { data: { ok: true, total: 0, linhas: [], instrucao: "Não houve decisões nesse recorte. Diga isso numa frase curta; nenhum card foi criado." } };
      const payload: PayloadDecisoesResumo = { kind: "decisoes_resumo", agenteId: agente.id, agenteNome: agente.nome, de: input.de, ate: input.ate, desfecho, linhas: r.data.linhas, total };
      const m = await deps.repos.mensagens.criar({ conversaId: input.conversaId, turnoId: input.turnoId, autoria, kind: "sistema", texto: `${total} ${total === 1 ? "decisão" : "decisões"} de ${agente.nome}`, payload, confianca: "confiavel" });
      if (m) events.push(evento(deps, "mensagem_criada", autoria, { mensagem_id: m.id, kind: "sistema" }, { conversaId: input.conversaId, turnoId: input.turnoId }));
      return { data: { ok: true, total, linhas: r.data.linhas, instrucao: "O resumo e o card com até 4 linhas já estão no chat. Responda numa frase curta e não repita a lista." }, events };
    } catch (e) {
      if (ehErroDeDominio(e)) return recusa("entrada_invalida", `Não consultei: ${e.codigo}. Confira datas, fuso e filtro.`);
      throw e;
    }
  }

  const periodos = dias > 31 ? periodosMensais(input.de, input.ate) : [{ de: input.de, ate: input.ate }];
  if (periodos.length === 0) return recusa("entrada_invalida", "Período inválido. Nada mudou.");
  if (periodos.length > MAX_ARQUIVOS) return recusa("periodo_longo", `Esse período geraria ${periodos.length} arquivos; cada confirmação aceita até ${MAX_ARQUIVOS}. Divida o pedido.`);
  // Cada exportador aceita até 31 dias. Valida os mesmos recortes mensais que serão gerados: validar o período inteiro
  // faria toda exportação longa falhar antes da divisão. Ainda não cria mensagem nem anexo antes da confirmação.
  try {
    for (const periodo of periodos) {
      await lerDecisoes(deps, { agenteId: agente.id, de: periodo.de, ate: periodo.ate, fuso: input.fuso, desfecho, limite: 1 });
    }
  } catch (e) {
    if (ehErroDeDominio(e)) return recusa("entrada_invalida", `Não preparei o CSV: ${e.codigo}. Confira datas, fuso e filtro.`);
    throw e;
  }
  const payload: PayloadPropostaDecisoesExportacao = { kind: "decisoes_exportacao", agenteId: agente.id, agenteNome: agente.nome, de: input.de, ate: input.ate, fuso: input.fuso, desfecho, periodos };
  const proposta = await deps.repos.propostas.criar({ conversaId: input.conversaId, agenteId: input.agenteId, payload });
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
  const decisao = await deps.repos.decisoes.criar({ id: proposta.id, tipo: "decisoes_exportacao", agenteId: input.agenteId, conversaId: input.conversaId, turnoId: input.turnoId, prazoDecisaoEm: deps.agora() + PRAZO_DECISAO_MS, frase: `Gerar ${periodos.length === 1 ? "o CSV" : `${periodos.length} CSVs mensais`} das decisões de ${agente.nome}?` });
  if (!decisao) throw new ErroDeDominio("estado_invalido", { cause: "decisão não criada" });
  events.push(evento(deps, "proposta_criada", autoria, { propostaId: proposta.id, kind: payload.kind }, { conversaId: input.conversaId, turnoId: input.turnoId }));
  events.push(evento(deps, "decisao_criada", autoria, { decisaoId: decisao.id, tipo: decisao.tipo }, { conversaId: input.conversaId, turnoId: input.turnoId }));
  return { data: { ok: true, estado: "pendente", decisao_id: decisao.id, arquivos: periodos.length, instrucao: "O card Gerar CSV / Agora não está no chat. O arquivo só será criado após o clique; encerre sem dizer que já exportou." }, events };
};

export const aplicarExportacaoDecisoes: CasoDeUso<{ propostaId: string; recusar: boolean }, { arquivos: string[] }> = async (deps, input) => {
  const proposta = await deps.repos.propostas.buscarParaAtualizar(input.propostaId);
  if (!proposta || proposta.payload.kind !== "decisoes_exportacao" || proposta.estado !== "pendente") throw new ErroDeDominio("estado_invalido");
  const decidida = await deps.repos.decisoes.decidir(proposta.id, { por: deps.escopo.pessoaId, agora: deps.agora() });
  if (!decidida) throw new ErroDeDominio("estado_invalido");
  if (input.recusar) {
    await deps.repos.propostas.decidir(proposta.id, "recusada");
    return { data: { arquivos: [] } };
  }
  const p = proposta.payload;
  const arquivos = [] as { nome: string; corpo: string }[];
  for (const periodo of p.periodos) {
    const r = await exportarDecisoesCsv(deps, { agenteId: p.agenteId, de: periodo.de, ate: periodo.ate, fuso: p.fuso, desfecho: p.desfecho });
    arquivos.push(r.data);
  }
  const autoria = autoriaAgente(proposta.agenteId, deps.escopo.pessoaId);
  const m = await deps.repos.mensagens.criar({ conversaId: proposta.conversaId, turnoId: decidida.turnoId, autoria, kind: "sistema", assunto: "sistema.generico", texto: arquivos.length === 1 ? "CSV das decisões" : `${arquivos.length} CSVs mensais das decisões`, payload: null, confianca: "confiavel" });
  if (!m) throw new ErroDeDominio("estado_invalido", { cause: "mensagem não criada" });
  const ids: string[] = [];
  for (const arquivo of arquivos) {
    const a = await deps.repos.anexos.criarGerado({ conversaId: proposta.conversaId, mensagemId: m.id, turnoId: decidida.turnoId, nome: arquivo.nome, mime: "text/csv", conteudo: new TextEncoder().encode(arquivo.corpo) });
    if (!a) throw new ErroDeDominio("estado_invalido", { cause: "anexo não criado" });
    ids.push(a.id);
  }
  await deps.repos.propostas.decidir(proposta.id, "confirmada");
  return { data: { arquivos: ids }, events: [evento(deps, "mensagem_criada", autoria, { mensagem_id: m.id, kind: "sistema" }, { conversaId: proposta.conversaId, turnoId: decidida.turnoId })] };
};
