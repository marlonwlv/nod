/**
 * O navegador do bot (ADR-190), quadros M e N: onde ele mora com o Mac desligado. Saiu de ./navegador-do-bot.ts (que os
 * reexporta) quando ele passou do limite de 200 linhas por contrato. Só tipos.
 */

/** Escolha da pessoa sobre onde o bot continua com o Mac desligado (N). `maquinaId` "nod" = volta para o nod. */
export type EscolhaLugarNavegador = { continuaSemMac: boolean; maquinaId: string | null; soNaMaquina: boolean };

/** POST /agentes/:id/navegador/lugar: o que mudar (o resto fica). `maquinaId` null = a automática; "nod" = o servidor. */
export type MudancaLugarNavegador = { continuaSemMac?: boolean; maquinaId?: string | null; soNaMaquina?: boolean };

/**
 * GET /agentes/:id/navegador/lugar (quadros M e N): a pergunta "Continuar com o seu Mac desligado", a lista de máquinas
 * sempre ligadas da pessoa e os textos prontos (o nome do bot no lugar de "A Ada"). `maquinaId` "nod" = escolheu o nod.
 */
export type RespostaLugarNavegador = {
  continuaSemMac: boolean;
  maquinaId: string | null;
  soNaMaquina: boolean;
  maquinas: readonly { id: string; nome: string; ligada: boolean }[];
  /** A máquina sempre ligada onde o computador do bot mora (a escolhida quando há várias), se mora numa. */
  maquinaDoComputador: string | null;
  /** A pessoa tem o app do nod num computador (sem ele, o bot sempre continua fora do Mac). */
  temApp: boolean;
  /** "seu Mac" ou "seu PC". */
  nomeDoAparelho: string;
  /** Onde o navegador roda agora, decidido ("no nod", "na vm-sp", "no seu Mac"), ou null se espera o aparelho. */
  agora: string | null;
  subtitulo: string;
  frasePergunta: { texto: string; lugar: string; resto: string; trocar: boolean };
  /** A pessoa já respondeu "Continuar com o Mac desligado" (M2/J1): o cartão-pergunta vira a linha "Você escolheu…". */
  respondeu: boolean;
  /** O turno que espera o Mac ligar ("Quando o Mac ligar", K1), se há um. */
  retomarTurnoId: string | null;
  /** O servidor roda o navegador do bot em algum lugar (sem isso, a linha do painel não aparece). */
  disponivel?: boolean;
};

/**
 * Os cartões da conversa do bot sobre o Mac desligado (quadros M2/J1 e M3/K1), gravados como linha `sistema` com este
 * payload. `continuar_sem_mac`: "Às 3h seu Mac costuma estar desligado" [Continuar com o Mac desligado] [Só com o Mac
 * ligado] (uma vez por bot, até a resposta). `mac_desligado`: a pessoa pediu algo pela conversa com o Mac desligado —
 * "Seu Mac está desligado" [Fazer agora] [Quando o Mac ligar]; `turnoId` é o pedido que continua. A web desenha o estado
 * de agora a partir de GET /agentes/:id/navegador/lugar (respondido, a linha com Desfazer).
 */
export type PayloadNavegadorPergunta = {
  kind: "navegador_pergunta";
  agenteId: string;
  pergunta: "continuar_sem_mac" | "mac_desligado";
  /** "Às 3h" (a hora da rotina, ou a de agora). */
  hora: string;
  nomeDoAparelho: string;
  turnoId: string | null;
  rotinaId: string | null;
  em: number;
};

/** POST /agentes/:id/navegador/mac-desligado (K1): "Fazer agora" (continua sem o Mac e retoma) ou "Quando o Mac ligar". */
export type RespostaMacDesligado = "agora" | "ao_ligar";

/**
 * A linha da conversa do bot quando o lugar do navegador muda sozinho (N, "Quando algo muda"). `acao` é o botão da linha
 * (Desfazer, "Só na vm-sp, mesmo que atrase"): a web manda `mudar` em POST /agentes/:id/navegador/lugar.
 */
export type PayloadNavegadorLugar = {
  kind: "navegador_lugar";
  agenteId: string;
  aviso: "passou_para_maquina" | "fez_no_nod" | "maquina_saiu";
  maquinaId: string | null;
  nome: string;
  em: number;
  acao: { rotulo: string; mudar: MudancaLugarNavegador } | null;
};
