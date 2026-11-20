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
export const MOTIVOS_FALHA_NAVEGADOR = ["alvo_invalido", "tempo_esgotado", "acao_falhou", "indisponivel", "recusado"] as const;
export type MotivoFalhaNavegador = (typeof MOTIVOS_FALHA_NAVEGADOR)[number];

/**
 * As operações do motor que a máquina executa (os métodos de `MotorNavegador`, menos `portaDoStream`: a porta do stream é
 * da máquina e só ela a usa, pela vista ao vivo).
 */
export const OPERACOES_MOTOR_NAVEGADOR = [
  "abrir", "ler", "clicar", "preencher", "digitar", "tecla", "rolar", "esperar", "print", "texto", "obter", "estilos",
  "selecionar", "marcar", "passarMouse", "arrastar", "mouse", "historico", "abas", "abaNova", "abaTrocar", "abaFechar",
  "quadro", "dialogo", "baixar", "enviarArquivo", "pdf", "procurar", "avaliar", "focado", "descreverElemento", "url", "fechar",
  "camposDeLogin", "inserirTexto", "definirCookies", "tamanho",
] as const;
export type OperacaoMotorNavegador = (typeof OPERACOES_MOTOR_NAVEGADOR)[number];

/** O que vale para todo comando: o id (a resposta volta com ele), o bot (a sessão do agent-browser) e até quando vale. */
type BaseComando = { id: string; agenteId: string; prazoEm: number };

/**
 * Um cookie como o agent-browser o aceita (`cookies_set`, medido em 2026-11-20): `expires` em segundos Unix (-1 = de
 * sessão), `sameSite` do Chrome. Só cookies do site pedido viajam (`cookieServeAoHost`).
 */
export type CookieNavegador = { name: string; value: string; domain: string; path: string; expires: number; secure: boolean; httpOnly: boolean; sameSite: "Strict" | "Lax" | "None" };

/** O cofre da pessoa no app do Mac (ADR-177, ADR-190 decisão 6): 1Password (`op`) e Bitwarden (`bw`). */
export const FONTES_DO_MAC = ["1password", "bitwarden"] as const;
export type FonteDoMac = (typeof FONTES_DO_MAC)[number];

/**
 * O que o cofre do Mac faz por um comando da fila (ADR-190, L):
 * - `listar`: os itens de login que casam com o host, SEM segredo (referência e rótulo);
 * - `preencher`: (`ref` vazio = o primeiro item que casa com `host`, quando a lista não veio a tempo) lê o segredo e preenche no navegador do bot DESTA máquina (o segredo não sai do Mac);
 * - `ler`: lê o segredo e o devolve ao servidor pela ponte (HTTPS + chave da máquina), quando o navegador roda em outro
 *   lugar; o servidor preenche e esquece;
 * - `guardar`: grava no 1Password ou no Bitwarden o login que a pessoa digitou (L5).
 */
export type PedidoCofreDoMac =
  | { operacao: "listar"; host: string }
  | { operacao: "preencher"; fonte: FonteDoMac; ref: string; host: string }
  | { operacao: "ler"; fonte: FonteDoMac; ref: string; host: string }
  | { operacao: "guardar"; fonte: FonteDoMac; site: string; usuario: string; senha: string };

export type ComandoNavegadorMaquina =
  | (BaseComando & { tipo: "motor"; operacao: OperacaoMotorNavegador; args: readonly unknown[] })
  /** Abrir a vista ao vivo: a máquina liga o stream local do Chrome do bot e disca para o servidor com `token`. */
  | (BaseComando & { tipo: "assistir"; token: string })
  | (BaseComando & { tipo: "cofre"; pedido: PedidoCofreDoMac })
  /**
   * L1 "Trazer do meu Chrome": os cookies DAQUELE site no Chrome da pessoa (o macOS pergunta se o nod pode usar o
   * Keychain). `aplicar`: o navegador do bot roda nesta máquina e os cookies vão direto para ele (não saem do Mac).
   */
  | (BaseComando & { tipo: "chrome"; host: string; aplicar: boolean })
  /** A1 (ADR-177): o Touch ID do Mac antes de pagar. `motivo` aparece no diálogo do sistema. */
  | (BaseComando & { tipo: "touch_id"; motivo: string });

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
