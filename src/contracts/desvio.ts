/**
 * Lote B das Jornadas da IA ("Mandar uma mensagem", definido em 2026-11-22): os 12 desvios do momento B, pelo número do
 * Paper. O id viaja no payload da linha ou do cartão que a conversa mostra; a regra (reconhecer, recuperar, o teto, a
 * frase) mora numa tabela só, src/domain/desvios-da-conversa.ts.
 */
export const IDS_DESVIO = [
  "sessao_sumiu", // 1
  "login_vencido", // 2
  "limite_bot_fixo", // 3
  "limite", // 4
  "instavel", // 5
  "sem_ia_pronta", // 6
  "computador_fora", // 7
  "sem_acesso", // 8
  "ia_nao_abriu", // 9
  "erro_desconhecido", // 10
  "nod_atualizou", // 11
  "computador_dormiu", // 12
] as const;
export type IdDesvio = (typeof IDS_DESVIO)[number];

/**
 * Os botões que um cartão de desvio pode ter. Todos executam algo que o nod sabe fazer (nunca "tente de novo" que repete
 * o mesmo erro); a web liga cada um à ação do registro (src/domain/acoes).
 * - `entrar_de_novo`: abre o login da conta que venceu (dados: contaId, maquinaId).
 * - `conectar_ia`: abre "Adicionar conta" nas Configurações.
 * - `responder_com_outra_ia`: esta mensagem, uma vez, noutra IA (dados: turnoId, ia); o bot não muda.
 * - `rodar_em_outra_maquina`: esta mensagem, uma vez, noutra máquina (dados: turnoId, maquinaId, maquinaNome).
 * - `cancelar`: tira a mensagem da espera (dados: turnoId).
 * - `ver_erro`: mostra o texto do erro, sem sair da conversa (só tela).
 */
export const ACOES_DO_DESVIO = ["entrar_de_novo", "conectar_ia", "responder_com_outra_ia", "rodar_em_outra_maquina", "reinstalar_e_tentar", "cancelar", "ver_erro"] as const;
export type AcaoDoDesvio = (typeof ACOES_DO_DESVIO)[number];

export type BotaoDoDesvio = { acao: AcaoDoDesvio; rotulo: string; dados?: Readonly<Record<string, string>> };

/**
 * O que a conversa mostra para o desvio:
 * - `linha`: o nod resolveu sozinho (recomeçou, trocou de conta, vai tentar de novo); uma linha discreta, com no máximo
 *   um link ("Entrar de novo", "Rodar em outra máquina").
 * - `cartao`: o nod parou; o motivo e os botões. A mensagem fica guardada (`espera`) quando sai sozinha depois.
 */
export type PayloadDesvio = {
  kind: "desvio";
  desvio: IdDesvio;
  forma: "linha" | "cartao";
  /** O título do cartão (vazio na linha). */
  titulo: string;
  texto: string;
  botoes: BotaoDoDesvio[];
  /** A mensagem espera e sai sozinha (a hora, quando se sabe: o limite volta, a máquina volta). */
  espera?: { ate: number | null };
  /** O ponto âmbar do cartão (Paper, momento B: só o bot preso a uma IA e o computador fora do ar, que esperam algo fora do alcance da pessoa). */
  tom?: "espera" | "parada";
  /** O texto do erro do fornecedor (já redigido, até 400 caracteres), só atrás do "Ver o erro". */
  erro?: string;
};
