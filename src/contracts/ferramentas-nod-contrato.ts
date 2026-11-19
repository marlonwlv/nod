import type { ResultadoPedirAcesso } from "./acesso.ts";
import type { ContratoFerramentasAcessos } from "./ferramentas-acessos.ts";
import type { ContratoFerramentasApps } from "./ferramentas-apps.ts";
import type { ContratoFerramentasArtefato } from "./ferramentas-artefato.ts";
import type { ContratoFerramentasAviso } from "./ferramentas-aviso.ts";
import type { ContratoFerramentasBarra } from "./ferramentas-barra.ts";
import type { ContratoFerramentasCanvas } from "./ferramentas-canvas.ts";
import type { ContratoFerramentasComputadores } from "./ferramentas-computadores.ts";
import type { ContratoFerramentasConta } from "./ferramentas-conta.ts";
import type { ContratoFerramentasConversas } from "./ferramentas-conversas.ts";
import type { ContratoFerramentasCredencial } from "./ferramentas-credencial.ts";
import type { ContratoFerramentasCriarBots } from "./ferramentas-criar-bots.ts";
import type { ContratoFerramentasDecisoes } from "./ferramentas-decisoes.ts";
import type { ContratoFerramentasDoNod } from "./ferramentas-do-nod.ts";
import type { ContratoFerramentasFrente } from "./ferramentas-frente.ts";
import type { ContratoFerramentasLigacao } from "./ferramentas-ligacao.ts";
import type { ContratoFerramentasMaquinas } from "./ferramentas-maquinas.ts";
import type { ContratoFerramentasNaoLidos } from "./ferramentas-nao-lidos.ts";
import type { ArgsAtualizarPerfil, ArgsVerColegas, ResultadoAtualizarPerfil, ResultadoVerColegas } from "./ferramentas-perfil.ts";
import type { ContratoFerramentasQuadro } from "./ferramentas-quadro.ts";
import type { ContratoFerramentasResponderPedido } from "./ferramentas-responder-pedido.ts";
import type {
  ArgsAtualizarRotina,
  ArgsCriarRotina,
  ArgsExcluirRotina,
  ArgsExecutarRotina,
  ArgsListarRotinas,
  ArgsPausarRotina,
  ArgsReativarRotina,
  ArgsVerAgenda,
  ResultadoAlternarRotina,
  ResultadoCriarRotina,
  ResultadoListarRotinas,
  ResultadoPropostaRotina,
  ResultadoVerAgenda,
} from "./ferramentas-rotina.ts";
import type { ContratoFerramentasTimes } from "./ferramentas-times.ts";
import type { ContratoFerramentasTrabalho } from "./ferramentas-trabalho.ts";
import type { MotivoPasse, MotivoSemNovidade } from "./motivos.ts";
import type { ArgsPedirAPessoa } from "./pedido.ts";

export type ArgsLembrar = { tipo: "preferencia" | "fato" | "resumo"; texto: string };
export type ArgsPedirAcesso = { conector: string; capacidades: string[]; nivel: "leitura" | "escrita"; nao_pedido: string[]; para?: string; para_bot?: string };
export type ItemPedidoAprovacao = {
  texto: string;
  destino: { conector: string; ferramenta: string; argumentos: Record<string, unknown> };
  origem_conector?: string;
};
export type ArgsPedirAprovacao = { resumo: string; itens: ItemPedidoAprovacao[] };
export type ArgsPassar = { motivo: MotivoPasse };
export type ArgsSemNovidade = { motivo: MotivoSemNovidade };
export type ArgsEncaminhar = { para_agente: string; motivo: string };
export type ArgsPedirABot = { agente: string; pedido: string; contexto?: string; tarefa?: string };

export type ResultadoLembrar = { ok: true; id: string } | { ok: false; recusado: string };
export type ResultadoPedirAprovacao =
  | { estado: "decidida"; itens: { idx: number; desfecho: string }[] }
  | { estado: "pendente"; decisao_id: string; instrucao: "encerre o turno; a decisão retoma depois" }
  | { estado: "recusada"; erros: string[]; instrucao: "corrija os argumentos e chame pedir_aprovacao de novo" | "não peça de novo; encerre o turno" | "use o gateway do computador; respeite o modo vigente e a confirmação solicitada" | "não peça de novo: diga à pessoa o que ficou de fora e por quê" };
export type ResultadoPedirAPessoa = { estado: "pendente"; decisao_id: string; instrucao: "encerre o turno; a resposta retoma depois" };
export type ResultadoOk = { ok: true };
export type ResultadoPedirABot = { ok: true; tarefa_id: string; instrucao: string; livres: { id: string; nome: string }[] } | { ok: false; erro: "espera_circular" | "ja_pedido" | "experimento_desligado" | "sem_quadro" | "tarefa_invalida" | "colega_fora_do_quadro" | "colega_nao_acionado"; instrucao: string };

import type { ContratoFerramentasCartoes } from "./ferramentas-cartoes.ts";

export type ContratoFerramentaNod = ContratoFerramentasCartoes & ContratoFerramentasArtefato & ContratoFerramentasLigacao & ContratoFerramentasTrabalho & ContratoFerramentasFrente & ContratoFerramentasDoNod & ContratoFerramentasCriarBots & ContratoFerramentasResponderPedido & ContratoFerramentasCredencial & ContratoFerramentasAviso & ContratoFerramentasBarra & ContratoFerramentasConta & ContratoFerramentasConversas & ContratoFerramentasQuadro & ContratoFerramentasApps & ContratoFerramentasNaoLidos & ContratoFerramentasTimes & ContratoFerramentasAcessos & ContratoFerramentasCanvas & ContratoFerramentasMaquinas & ContratoFerramentasComputadores & ContratoFerramentasDecisoes & {
  lembrar: { args: ArgsLembrar; resultado: ResultadoLembrar };
  atualizar_perfil: { args: ArgsAtualizarPerfil; resultado: ResultadoAtualizarPerfil };
  pedir_acesso: { args: ArgsPedirAcesso; resultado: ResultadoPedirAcesso };
  criar_rotina: { args: ArgsCriarRotina; resultado: ResultadoCriarRotina };
  listar_rotinas: { args: ArgsListarRotinas; resultado: ResultadoListarRotinas };
  ver_agenda: { args: ArgsVerAgenda; resultado: ResultadoVerAgenda };
  pausar_rotina: { args: ArgsPausarRotina; resultado: ResultadoAlternarRotina };
  reativar_rotina: { args: ArgsReativarRotina; resultado: ResultadoAlternarRotina };
  atualizar_rotina: { args: ArgsAtualizarRotina; resultado: ResultadoPropostaRotina };
  excluir_rotina: { args: ArgsExcluirRotina; resultado: ResultadoPropostaRotina };
  executar_rotina: { args: ArgsExecutarRotina; resultado: ResultadoPropostaRotina };
  pedir_aprovacao: { args: ArgsPedirAprovacao; resultado: ResultadoPedirAprovacao };
  pedir_a_pessoa: { args: ArgsPedirAPessoa; resultado: ResultadoPedirAPessoa };
  passar: { args: ArgsPassar; resultado: ResultadoOk };
  encaminhar: { args: ArgsEncaminhar; resultado: ResultadoOk };
  sem_novidade: { args: ArgsSemNovidade; resultado: ResultadoOk };
  pedir_a_bot: { args: ArgsPedirABot; resultado: ResultadoPedirABot };
  ver_colegas: { args: ArgsVerColegas; resultado: ResultadoVerColegas };
};
