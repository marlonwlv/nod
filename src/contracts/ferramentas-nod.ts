import { FERRAMENTAS_ROTINA, PARA_BOT } from "./ferramentas-rotina.ts";
import { FERRAMENTAS_ROTINA_LOTE } from "./ferramentas-rotina-lote.ts";
import { FERRAMENTAS_PERFIL } from "./ferramentas-perfil.ts";
import { FERRAMENTAS_ARTEFATO } from "./ferramentas-artefato.ts";
import { FERRAMENTAS_LIGACAO } from "./ferramentas-ligacao.ts";
import { FERRAMENTAS_TRABALHO } from "./ferramentas-trabalho.ts";
import { FERRAMENTAS_FRENTE } from "./ferramentas-frente.ts";
import { FERRAMENTAS_DO_NOD } from "./ferramentas-do-nod.ts";
import { FERRAMENTAS_CRIAR_BOTS } from "./ferramentas-criar-bots.ts";
import { FERRAMENTAS_RESPONDER_PEDIDO } from "./ferramentas-responder-pedido.ts";
import { FERRAMENTAS_CREDENCIAL } from "./ferramentas-credencial.ts";
import { FERRAMENTAS_AVISO } from "./ferramentas-aviso.ts";
import { FERRAMENTAS_BARRA } from "./ferramentas-barra.ts";
import { FERRAMENTAS_CONTA } from "./ferramentas-conta.ts";
import { FERRAMENTAS_QUADRO } from "./ferramentas-quadro.ts";
import { FERRAMENTAS_APPS } from "./ferramentas-apps.ts";
import { FERRAMENTAS_CONVERSAS } from "./ferramentas-conversas.ts";
import { FERRAMENTAS_NAO_LIDOS } from "./ferramentas-nao-lidos.ts";
import { FERRAMENTAS_TIMES } from "./ferramentas-times.ts";
import { FERRAMENTAS_ACESSOS } from "./ferramentas-acessos.ts";
import { FERRAMENTAS_CANVAS } from "./ferramentas-canvas.ts";
import { FERRAMENTAS_MAQUINAS } from "./ferramentas-maquinas.ts";
import { FERRAMENTAS_COMPUTADORES } from "./ferramentas-computadores.ts";
import { FERRAMENTAS_DECISOES } from "./ferramentas-decisoes.ts";
import { SCHEMA_PEDIR_A_PESSOA } from "./pedido.ts";
import { FERRAMENTAS_CARTOES } from "./ferramentas-cartoes.ts";
import type { JsonSchema } from "./json-schema.ts";
export type { JsonSchema } from "./json-schema.ts";
export type { ArgsPedirAPessoa } from "./pedido.ts";
export type { ArgsAtualizarPerfil, ArgsVerColegas, AppDoColega, ColegaListado, ResultadoAtualizarPerfil, ResultadoVerColegas } from "./ferramentas-perfil.ts";
export type { ArgsAtualizarRotina, ArgsCriarRotina, ArgsExcluirRotina, ArgsExecutarRotina, ArgsListarRotinas, ArgsPausarRotina, ArgsReativarRotina, ArgsVerAgenda, ResultadoAlternarRotina, ResultadoCriarRotina, ResultadoListarRotinas, ResultadoPropostaRotina, ResultadoVerAgenda, RotinaListada } from "./ferramentas-rotina.ts";
export type { ArgsEncaminhar, ArgsLembrar, ArgsPassar, ArgsPedirABot, ArgsPedirAcesso, ArgsPedirAprovacao, ArgsSemNovidade, ContratoFerramentaNod, ItemPedidoAprovacao, ResultadoLembrar, ResultadoOk, ResultadoPedirABot, ResultadoPedirAPessoa, ResultadoPedirAprovacao } from "./ferramentas-nod-contrato.ts";

/**
 * As ferramentas nod (cinquenta em 2026-11-08, com o gerir_maquinas da ADA-243 e o remover_computador da ADA-245; quarenta e oito em 2026-11-07, com o gerir_acessos da ADA-241; quarenta e sete em 2026-11-04, com o gerir_canvas da ADA-13; quarenta e seis em 2026-11-02, com o gerir_times da NOD-437 e o gerir_apps da NOD-445; quarenta e quatro em 2026-11-01, com o nao_lidos da NOD-449; quarenta e três em 2026-10-31, com o gerir_quadro da NOD-442; quarenta e duas em 2026-10-29: ajustar_barra_lateral da NOD-119, buscar_conversas e ler_conversa da NOD-61 e ver_agenda da NOD-85; contadas pelo teste; eram VINTE E UMA na contagem original) (EMENDA 16 acrescenta pedir_a_pessoa; sem_novidade entra em 2026-09-21
 * para que uma rotina possa encerrar em silêncio; o ciclo de vida de rotina, do mesmo dia, mora em
 * ferramentas-rotina.ts pelo gatilho de 200 linhas da EMENDA 26; pedir_a_bot substitui perguntar_a_bot e
 * delegar_tarefa em 2026-09-29, ADR-058; ver_colegas entra em 2026-09-28, ADR-050, e mora com atualizar_perfil em
 * ferramentas-perfil.ts pelo mesmo gatilho; publicar_artefato/ler_artefato também em 2026-09-28, ADR-051,
 * em ferramentas-artefato.ts (as três do "A fazer", de 2026-09-30, ADR-064, saíram na NOD-317); gerir_bots, ver_apps_conectados e registrar_relato, só do Nod, em 2026-10-07, ADR-081/082,
 * em ferramentas-do-nod.ts; criar_bots, NOD-210/ADR-104, responder_pedido, NOD-262, avisar_pessoa, NOD-114, e abrir_conta, NOD-351, nos arquivos com o nome delas).
 * Lista FECHADA: cada nome tem um case em chamar-ferramenta.ts (tests/conformidade/capabilities-consumidas, L5) e uma entrada em
 * UseCasesNod (servicos.ts). O CLI as vê como mcp__nod__<nome>. Ferramenta de conector é `${slug}__${tool}` e não mora aqui.
 */
export const FERRAMENTAS_NOD = {
  ...FERRAMENTAS_ROTINA,
  ...FERRAMENTAS_ROTINA_LOTE,
  ...FERRAMENTAS_PERFIL,
  ...FERRAMENTAS_ARTEFATO,
  ...FERRAMENTAS_LIGACAO,
  ...FERRAMENTAS_TRABALHO,
  ...FERRAMENTAS_FRENTE,
  ...FERRAMENTAS_DO_NOD, ...FERRAMENTAS_CRIAR_BOTS, ...FERRAMENTAS_RESPONDER_PEDIDO, ...FERRAMENTAS_CREDENCIAL, ...FERRAMENTAS_AVISO, ...FERRAMENTAS_CARTOES, ...FERRAMENTAS_BARRA, ...FERRAMENTAS_CONTA, ...FERRAMENTAS_CONVERSAS, ...FERRAMENTAS_QUADRO, ...FERRAMENTAS_APPS, ...FERRAMENTAS_NAO_LIDOS, ...FERRAMENTAS_TIMES, ...FERRAMENTAS_ACESSOS, ...FERRAMENTAS_CANVAS, ...FERRAMENTAS_MAQUINAS, ...FERRAMENTAS_COMPUTADORES, ...FERRAMENTAS_DECISOES,
  lembrar: {
    type: "object",
    description: "Guarda uma memória deste agente (preferência, fato ou resumo). A memória não substitui fonte autoritativa.",
    properties: {
      tipo: { type: "string", enum: ["preferencia", "fato", "resumo"], description: "Tipo da memória." },
      texto: { type: "string", description: "O que lembrar, em uma frase.", minLength: 1 },
    },
    required: ["tipo", "texto"],
    additionalProperties: false,
  },
  pedir_acesso: {
    type: "object",
    description: "Pede à pessoa acesso a capacidades de um conector. Vira um pedido com botão; nada é concedido aqui: diga que pediu e encerre o turno.",
    properties: {
      conector: { type: "string", description: "Slug do conector registrado ou do marketplace.", minLength: 1 },
      capacidades: { type: "array", items: { type: "string" }, description: "Nomes exatos das ferramentas do catálogo, ou [] para pedir pelo nível: leitura = as ferramentas de leitura do app; escrita = ler, criar, editar e comentar (apagar, desfazer e ações sem verbo claro ficam de fora). Nunca invente nomes." },
      nivel: { type: "string", enum: ["leitura", "escrita"] },
      para: { type: "string", description: "Para que você precisa do acesso, numa frase curta que começa com verbo no infinitivo, sem citar a pessoa. Ex.: \"Listar as tarefas atrasadas do time\"." },
      nao_pedido: { type: "array", items: { type: "string" }, description: "O que explicitamente NÃO está sendo pedido." },
      para_bot: PARA_BOT,
    },
    required: ["conector", "capacidades", "nivel", "nao_pedido"],
    additionalProperties: false,
  },
  pedir_aprovacao: {
    type: "object",
    description:
      "Submete ações de apps/conectores para aprovação em lista. Computador e terminal não entram aqui: chame computador_interagir/computador_terminal diretamente; o adaptador deles aplica o modo de aprovação e cria o cartão quando necessário. Se voltar 'pendente', ENCERRE o turno: a decisão retoma depois.",
    properties: {
      resumo: { type: "string", description: "Resumo do lote em uma frase.", minLength: 1 },
      itens: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            texto: { type: "string", description: "O item como a pessoa vai ler. Numa mensagem que sai (e-mail, Slack, iMessage, SMS), o corpo exato da mensagem, igual ao argumento do corpo: ela aparece como rascunho, e a pessoa edita o corpo antes de enviar. Uma mensagem por item.", minLength: 1 },
            destino: {
              type: "object",
              properties: {
                conector: { type: "string", description: "Slug de um app/conector. Nunca use computador ou terminal; chame computador_interagir/computador_terminal diretamente.", minLength: 1, not: { type: "string", enum: ["computador", "terminal"] } },
                ferramenta: { type: "string", description: "Ferramenta do conector.", minLength: 1 },
                argumentos: { type: "object", description: "Argumentos da chamada." },
              },
              required: ["conector", "ferramenta", "argumentos"],
              additionalProperties: false,
            },
            origem_conector: { type: "string", description: "Slug do conector de onde o dado veio, se veio de conector.", minLength: 1 },
          },
          required: ["texto", "destino"],
          additionalProperties: false,
        },
      },
    },
    required: ["resumo", "itens"],
    additionalProperties: false,
  },
  /** O schema mora em pedido.ts desde 2026-09-24 (emenda da ADR-045): a pergunta virou fala com respostas prontas. */
  pedir_a_pessoa: SCHEMA_PEDIR_A_PESSOA,
  passar: {
    type: "object",
    description: "Passa a vez na sala sem falar. O motivo é tipado.",
    properties: { motivo: { type: "string", enum: ["passei_sem_nada_a_dizer", "negado_fail_closed", "ausente_offline", "cota_esgotada"] } },
    required: ["motivo"],
    additionalProperties: false,
  },
  encaminhar: {
    type: "object",
    description: "Encaminha a rodada da sala para outro bot membro (handoff visível). No máximo 3 por rodada sem fala humana.",
    properties: {
      para_agente: { type: "string", description: "Nome do bot destinatário.", minLength: 1 },
      motivo: { type: "string", description: "Por que ele é o certo para continuar.", minLength: 1 },
    },
    required: ["para_agente", "motivo"],
    additionalProperties: false,
  },
  sem_novidade: {
    type: "object",
    description: "Encerra a rotina em SILÊNCIO: você consultou a fonte e nada mudou. Nenhuma mensagem aparece na conversa; a execução fica só no histórico da rotina. Use sempre que a verificação não revelou nada que mude o que a pessoa já sabe — em vez de escrever um texto dizendo que não há novidade. Não chame se houver qualquer coisa a relatar, nem se a consulta falhou (aí relate o bloqueio em texto).",
    properties: { motivo: { type: "string", enum: ["nada_mudou", "fonte_vazia", "ja_relatado"] } },
    required: ["motivo"],
    additionalProperties: false,
  },
  /** ADR-058: UM jeito de pedir a um colega; a mensagem da pessoa que abriu o turno vai junto. NOD-417: `tarefa` vira comentário. */
  pedir_a_bot: {
    type: "object",
    description: "Pede a um colega (outro bot da pessoa) uma resposta ou um trabalho: explicar, consultar, levantar, revisar, corrigir, preparar. Ele resolve com os acessos e ferramentas DELE e pede o que faltar. Agenda trabalho assíncrono: diga que pediu e encerre; o resultado chega em um novo turno.",
    properties: {
      agente: { type: "string", description: "Id do diretório de colegas, ou nome único do bot.", minLength: 1 },
      pedido: { type: "string", description: "O que você precisa, autocontido: a pergunta ou a tarefa e o que deve voltar.", minLength: 1 },
      contexto: { type: "string", description: "Onde achar o trabalho: links, números, nomes, o que já se sabe." },
      tarefa: { type: "string", description: "Id ou título de uma tarefa do quadro da pessoa: o pedido vira um comentário seu nela e aciona o colega (um bot da pessoa) sem trocar o responsável. O resultado volta a você como sem a tarefa.", minLength: 1 },
    },
    required: ["agente", "pedido"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type NomeFerramentaNod = keyof typeof FERRAMENTAS_NOD;

/**
 * Lista LITERAL (EMENDA 26: nada de Object.keys em src/contracts). `satisfies` recusa nome fora de
 * FERRAMENTAS_NOD; ferramentas-nod.test.ts prova (no tipo e em runtime) que cobre TODAS as chaves.
 */
export const NOMES_FERRAMENTAS_NOD = [
  "lembrar", "atualizar_perfil", "pedir_acesso", "criar_rotina",
  "listar_rotinas", "ver_agenda", "pausar_rotina", "reativar_rotina", "pausar_todas_rotinas", "reativar_lote_rotinas", "atualizar_rotina", "excluir_rotina", "executar_rotina", "pedir_aprovacao",
  "pedir_a_pessoa", "passar", "encaminhar", "sem_novidade", "pedir_a_bot", "ver_colegas", "publicar_artefato", "ler_artefato",
  "iniciar_tarefa", "desligar",
  "anotar_entrevista", "concluir_entrevista", "propor_bot", "abrir_task", "mandar_para_task",
  "gerir_bots", "ver_apps_conectados", "registrar_relato", "me_chame_as", "esperar_comando", "abrir_frentes", "mandar_para_frente", "devolver_resumo", "criar_bots", "responder_pedido", "pedir_credencial", "avisar_pessoa", "mostrar_cartoes", "abrir_conta", "buscar_conversas", "ler_conversa", "ajustar_barra_lateral", "gerir_quadro", "nao_lidos", "decisoes", "gerir_apps", "gerir_times", "gerir_canvas", "gerir_acessos", "gerir_maquinas", "remover_computador",
] as const satisfies readonly NomeFerramentaNod[];
