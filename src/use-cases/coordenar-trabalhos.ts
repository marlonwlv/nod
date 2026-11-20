import { excedeQuantidade } from "../domain/anexo.ts";
import { semCitacao, textoParaOBot } from "../domain/citacao.ts";
import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { ModoTurno } from "../contracts/plano-turno.ts";
import type { Trabalho, TrabalhoDto } from "../contracts/trabalho.ts";
import type { Turno } from "../contracts/turno.ts";
import { RETORNO_DO_LOTE } from "../domain/cota-da-ia.ts";
import { capacidadesDe } from "../domain/harness.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { ehFrente, entradaDaTarefaDaPessoa, FALAS_DO_CONTEXTO, pedidoSemMoldura, seguimentoNaRede, type FalaDoContexto } from "../domain/frente.ts";
import { conversaDepoisDoFim, FALA_DEPOIS_DO_FIM } from "../domain/fala-na-frente.ts";
import { molduraFalaNaFrente } from "../domain/mensagem-no-meio.ts";
import { promoveNaRede, tituloDoTrabalho, tituloProvisorio, trabalhoAberto, trabalhoFinal } from "../domain/trabalho.ts";
import { ehFalaSemIa } from "../domain/sem-ia.ts";
import { ehUuid } from "./apoio-l7.ts";
import { autoriaAgente, autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { criarTrabalho, devolverGuardados, linhaTrabalhoAberto, marcarParado, sincronizarTrabalho, trabalhosParaDto, travarTrabalhoComTurnos } from "./trabalhos.ts";

/**
 * A conversa coordena (definido em 2026-10-07, ADR-083 §7, issue #193): repassar um recado, "Fazer depois da …", "Fazer
 * aqui" e a rede de 2 min. O estado do trabalho continua saindo de `sincronizarTrabalho`. Abrir e repassar pelo bot
 * moram em frentes.ts desde 2026-10-12 (ADR-099, I2).
 */

/** A conversa própria do bot: é ali que a linha "Abriu a task …" e o resultado aparecem. */
export async function conversaDoBot(deps: Deps, turno: Turno): Promise<string> {
  const conversa = await deps.repos.conversas.buscar(turno.conversaId);
  if (conversa?.tipo === "propria") return conversa.id;
  const propria = await deps.repos.conversas.buscarPropriaDoAgente(turno.agenteId);
  if (!propria) throw new ErroDeDominio("nao_encontrado", { cause: "conversa própria do bot" });
  return propria.id;
}

/**
 * Põe um recado na faixa do trabalho: a fala (da pessoa, ou do bot que repassa) é gravada sem turno e abre um turno
 * do trabalho com `mensagem_origem_id` — a leitura da conversa a marca com o `trabalhoId`, e a tela a mostra na task.
 * O turno é a RETOMADA do último turno dele, para seguir no modo e na procuração dele (rotina, colega ou conversa).
 * Rodando, a renovação o absorve no meio (absorverNoTrabalho); senão ele roda quando a faixa estiver livre.
 */
export async function enfileirarNoTrabalho(deps: Deps, t: Trabalho, p: { texto: string; entrada: string; deQuem: "pessoa" | { agenteId: string; turno: Turno }; decididoPor?: string; anexos?: readonly string[] }): Promise<{ turno: Turno; events: RuntimeEvent[] }> {
  const agora = deps.agora();
  // Revisão do épico (S10, 2026-10-08): a pessoa falou de novo — a parada da conversa do trabalho se encerra, como a
  // mensagem na conversa faz (enviar-mensagem.ts). Sem isto o turno do recado morria `parado_pela_pessoa` no despacho.
  if (p.deQuem === "pessoa") await deps.repos.paradas.encerrarAbertas({ conversaId: t.conversaId, agora });
  const turnos = await deps.repos.turnos.doTrabalho(t.id);
  const ultimo = turnos.filter((x) => x.motivoInterrupcao !== "absorvido").at(-1) ?? null;
  // ADR-187 §6 + ADR-185 (definido em 2026-11-18): a pessoa continua a tarefa que parou — o que ela tinha dito e a tarefa
  // não leu volta à fila antes desta fala (mais antigo, roda primeiro). Lido depois de `ultimo`: a fala nova retoma o
  // último turno que rodou, não um recado que ainda não rodou.
  const devolvidos = p.deQuem === "pessoa" ? await devolverGuardados(deps, t) : [];
  const autoria = p.deQuem === "pessoa" ? autoriaPessoa(deps.escopo) : autoriaAgente({ agenteId: p.deQuem.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher" });
  const mensagem = await deps.repos.mensagens.criar({ conversaId: t.conversaId, autoria, kind: "texto", texto: p.texto, confianca: p.deQuem === "pessoa" ? "confiavel" : "nao_confiavel" });
  if (!mensagem) throw new ErroDeDominio("nao_permitido");
  // ADR-187 §6 (definido em 2026-11-18): o campo da tarefa tem o clipe do campo da conversa; o arquivo é da conversa do
  // trabalho (o mesmo upload) e vai preso à fala e à entrada do turno, como em enviar-mensagem.ts.
  const anexoIds = p.deQuem === "pessoa" ? [...new Set(p.anexos ?? [])] : [];
  const anexos = anexoIds.length ? await deps.repos.anexos.prender(anexoIds, { conversaId: t.conversaId, mensagemId: mensagem.id }) : [];
  if (anexos.length !== anexoIds.length) throw new ErroDeDominio("entrada_invalida", { cause: "anexo de outra conversa, já enviado ou inexistente" });
  const agente = await deps.repos.agentes.buscar(t.agenteId);
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: t.conversaId,
    agenteId: t.agenteId,
    origem: ultimo ? "retomada" : "conversa",
    // Retomar a sessão da task é detalhe técnico: cada fala nova da pessoa ainda abre gasto e conta na cota.
    ...(p.deQuem === "pessoa" ? { contaCotaProvisorio: true } : {}),
    retomaTurnoId: ultimo?.id ?? null,
    trabalhoId: t.id,
    prazoEm: agora + PRAZO_DECISAO_PADRAO_MS,
    profundidade: ultimo?.profundidade ?? 0,
    entradaTexto: p.entrada,
    entradaConfianca: ultimo?.entradaConfianca ?? "confiavel",
    sobProcuracaoDe: ultimo?.sobProcuracaoDe ?? null,
    modelo: ultimo?.modelo ?? agente?.modelo ?? "auto",
    harness: ultimo?.harness ?? agente?.harness,
    // NOD-206: o do último turno da task; sem ele, o do bot que repassa (o da pessoa é só palpite — o plano corrige).
    executor: ultimo?.executor ?? (p.deQuem === "pessoa" ? "catcher" : p.deQuem.turno.executor),
    mensagemOrigemId: mensagem.id,
    // NOD-285: o recado que o bot repassa à frente dele leva o arquivo da fala da pessoa (a frente é o próprio bot).
    entradaAnexos: p.deQuem === "pessoa" ? anexos.map((a) => a.id) : p.deQuem.turno.entradaAnexos,
    ...(p.decididoPor ? { decididoPor: p.decididoPor } : {}),
  });
  if (!turno) throw new ErroDeDominio("estado_invalido", { cause: "turno do recado não criado" });
  if (ultimo && (await deps.repos.turnos.contaminado(ultimo.id))) await deps.repos.turnos.contaminar(turno.id, agora);
  // Revisão do épico (S6, 2026-10-08): o recado repassado pela conversa carrega a marca (ADR-062) do turno da CONVERSA
  // que o escreveu, como o abrir_task faz — senão a página lida na conversa entrava limpa na task.
  if (p.deQuem !== "pessoa" && (p.deQuem.turno.entradaConfianca !== "confiavel" || (await deps.repos.turnos.contaminado(p.deQuem.turno.id)))) await deps.repos.turnos.contaminar(turno.id, agora);
  const events: RuntimeEvent[] = [
    ...devolvidos.map((v) => evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: v.conversaId, turnoId: v.id, dados: { origem: v.origem, agente_id: v.agenteId, trabalhoId: t.id, devolvido_ao_continuar: true } })),
    evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: t.conversaId, turnoId: turno.id, dados: { mensagem_id: mensagem.id, kind: "texto", trabalho_id: t.id } }),
    evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: t.conversaId, turnoId: turno.id, dados: { origem: turno.origem, agente_id: t.agenteId, trabalhoId: t.id } }),
    // NOD-256 (F1.3): só a pessoa reabre a task num estado final; o recado do bot cai antes (mandarParaFrente recusa).
    // NOD-376 (revisão do PR #539, A1): a conversa da pessoa na frente não arquiva o resumo — a frente que ela reabre
    // para perguntar algo, ao acabar de novo, não acorda o dono nem responde ao colega com o papo dela (critério 4).
    // Revisão 4 do PR #539 (definido em 2026-10-27): só a fala marcada (frente terminada); a frente parada ou que falhou segue o caminho de antes (continuar).
    ...(await sincronizarTrabalho(deps, t.id, p.deQuem === "pessoa" ? { reabrir: true, ...(p.decididoPor === FALA_DEPOIS_DO_FIM ? { guardaResumo: true as const } : {}) } : {})),
  ];
  return { turno, events };
}

/** POST trabalhos/:id/mensagens: a pessoa escreve na tela da task (ADR-187 §6, 2026-11-18: com os anexos do clipe). */
export const mensagemParaTrabalho: CasoDeUso<{ trabalhoId: string; texto: string; anexos?: readonly string[] }, { trabalho: TrabalhoDto; mensagemTurnoId: string }> = async (deps, input) => {
  const texto = typeof input.texto === "string" ? input.texto.trim() : "";
  const anexos = [...new Set((input.anexos ?? []).filter((a): a is string => typeof a === "string"))];
  if (texto === "" && anexos.length === 0) throw new ErroDeDominio("texto_vazio");
  if (excedeQuantidade(anexos.length)) throw new ErroDeDominio("entrada_invalida", { cause: "anexos demais" });
  const t = await deps.repos.trabalhos.buscar(input.trabalhoId);
  if (!t) throw new ErroDeDominio("nao_encontrado");
  // NOD-376: a fala da pessoa entra na frente com a moldura "responda primeiro" (rodando ou reaberta); a mensagem gravada
  // (a que a tela mostra) segue com o texto dela.
  // Revisão do PR #539: o comando ("/compactar", "/review 420") segue cru, para continuar reconhecido como comando.
  // Revisão 3 do PR #539 (definido em 2026-10-27): a frente que já tinha acabado (ou que já reabriu só para conversar) ganha a marca FALA_DEPOIS_DO_FIM —
  // o fecho do lote e o devolver_resumo a reconhecem — e a moldura que diz para não refazer.
  // Revisão 4 do PR #539 (definido em 2026-10-27): só a frente que terminou; a parada (Parar) ou a que falhou a pessoa retoma pela barra, como antes.
  const depoisDoFim = ehFrente(t) && (t.estado === "terminado" || conversaDepoisDoFim(await deps.repos.turnos.doTrabalho(t.id)));
  // Revisão 5 do PR #539 (definido em 2026-10-27): só a frente ganha a moldura; a task comum (rotina, colega) segue com o texto cru, como antes.
  const entrada = !ehFrente(t) || /^\/[\w.:-]+(\s|$)/.test(texto) ? texto : molduraFalaNaFrente(texto, { frenteAcabou: depoisDoFim });
  const r = await enfileirarNoTrabalho(deps, t, { texto, entrada, deQuem: "pessoa", anexos, ...(depoisDoFim ? { decididoPor: FALA_DEPOIS_DO_FIM } : {}) });
  const [dto] = await trabalhosParaDto(deps, [(await deps.repos.trabalhos.buscar(t.id)) ?? t]);
  return { data: { trabalho: dto!, mensagemTurnoId: r.turno.id }, events: r.events };
};

/**
 * POST agentes/:id/tarefas {texto, levarConversa?}: a pessoa abre uma tarefa pela tela (ADR-187 §7, lote B, passo 2,
 * definido em 2026-11-18: ⌘N, o "+" da aba presa ao campo, "Abrir uma tarefa" da dica). A tela abre limpa e nada é criado
 * antes da primeira mensagem; é ela que chega aqui e vira o pedido.
 *
 * Mesmo desenho da rede de 2 min (promoverNaRede): um lote de uma frente aberto pelo PRÓPRIO turno dela, então o fecho
 * (fechar-lote.ts) acorda o dono uma vez com o resumo e a conversa diz o que ficou pronto. A fala da pessoa é gravada
 * como a fala na tarefa (`mensagemOrigemId`), por isso mora na tela da tarefa e não no chat. O turno nasce sem trabalho e
 * é ligado a ele na mesma transação (o lote precisa do turno; o trabalho, do lote): o despachante nunca o vê solto.
 * "Levar o contexto da conversa" junta à entrada as últimas falas do chat com o dono (blocoDoContexto, com teto).
 */
export const abrirTarefaDaPessoa: CasoDeUso<{ agenteId: string; texto: string; levarConversa?: boolean; anexos?: readonly string[] }, { trabalho: TrabalhoDto; turnoId: string }> = async (deps, input) => {
  const texto = typeof input.texto === "string" ? input.texto.trim() : "";
  if (texto === "") throw new ErroDeDominio("texto_vazio");
  // Validação de 2026-11-18: o clipe do campo da tarefa nova (ids soltos da conversa do bot), como na fala na tarefa.
  const anexoIds = [...new Set((input.anexos ?? []).filter((a): a is string => typeof a === "string"))];
  if (excedeQuantidade(anexoIds.length)) throw new ErroDeDominio("entrada_invalida", { cause: "anexos demais" });
  if (!ehUuid(input.agenteId)) throw new ErroDeDominio("nao_encontrado");
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente || agente.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado");
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agente.id);
  if (!conversa) throw new ErroDeDominio("nao_encontrado", { cause: "conversa própria do bot" });
  const agora = deps.agora();
  // Como a fala na tarefa (enfileirarNoTrabalho): a pessoa falou de novo, a parada da conversa do bot se encerra.
  await deps.repos.paradas.encerrarAbertas({ conversaId: conversa.id, agora });
  const contexto = input.levarConversa === true ? await contextoDaConversa(deps, conversa.id, agente.nome) : { falas: [], deFora: false };
  const titulo = tituloProvisorio(texto);
  const autoria = autoriaPessoa(deps.escopo);
  const mensagem = await deps.repos.mensagens.criar({ conversaId: conversa.id, autoria, kind: "texto", texto, confianca: "confiavel" });
  if (!mensagem) throw new ErroDeDominio("nao_permitido");
  // Prende só o que é solto, desta conversa e da dona; qualquer id que sobrar derruba a tx inteira (enviarMensagem).
  const anexos = anexoIds.length ? await deps.repos.anexos.prender(anexoIds, { conversaId: conversa.id, mensagemId: mensagem.id }) : [];
  if (anexos.length !== anexoIds.length) throw new ErroDeDominio("entrada_invalida", { cause: "anexo de outra conversa, já enviado ou inexistente" });
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: conversa.id,
    agenteId: agente.id,
    origem: "conversa",
    // A primeira fala da tarefa conta na cota do espaço sem conta, como a fala na tarefa (NOD-408).
    contaCotaProvisorio: true,
    trabalhoId: null,
    prazoEm: agora + PRAZO_DECISAO_PADRAO_MS,
    profundidade: 0,
    entradaTexto: entradaDaTarefaDaPessoa({ titulo: tituloDoTrabalho(titulo), pedido: texto, contexto: contexto.falas }),
    entradaConfianca: "confiavel",
    modelo: agente.modelo,
    harness: agente.harness,
    // NOD-206: palpite de quem enfileira; o plano grava o executor real.
    executor: "catcher",
    mensagemOrigemId: mensagem.id,
    entradaAnexos: anexos.map((a) => a.id),
    // A pessoa está olhando a tela da tarefa (NOD-272): a cota não a segura como fundo.
    pessoaEsperando: true,
  });
  if (!turno) throw new ErroDeDominio("estado_invalido", { cause: "turno da tarefa não criado" });
  // A fala de fora que veio no contexto marca o turno (ADR-062), como o recado repassado pela conversa.
  if (contexto.deFora) await deps.repos.turnos.contaminar(turno.id, agora);
  const lote = await deps.repos.frentes.criarLote({ agenteId: agente.id, abertoPorTurnoId: turno.id, trabalhoId: null, avisarACadaUma: false });
  if (!lote) throw new ErroDeDominio("estado_invalido", { cause: "lote da tarefa não criado" });
  const { trabalho, events } = await criarTrabalho(deps, { agenteId: agente.id, conversaId: conversa.id, titulo, origem: "pessoa", forma: "frente", loteId: lote.id, pessoaEsperando: true });
  const ligado = await deps.repos.turnos.vincularTrabalho(turno.id, trabalho.id, "pendente");
  if (!ligado) throw new ErroDeDominio("estado_invalido", { cause: "turno da tarefa sem trabalho" });
  events.push(
    evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: conversa.id, turnoId: turno.id, dados: { mensagem_id: mensagem.id, kind: "texto", trabalho_id: trabalho.id } }),
    evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: conversa.id, turnoId: turno.id, dados: { origem: turno.origem, agente_id: agente.id, trabalhoId: trabalho.id } }),
    ...(await linhaTrabalhoAberto(deps, trabalho, turno.id)),
    ...(await sincronizarTrabalho(deps, trabalho.id)),
  );
  const [dto] = await trabalhosParaDto(deps, [(await deps.repos.trabalhos.buscar(trabalho.id)) ?? trabalho]);
  return { data: { trabalho: dto!, turnoId: turno.id }, events };
};

/** As falas do chat com o dono (sem as das tarefas, os avisos e as falas sem IA), para "Levar o contexto da conversa". */
async function contextoDaConversa(deps: Deps, conversaId: string, nomeDoBot: string): Promise<{ falas: FalaDoContexto[]; deFora: boolean }> {
  const doChat = (await deps.repos.mensagens.listarComTurno(conversaId, FALAS_DO_CONTEXTO * 3, { comDestino: true }))
    .filter((m) => m.kind === "texto" && !m.trabalhoId && (m.destino ?? "chat") === "chat" && !m.bastidores && !ehFalaSemIa(m))
    .slice(-FALAS_DO_CONTEXTO);
  return {
    falas: doChat.map((m) => ({ autor: m.autoria.autor_tipo === "pessoa" ? "pessoa" : nomeDoBot, texto: textoParaOBot(m) })),
    deFora: doChat.some((m) => m.confianca !== "confiavel"),
  };
}

/**
 * definido em 2026-10-08 (revisão do épico, S9): "Fazer aqui" e "Fazer depois" são da task que a pessoa (ou a rede, que
 * nasceu de uma fala dela) abriu. Na de colega a procuração e a resposta a quem pediu se perdiam; na de rotina, a janela.
 */
function origemDaPessoa(t: Pick<Trabalho, "origem">): boolean {
  return t.origem === "pessoa" || t.origem === "rede";
}

/** O trabalho de que `de` depende, subindo a corrente: impede o ciclo A depois de B depois de A. */
async function dependeDe(deps: Deps, de: Trabalho, alvoId: string): Promise<boolean> {
  let atual: Trabalho | null = de;
  for (let saltos = 0; atual && saltos < 50; saltos++) {
    if (atual.id === alvoId) return true;
    atual = atual.depoisDeTrabalhoId ? await deps.repos.trabalhos.buscar(atual.depoisDeTrabalhoId) : null;
  }
  return false;
}

/**
 * "Fazer depois" com a task já rodando (definido em 2026-10-08, achado do e2e da #193): o botão fica na linha que anunciou
 * a task, e o laço pega o primeiro turno dela em ~1 s — a pessoa quase sempre aperta com ela já rodando. Gravar só o
 * `depois_de` deixava a task trabalhando enquanto a tela dizia "começa depois da …". O turno vivo é parado e o mesmo
 * pedido volta à fila da task, que agora espera a outra (a sessão que o turno parado deixar é retomada). Só na task da
 * pessoa: a de rotina e a de colega têm a janela e a resposta presas ao id do turno, e a tela não mostra o botão nelas.
 */
async function voltarParaAFila(deps: Deps, t: Trabalho): Promise<RuntimeEvent[]> {
  if (t.origem !== "pessoa") return [];
  const vivos = (await deps.repos.turnos.doTrabalho(t.id)).filter((x) => x.estado === "despachando" && x.pararSolicitadoEm === null);
  if (vivos.length === 0) return [];
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  await deps.repos.turnos.pedirInterrupcao(vivos.map((x) => x.id), agora);
  const events: RuntimeEvent[] = [];
  for (const v of vivos) {
    const novo = await deps.repos.turnos.enfileirar({
      conversaId: v.conversaId,
      agenteId: v.agenteId,
      origem: v.origem,
      retomaTurnoId: v.retomaTurnoId ?? null,
      trabalhoId: t.id,
      prazoEm: agora + PRAZO_DECISAO_PADRAO_MS,
      profundidade: v.profundidade,
      entradaTexto: v.entradaTexto,
      entradaAnexos: v.entradaAnexos,
      entradaConfianca: v.entradaConfianca,
      sobProcuracaoDe: v.sobProcuracaoDe ?? null,
      modelo: v.modelo,
      harness: v.harness,
      executor: v.executor,
    });
    if (!novo) throw new ErroDeDominio("estado_invalido", { cause: "turno da task não voltou à fila" });
    if (await deps.repos.turnos.contaminado(v.id)) await deps.repos.turnos.contaminar(novo.id, agora);
    events.push(evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: v.conversaId, turnoId: novo.id, dados: { origem: novo.origem, agente_id: t.agenteId, trabalhoId: t.id, voltou_de: v.id } }));
  }
  // Como o Parar da task: o pedido fica gravado; o processo recebe o SIGTERM aqui e a entrega assenta como parado.
  for (const v of vivos) await deps.services.interruptor.interromper(v.id).catch(() => false);
  return events;
}

/** POST trabalhos/:id/depois {depoisDe}: "Fazer depois da …" — a task espera a outra terminar, parar ou falhar. null tira. */
export const fazerDepois: CasoDeUso<{ trabalhoId: string; depoisDe: string | null }, { trabalho: TrabalhoDto }> = async (deps, input) => {
  if (input.depoisDe !== null && typeof input.depoisDe !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "depoisDe" });
  // Revisão do épico (S8): id do corpo fora de uuid é "não achei", nunca 22P02.
  if (input.depoisDe !== null && !ehUuid(input.depoisDe)) throw new ErroDeDominio("nao_encontrado", { cause: "depoisDe" });
  const atual0 = await deps.repos.trabalhos.buscar(input.trabalhoId);
  if (!atual0) throw new ErroDeDominio("nao_encontrado");
  // Revisão do épico (S11, 2026-10-08): as esperas do bot mudam uma de cada vez. Duas "Fazer depois" cruzadas (A depois
  // de B e B depois de A) liam a corrente sem trava e gravavam o ciclo, e as duas tasks nunca mais começavam.
  await deps.repos.trabalhos.travarEsperas(atual0.agenteId);
  // Revisão do épico (S20): o "Fazer depois" com a task rodando pede a interrupção do turno vivo (voltarParaAFila) —
  // turnos antes do trabalho, como em toda parte.
  const { turnos: _turnos, ...t } = await travarTrabalhoComTurnos(deps, input.trabalhoId);
  // Revisão do épico (S9): só a task da pessoa ou da rede espera outra; a de colega e a de rotina têm quem espera por
  // elas (o bot que pediu, a janela da rotina).
  if (!origemDaPessoa(t)) throw new ErroDeDominio("estado_invalido", { cause: `"Fazer depois" só vale para task da pessoa ou da rede, não de ${t.origem}` });
  let esperaOutro = false;
  if (input.depoisDe !== null) {
    const outro = await deps.repos.trabalhos.buscar(input.depoisDe);
    if (!outro || outro.agenteId !== t.agenteId) throw new ErroDeDominio("nao_encontrado");
    if (outro.id === t.id || (await dependeDe(deps, outro, t.id))) throw new ErroDeDominio("entrada_invalida", { cause: "ciclo de depois_de" });
    esperaOutro = trabalhoAberto(outro.estado);
  }
  const marcado = await deps.repos.trabalhos.marcarDepoisDe(t.id, input.depoisDe);
  if (!marcado) throw new ErroDeDominio("estado_invalido");
  const events = esperaOutro ? await voltarParaAFila(deps, marcado) : [];
  events.push(...(await sincronizarTrabalho(deps, t.id)));
  const atual = (await deps.repos.trabalhos.buscar(t.id)) ?? marcado;
  if (events.length === 0) events.push(eventoDe(deps, atual));
  const [dto] = await trabalhosParaDto(deps, [atual]);
  return { data: { trabalho: dto! }, events };
};

function eventoDe(deps: Deps, t: Trabalho): RuntimeEvent {
  return evento(deps.escopo, { kind: "trabalho_mudou", autoria: autoriaPessoa(deps.escopo), agora: deps.agora(), conversaId: t.conversaId, dados: { trabalhoId: t.id, agenteId: t.agenteId, conversaId: t.conversaId, estado: t.estado, origem: t.origem } });
}

/**
 * POST trabalhos/:id/fazer-aqui: a pessoa desfaz a task. Ela é parada (os turnos dela interrompidos) e o pedido que a
 * abriu vira um turno da CONVERSA, que roda na sessão dela.
 */
export const fazerAqui: CasoDeUso<{ trabalhoId: string }, { trabalho: TrabalhoDto; turnoId: string }> = async (deps, input) => {
  // Revisão do épico (S20): turnos abertos antes do trabalho, a ordem da renovação e da entrega.
  const { turnos: abertos, ...t } = await travarTrabalhoComTurnos(deps, input.trabalhoId);
  if (trabalhoFinal(t.estado)) throw new ErroDeDominio("estado_invalido", { cause: "task já acabou" });
  if (!origemDaPessoa(t)) throw new ErroDeDominio("estado_invalido", { cause: `"Fazer aqui" só vale para task da pessoa ou da rede, não de ${t.origem}` });
  const agora = deps.agora();
  const primeiro = (await deps.repos.turnos.doTrabalho(t.id))[0];
  const turnos = abertos;
  const autoria = autoriaPessoa(deps.escopo);
  const events: RuntimeEvent[] = [];
  for (const p of turnos.filter((x) => x.estado === "pendente")) {
    if (await deps.repos.turnos.interromper(p.id, "parado_pela_pessoa")) events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: p.conversaId, turnoId: p.id, dados: { motivo: "parado_pela_pessoa", estava: "pendente", trabalho_id: t.id } }));
  }
  const vivos = turnos.filter((x) => x.estado === "despachando").map((x) => x.id);
  await deps.repos.turnos.pedirInterrupcao(vivos, agora);
  for (const id of vivos) await deps.services.interruptor.interromper(id).catch(() => false);
  events.push(...(await marcarParado(deps, t)));
  const agente = await deps.repos.agentes.buscar(t.agenteId);
  const pedido = primeiro ? pedidoSemMoldura(t.titulo, primeiro.entradaTexto) : t.titulo;
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: t.conversaId,
    agenteId: t.agenteId,
    origem: "conversa",
    trabalhoId: null,
    prazoEm: agora + PRAZO_DECISAO_PADRAO_MS,
    profundidade: 0,
    entradaTexto: `[nod] A pessoa pediu para fazer aqui, na conversa, o que ia virar a task "${t.titulo}". Faça agora:\n${pedido}`,
    // NOD-285: o pedido que volta para a conversa leva o arquivo que a task tinha recebido.
    entradaAnexos: primeiro?.entradaAnexos ?? [],
    entradaConfianca: primeiro?.entradaConfianca ?? "confiavel",
    modelo: agente?.modelo ?? primeiro?.modelo ?? "auto",
    harness: agente?.harness ?? primeiro?.harness,
    // NOD-206: o da task desfeita; sem turno nela, palpite — o plano grava o real.
    executor: primeiro?.executor ?? "catcher",
  });
  if (!turno) throw new ErroDeDominio("estado_invalido", { cause: "turno da conversa não criado" });
  events.push(evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: t.conversaId, turnoId: turno.id, dados: { origem: "conversa", agente_id: t.agenteId, fez_aqui: t.id } }));
  const [dto] = await trabalhosParaDto(deps, [(await deps.repos.trabalhos.buscar(t.id)) ?? t]);
  return { data: { trabalho: dto!, turnoId: turno.id }, events };
};

/**
 * Mensagem a uma task no meio do trabalho (ADR-083, #193): as falas que esperam na faixa DESTE trabalho entram no turno
 * vivo dele, como a absorção da conversa (ADR-067) faz com a conversa. Só falas com mensagem de origem (a da pessoa
 * na tela da task e o recado da conversa) e sem anexo; a retomada de uma decisão nunca é absorvida.
 */
export const absorverNoTrabalho: CasoDeUso<{ turnoId: string; confirma?: boolean; jaOferecidas?: readonly string[] }, { textos: string[]; ids: string[] }> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  if (!turno?.trabalhoId || turno.estado !== "despachando") return { data: { textos: [], ids: [] } };
  // Revisão do épico (S18, 2026-10-08): com `confirma` (o app confirma o que escreveu, #189) o recado NÃO sai da fila
  // aqui — só em confirmarNaSessao. Antes ele saía `absorvido` na hora, e o CLI que morria antes de escrever o perdia.
  if (input.confirma) {
    const fora = new Set(input.jaOferecidas ?? []);
    const fila = (await deps.repos.turnos.doTrabalho(turno.trabalhoId)).filter((t) => t.id !== turno.id && t.estado === "pendente" && Boolean(t.mensagemOrigemId) && t.entradaAnexos.length === 0 && !fora.has(t.id));
    return { data: { textos: fila.map((t) => t.entradaTexto), ids: fila.map((t) => t.id) } };
  }
  const absorvidos = await deps.repos.turnos.absorverDoTrabalho(turno);
  if (absorvidos.length === 0) return { data: { textos: [], ids: [] } };
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const events = absorvidos.map((a) => evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: a.conversaId, turnoId: a.id, dados: { motivo: "absorvido", absorvido_por: turno.id, trabalho_id: turno.trabalhoId ?? null } }));
  await contaminarSeAbsorveuDeFora(deps, turno.id, absorvidos);
  return { data: { textos: absorvidos.map((a) => a.entradaTexto), ids: absorvidos.map((a) => a.id) }, events };
};

/**
 * Revisão do épico (S6, 2026-10-08): o turno vivo que recebeu um recado marcado (ADR-062: o recado veio de um turno que
 * leu algo de fora) passa a carregar a marca — o texto entrou na sessão dele.
 */
export async function contaminarSeAbsorveuDeFora(deps: Pick<Deps, "repos" | "agora">, turnoId: string, absorvidos: readonly Turno[]): Promise<void> {
  for (const a of absorvidos) {
    if (a.entradaConfianca !== "confiavel" || (await deps.repos.turnos.contaminado(a.id))) {
      await deps.repos.turnos.contaminar(turnoId, deps.agora());
      return;
    }
  }
}

/**
 * A rede de 2 min (ADR-083 §2, #193): na renovação, o turno do dono que passou de 2 min trabalhando (e já chamou
 * ferramenta) vira trabalho `rede`; ou antes, quando uma fala da pessoa absorvida espera leitura há REDE_NAO_LIDA_MS
 * (ADR-187, 2026-11-17). O processo segue intocado; a sessão dele passa a ser do trabalho.
 * revisto em 2026-10-12 (ADR-099, I8): o turno promovido vira FRENTE (`forma='frente'`, num lote de uma frente aberto
 * pelo próprio turno), também a retomada do dono em modo conversa, e sem exigir que o harness bifurque. Como o dono
 * segue sai de `seguimentoNaRede`: bifurcando (a próxima fala sai com `bifurcar`, emitir-plano-turno), largando a sessão
 * da conversa (ela foi com a frente; o próximo turno do dono recebe o histórico) ou já sem sessão (Codex).
 */
export const promoverNaRede: CasoDeUso<{ turnoId: string; despachadoEm: number; fezFerramenta: boolean; harness: string | null; sessaoCli: string | null; sessaoExecutor?: Executor | null; maquinaBifurca?: boolean; modo?: ModoTurno | null; redeMs?: number }, { trabalho: Trabalho | null; devolvidas?: string[] }> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  // Sem harness no plano (catcher puro), não há capacidade declarada para decidir: não promove.
  if (!turno || !input.harness) return { data: { trabalho: null } };
  const capacidades = capacidadesDe(input.harness);
  const naoLida = await deps.repos.turnos.naoLidaMaisAntiga(turno.id);
  if (!promoveNaRede({ origem: turno.origem, modo: input.modo, trabalhoId: turno.trabalhoId, estado: turno.estado, despachadoHaMs: deps.agora() - input.despachadoEm, fezFerramenta: input.fezFerramenta, capacidades, redeMs: input.redeMs, naoLidaHaMs: naoLida === null ? null : deps.agora() - naoLida })) return { data: { trabalho: null } };
  // NOD-293 (G10/N9, definido em 2026-10-20): o retorno do lote é a volta das frentes ao dono, não um pedido novo. Promovido,
  // virava outra frente num lote novo — e as frentes que acabavam em segundos pareciam promovidas pela rede.
  // Com `avisar_a_cada_uma`, os retornos intermediários não ficam em `lotes_de_frentes.retorno_turno_id` (só o último fecha o
  // lote): todo retorno nasce com `decidido_por = RETORNO_DO_LOTE` (fechar-lote), e é por ele que se reconhece.
  if (turno.decididoPor === RETORNO_DO_LOTE || (await deps.repos.frentes.ehRetornoDeLote(turno.id))) return { data: { trabalho: null } };
  const segue = seguimentoNaRede(capacidades, input.maquinaBifurca === true);
  // A retomada (uma decisão respondida, a resposta de um colega) tem entrada do nod: o título vem do que a pessoa pediu.
  // ADR-113: a fala que respondeu a outra tem "(respondendo a: «…»)" na entrada; o título é só o que a pessoa escreveu.
  // revisto em 2026-10-18 (plano chat limpo, PR 5): o título é o provisório (até 6 palavras e 40 caracteres, sem
  // saudação), não a mensagem crua cortada em 80; fica assim até o fim (sem `nomear_frente`, decisão 16 do plano).
  const pedido = turno.origem === "retomada" ? ((await deps.repos.turnos.raizDaCadeia(turno.id))?.entradaTexto ?? turno.entradaTexto) : turno.entradaTexto;
  const titulo = tituloProvisorio(semCitacao(pedido));
  const lote = await deps.repos.frentes.criarLote({ agenteId: turno.agenteId, abertoPorTurnoId: turno.id, trabalhoId: null, avisarACadaUma: false });
  if (!lote) throw new ErroDeDominio("estado_invalido", { cause: "lote da rede não criado" });
  const { trabalho, events } = await criarTrabalho(deps, {
    agenteId: turno.agenteId,
    conversaId: turno.conversaId,
    titulo,
    origem: "rede",
    forma: "frente",
    loteId: lote.id,
    estado: "rodando",
    iniciadoEm: deps.agora(),
    sessaoCli: input.sessaoCli,
    sessaoHarness: input.harness,
    sessaoExecutor: input.sessaoExecutor ?? null,
    // revisto em 2026-10-08 (revisão do épico, S13): a task da rede ganha pasta própria, como toda task. O turno promovido
    // segue no cwd em que já roda (o processo não muda); só os turnos SEGUINTES dela usam a pasta nova — o --resume
    // funciona de qualquer cwd. Antes ela ficava na pasta do bot, em paralelo com a conversa.
  });
  // Quem chama roda isto numa transação própria, fora da renovação: a corrida com a entrega desfaz só a promoção.
  const vinculado = await deps.repos.turnos.vincularTrabalho(turno.id, trabalho.id);
  if (!vinculado) throw new ErroDeDominio("estado_invalido", { cause: "turno saiu do despachando durante a promoção" });
  // ADR-099 (I8): a sessão foi com a frente e a máquina não bifurca — a conversa do dono a larga, senão o próximo turno
  // dele a retomaria junto com a frente (dois CLIs na mesma sessão). O dono volta com o histórico recente.
  if (segue === "largar_sessao") await deps.repos.conversas.atualizarSessaoCli(turno.conversaId, null);
  events.push(...(await linhaTrabalhoAberto(deps, trabalho, turno.id)));
  // ADR-187 §3 (definido em 2026-11-17, rodada das duas pesquisas com bot novo): a fala da pessoa que o turno absorveu e o
  // bot ainda não leu (ele esperava os subagentes) volta à fila da conversa, como no Parar (ADR-185). Promovido, o turno
  // larga a faixa da conversa, então ela responde já; sem isso, a resposta ao "quanto é dois mais dois?" nascia na frente.
  const agora = deps.agora();
  const devolvidas: string[] = [];
  for (const volta of await deps.repos.turnos.devolverNaoLidos(turno.id)) {
    devolvidas.push(volta.entradaTexto);
    events.push(evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo), agora, conversaId: volta.conversaId, turnoId: volta.id, dados: { origem: volta.origem, agente_id: volta.agenteId, devolvido_pela_rede: true } }));
  }
  // Quem roda o turno avisa a sessão de que a conversa responde estas (avisoDasFalasDevolvidas): elas já foram escritas nela.
  return { data: { trabalho, ...(devolvidas.length ? { devolvidas } : {}) }, events };
};
