import type { AnexoMeta } from "./anexo.ts";
import type { ConversaDto } from "./api.ts";
import type { Mensagem } from "./mensagem.ts";
import type { EpochMs } from "./ids.ts";

/**
 * Estado vivo por bot (definido em 2026-11-12): a projeção que o servidor mantém de cada bot da pessoa, a partir dos frames
 * do motor (turno despachado, ferramenta, texto, subagentes, fim do turno) e das decisões abertas. Sai num frame próprio
 * (`agente.estado`, um bot por frame, numerado como os outros) e num retrato completo ao conectar (`agentes.estado`, sem
 * `id:`, como o ping). Só tipos: a regra de projeção é do domínio (src/domain/estado-vivo.ts) e a de rótulo, da web.
 */

export type TipoAtividade = "thinking" | "ferramenta";
export type MotivoAguardando = "aprovacao" | "pergunta" | "segredo";
export type ResultadoTurno = "success" | "error" | "cancelled";

/**
 * Por que o turno falhou, em código (nunca texto do CLI). `limite_uso`: o plano da IA bateu o limite; `taxa`: a API
 * barrou por taxa; `timeout`: prazo ou silêncio; `bloqueio`: negado por regra/permissão/sem IA; `computador_atualizando`:
 * o computador do bot estava atualizando ou fora do ar; `outra`: o resto.
 */
export type FalhaDoTurno = "limite_uso" | "taxa" | "timeout" | "bloqueio" | "computador_atualizando" | "outra";

export type AtividadeViva = {
  tipo: TipoAtividade;
  /** Nome cru da ferramenta (`Bash`, `mcp__nod__pedir_aprovacao`); null no thinking. */
  ferramenta: string | null;
  /** O rótulo curto já pronto ("Rodando no terminal"); null no thinking. */
  detalhe: string | null;
};

export type EstadoVivoBot = {
  agenteId: string;
  /** Há um turno despachado deste bot (não conta o que só está na fila: não existe `na_fila` aqui). */
  rodando: boolean;
  /** O modelo está escrevendo a resposta agora (do primeiro text_delta ao fim do bloco). Só com `rodando`. */
  compondo: boolean;
  /** O que o turno faz agora; null = começou e ainda não disse nada. Só com `rodando`. */
  atividade: AtividadeViva | null;
  /** A decisão aberta mais antiga deste bot esperando a pessoa; null = nenhuma. */
  aguardando: { motivo: MotivoAguardando; desde: EpochMs } | null;
  subagentes_rodando: number;
  ultimo_desfecho: { resultado: ResultadoTurno; em: EpochMs; falha?: FalhaDoTurno } | null;
  /**
   * Até quando este retrato vale sem novidade: o prazo da decisão aberta, quando há; senão null (vale até o próximo
   * frame). A web não precisa adivinhar: `ultimo_desfecho` velho já não pinta "terminou/falhou" (a janela é de 8 s).
   */
  vence_em: EpochMs | null;
  /** O turno vivo (rodando) ou o último que fechou; ajuda a web a casar com a conversa. */
  turnoId: string | null;
  conversaId: string | null;
  /** Hora da última mudança (relógio do servidor). */
  em: EpochMs;
};

/** Dados do frame `agente.estado`: um bot, o estado inteiro (substitui o anterior). */
export type DadosFrameEstadoVivo = { agenteId: string; estado: EstadoVivoBot };

/** Dados do evento `agentes.estado` mandado ao conectar o SSE (sem `id:`): todos os bots com estado conhecido. */
export type RetratoEstadoVivo = { agentes: EstadoVivoBot[]; em: EpochMs };

/** Nome do evento SSE do retrato (não é TipoFrame: não entra no seq nem no replay). */
export const EVENTO_RETRATO_ESTADO_VIVO = "agentes.estado" as const;

/** Janela em que o último desfecho ainda pinta "terminou"/"falhou" (definido em 2026-11-12, pedido do card B). */
export const JANELA_DESFECHO_MS = 8_000;

/**
 * Fim do turno nos frames `turno.encerrado`/`turno.interrompido` (aditivo): o desfecho, a hora em que assentou, o
 * `idEnvio` da última fala da pessoa que o turno leu (o cliente casa com o balão que mandou) e a falha classificada.
 */
export type FimDoTurnoNoFrame = { desfecho: ResultadoTurno; settled_at: EpochMs; id_envio: string | null; falha?: FalhaDoTurno };

/**
 * Sincronização por cursor (definido em 2026-11-12): cada mensagem tem `seq` (ordem de criação) e `updated_seq` (sobe em
 * edição, reação ou cartão decidido), monotônicos na conversa. A conversa tem `geracao`, que sobe quando ela é zerada
 * (mensagens apagadas). `GET /conversas/:id/mensagens?depois_de=<updated_seq>&geracao=<g>` devolve só o que mudou.
 */
export type CursorDaConversa = { geracao: number; updated_seq: number };

/** O GET de sempre com o cursor lido antes da página (o ponto de partida do `?depois_de=`); ausente = servidor antigo. */
export type ConversaComCursor = ConversaDto & { cursor?: CursorDaConversa };

export type MensagemComCursor = Mensagem & { seq: number; updated_seq: number };

/** Resposta do GET com `depois_de`. `cursor_velho`: a geração mudou ou há mais de 500 mudanças — releia a página mais nova. */
export type RespostaMensagensDesde =
  | { cursor_velho: false; cursor: CursorDaConversa; mensagens: MensagemComCursor[] }
  | { cursor_velho: true; cursor: CursorDaConversa };

/** Teto de mudanças por resposta; acima disso o cliente relê a página mais nova (definido em 2026-11-12). */
export const LIMITE_MENSAGENS_DESDE = 500;

/**
 * Cursor do computador de um bot (frame `computador.cursor`, definido em 2026-11-12): efêmero, nunca gravado, só para quem
 * está com a tela daquele bot aberta. `tipo`: mover, clicar, arrastar, rolar, digitar. `x`/`y` em pixels da tela do
 * computador; `botao` e `contagem` só no clique.
 */
export type TipoCursor = "mover" | "clicar" | "arrastar" | "rolar" | "digitar";
export type DadosFrameCursor = { bot: string; tipo: TipoCursor; x: number; y: number; botao: "esquerdo" | "direito" | "meio" | null; contagem: number; em: EpochMs };

/** `GET /conversas/:id/envios/:idEnvio` (definido em 2026-11-12): o destino da fala mandada com aquele `idEnvio`. */
export type StatusDoEnvio = "aceito" | "rejeitado" | "pendente" | "nao_encontrado";
export type RespostaStatusDoEnvio = { estado: StatusDoEnvio; mensagemId: string | null };

/**
 * C1 (definido em 2026-11-12): fala com imagem no meio do turno. O app cujo driver escreve anexo na sessão viva manda
 * `aceitaAnexos` na renovação; só então o servidor deixa passar a fala com anexo (antes ela cortava a fila e esperava o
 * próximo turno) e devolve os metadados em `mensagensAnexos` (id da fala → anexos). O driver baixa os bytes no
 * `GET interno/anexos/:id` com o token do turno vivo, que aceita o anexo de fala pendente da mesma conversa e bot.
 */
export type PedidoRenovarAnexos = { aceitaAnexos?: boolean };
export type RespostaRenovarAnexos = { mensagensAnexos?: Record<string, AnexoMeta[]> };

/**
 * C1: a fala vai ao executor por evento, não pela checagem de 3 s. `aguardarMensagem` (long-poll, até `ms`) volta `true`
 * quando chegou algo para a conversa da pessoa (fala nova, recado do quadro, trabalho mudou) e o laço renova na hora;
 * `false` = venceu sem novidade. A batida do lease (30 s) segue como rede. HTTP: `POST /api/maquina/aguardar` {turnoId, ms} → {chegou}.
 */
export type PonteAguardaMensagem = { aguardarMensagem?(turnoId: string, ms: number): Promise<boolean> };
/** Teto do long-poll da mensagem (o mesmo do pull da ponte, ADR-021). */
export const AGUARDAR_MENSAGEM_MS = 20_000;
