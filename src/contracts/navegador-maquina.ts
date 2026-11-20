/**
 * O navegador do bot na máquina da pessoa (ADR-190, decisão 5; ADR-021, a máquina puxa): o que o servidor e a máquina
 * (o app do Mac ou o motor do Linux) trocam. Só tipos e `as const`.
 *
 * O servidor põe comandos numa fila por máquina; a máquina os leva no long-poll `POST /api/maquina/navegador/puxar` e
 * responde em `POST /api/maquina/navegador/resultado`. Cada comando é UMA chamada do `MotorNavegador` da máquina (o
 * mesmo agent-browser que roda no servidor), ou o pedido de abrir a vista ao vivo (`assistir`): a máquina disca de volta
 * para `/api/maquina/navegador/vivo/:agenteId?t=<token>` com o token de uso único que veio no comando, e a vista para
 * quando um dos lados fecha esse WebSocket.
 */

/** Por que um comando do navegador falhou (o mesmo motivo do motor local, `FalhaNavegador`). */
export const MOTIVOS_FALHA_NAVEGADOR = ["alvo_invalido", "tempo_esgotado", "acao_falhou", "indisponivel"] as const;
export type MotivoFalhaNavegador = (typeof MOTIVOS_FALHA_NAVEGADOR)[number];

/**
 * As operações do motor que a máquina executa (os métodos de `MotorNavegador`, menos `portaDoStream`: a porta do stream é
 * da máquina e só ela a usa, pela vista ao vivo).
 */
export const OPERACOES_MOTOR_NAVEGADOR = [
  "abrir", "ler", "clicar", "preencher", "digitar", "tecla", "rolar", "esperar", "print", "texto", "obter", "estilos",
  "selecionar", "marcar", "passarMouse", "arrastar", "mouse", "historico", "abas", "abaNova", "abaTrocar", "abaFechar",
  "quadro", "dialogo", "baixar", "enviarArquivo", "pdf", "procurar", "avaliar", "focado", "descreverElemento", "url", "fechar",
] as const;
export type OperacaoMotorNavegador = (typeof OPERACOES_MOTOR_NAVEGADOR)[number];

/** O que vale para todo comando: o id (a resposta volta com ele), o bot (a sessão do agent-browser) e até quando vale. */
type BaseComando = { id: string; agenteId: string; prazoEm: number };

export type ComandoNavegadorMaquina =
  | (BaseComando & { tipo: "motor"; operacao: OperacaoMotorNavegador; args: readonly unknown[] })
  /** Abrir a vista ao vivo: a máquina liga o stream local do Chrome do bot e disca para o servidor com `token`. */
  | (BaseComando & { tipo: "assistir"; token: string });

export type ResultadoComandoNavegador =
  | { id: string; ok: true; valor?: unknown }
  | { id: string; ok: false; motivo: MotivoFalhaNavegador; detalhe: string };

/**
 * O WebSocket da vista vinda da máquina (`/api/maquina/navegador/vivo/:agenteId?t=`), JSON nos dois sentidos.
 * Máquina → servidor: as mensagens do stream local do agent-browser como vieram (`frame`, `tabs`, `status`; a máquina
 * nunca repassa `command`, `result` nem `console`) e a resposta de um relay (`{t:"relay", id, ok}`).
 * Servidor → máquina: a entrada da pessoa já traduzida (`{t:"entrada", mensagem}`, para o stream local) ou um comando do
 * relay (`{t:"relay", id, comando}`, o `POST /api/command` do daemon).
 */
export type MensagemAMaquinaNavegador =
  | { t: "entrada"; mensagem: Readonly<Record<string, unknown>> }
  | { t: "relay"; id: number; comando: Readonly<Record<string, unknown>> };
export type RespostaRelayNavegador = { t: "relay"; id: number; ok: boolean };

/** Códigos de fechamento do WebSocket da máquina (4xxx da aplicação, como os da tela do computador). */
export const FECHAMENTOS_NAVEGADOR_MAQUINA = { recusado: 4403, trocou: 4409 } as const;
