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
};

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
