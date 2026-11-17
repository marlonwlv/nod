import type { RuntimeEvent } from "./evento.ts";
import type { ContratoFerramentaNod, NomeFerramentaNod } from "./ferramentas-nod.ts";
import type { PlanoTurno } from "./plano-turno.ts";

/** Quem chamou a ferramenta, derivado do token de turno e do plano já emitido. */
export type ContextoFerramenta = { turnoId: string; agenteId: string; conversaId: string; plano?: PlanoTurno };

export type SaidaCasoDeUso<O> = { data: O; events?: RuntimeEvent[] };

export type CasoNod<Deps, N extends NomeFerramentaNod> = (
  deps: Deps,
  input: ContextoFerramenta & ContratoFerramentaNod[N]["args"],
) => Promise<SaidaCasoDeUso<ContratoFerramentaNod[N]["resultado"]>>;

export interface UseCasesNod<Deps> {
  lembrar: CasoNod<Deps, "lembrar">;
  atualizarPerfil: CasoNod<Deps, "atualizar_perfil">;
  pedirAcesso: CasoNod<Deps, "pedir_acesso">;
  criarRotina: CasoNod<Deps, "criar_rotina">;
  listarRotinasDoAgente: CasoNod<Deps, "listar_rotinas">;
  verAgendaPeloAgente: CasoNod<Deps, "ver_agenda">;
  pausarRotinaPeloAgente: CasoNod<Deps, "pausar_rotina">;
  reativarRotinaPeloAgente: CasoNod<Deps, "reativar_rotina">;
  atualizarRotinaPeloAgente: CasoNod<Deps, "atualizar_rotina">;
  excluirRotinaPeloAgente: CasoNod<Deps, "excluir_rotina">;
  executarRotinaPeloAgente: CasoNod<Deps, "executar_rotina">;
  pedirAprovacao: CasoNod<Deps, "pedir_aprovacao">;
  pedirAPessoa: CasoNod<Deps, "pedir_a_pessoa">;
  passar: CasoNod<Deps, "passar">;
  encaminhar: CasoNod<Deps, "encaminhar">;
  semNovidade: CasoNod<Deps, "sem_novidade">;
  pedirABot: CasoNod<Deps, "pedir_a_bot">;
  verColegas: CasoNod<Deps, "ver_colegas">;
  publicarArtefato: CasoNod<Deps, "publicar_artefato">;
  lerArtefato: CasoNod<Deps, "ler_artefato">;
  iniciarTarefa: CasoNod<Deps, "iniciar_tarefa">;
  desligar: CasoNod<Deps, "desligar">;
  anotarEntrevista: CasoNod<Deps, "anotar_entrevista">;
  concluirEntrevista: CasoNod<Deps, "concluir_entrevista">;
  proporBot: CasoNod<Deps, "propor_bot">;
  abrirTask: CasoNod<Deps, "abrir_task">;
  mandarParaTask: CasoNod<Deps, "mandar_para_task">;
  meChameAs: CasoNod<Deps, "me_chame_as">;
  esperarComando: CasoNod<Deps, "esperar_comando">;
  abrirFrentes: CasoNod<Deps, "abrir_frentes">;
  mandarParaFrente: CasoNod<Deps, "mandar_para_frente">;
  devolverResumo: CasoNod<Deps, "devolver_resumo">;
  gerirBots: CasoNod<Deps, "gerir_bots">;
  verAppsConectados: CasoNod<Deps, "ver_apps_conectados">;
  registrarRelatoDoNod: CasoNod<Deps, "registrar_relato">;
  criarBots: CasoNod<Deps, "criar_bots">;
  responderPedido: CasoNod<Deps, "responder_pedido">;
  pedirCredencial: CasoNod<Deps, "pedir_credencial">;
  avisarPessoa: CasoNod<Deps, "avisar_pessoa">;
  ajustarBarraLateral: CasoNod<Deps, "ajustar_barra_lateral">;
  abrirConta: CasoNod<Deps, "abrir_conta">;
  buscarConversas: CasoNod<Deps, "buscar_conversas">;
  lerConversa: CasoNod<Deps, "ler_conversa">;
  gerirQuadro: CasoNod<Deps, "gerir_quadro">;
  gerirApps: CasoNod<Deps, "gerir_apps">;
  naoLidosNoChat: CasoNod<Deps, "nao_lidos">;
  decisoesNoChat: CasoNod<Deps, "decisoes">;
  gerirTimes: CasoNod<Deps, "gerir_times">;
  gerirAcessos: CasoNod<Deps, "gerir_acessos">;
  gerirCanvas: CasoNod<Deps, "gerir_canvas">;
  gerirMaquinas: CasoNod<Deps, "gerir_maquinas">;
  removerComputador: CasoNod<Deps, "remover_computador">;
}
