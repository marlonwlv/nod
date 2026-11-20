/**
 * O navegador do bot (ADR-190): o que a web e o servidor trocam sobre ele. Só tipos e `as const`.
 */

/** Onde o Chrome do bot roda. "mac" = o computador da pessoa (app do nod); "nod" = o servidor; "maquina" = uma máquina
 * sempre ligada da pessoa (Linux, motor), pelo nome que ela deu. */
export type LugarNavegador =
  | { tipo: "mac"; nome: string }
  | { tipo: "nod" }
  | { tipo: "maquina"; maquinaId: string; nome: string };

/** O estado da vista (D3): cada um tem uma saída na tela. */
export const ESTADOS_NAVEGADOR = ["desligado", "ligando", "conectando", "ao_vivo", "rede_fraca", "terminou", "pausa", "erro"] as const;
export type EstadoNavegador = (typeof ESTADOS_NAVEGADOR)[number];

/** Quem mexe (D4): o bot, a pessoa, ou o bot esperando a pessoa (login, captcha, aprovação). */
export const CONTROLES_NAVEGADOR = ["bot", "soltando", "pessoa", "precisa_de_voce"] as const;
export type ControleNavegador = (typeof CONTROLES_NAVEGADOR)[number];

export type AbaNavegador = {
  id: string;
  titulo: string;
  url: string;
  ativa: boolean;
  carregando: boolean;
  /** Página sem https ("Não seguro"). */
  inseguro: boolean;
};

/** Os avisos do site (D2, D): uma faixa fina entre o cabeçalho e a vista, um por vez. */
export const TIPOS_AVISO_NAVEGADOR = ["download", "pergunta", "permissao", "precisa_de_voce", "janela_nova"] as const;
export type TipoAvisoNavegador = (typeof TIPOS_AVISO_NAVEGADOR)[number];
export type AvisoNavegador = { tipo: TipoAvisoNavegador; texto: string; acao: string | null; em: number };

/** O passo que o bot está dando (D2, C): desenha o anel, o cursor com o nome e a ondinha. Coordenadas da página. */
export type PassoNavegador = {
  tipo: "mirar" | "clicar" | "digitar" | "rolar" | "esperar" | "ler";
  frase: string;
  caixa: { x: number; y: number; w: number; h: number } | null;
  em: number;
};

/** Pedido aberto para a pessoa: login (L), ajuda (captcha, SMS) ou aprovação no ponto sem volta (A1). */
export type PedidoDaVistaNavegador =
  | { tipo: "login"; decisaoId: string; site: string; motivo: string }
  | { tipo: "ajuda"; decisaoId: string; motivo: string }
  | { tipo: "aprovacao"; decisaoId: string; pergunta: string; botao: string; touchId: boolean };

/** A gravação de "Ensinar uma tarefa" (T). `parou`: bateu no teto de passos ou de tempo e não grava mais. */
export type GravacaoNavegador = { desde: number; passos: readonly string[]; parou: "passos" | "tempo" | null };

/** A gravação que a devolução ao bot descartou: a web oferece "Desfazer" até `ate` (10 s). */
export type DescarteNavegador = { passos: number; ate: number };

export type VistaNavegador = {
  agenteId: string;
  estado: EstadoNavegador;
  controle: ControleNavegador;
  lugar: LugarNavegador;
  abas: readonly AbaNavegador[];
  aviso: AvisoNavegador | null;
  passo: PassoNavegador | null;
  pedido: PedidoDaVistaNavegador | null;
  gravacao: GravacaoNavegador | null;
  descarte: DescarteNavegador | null;
  /** Segredo na página (L3): a vista some e a leitura do bot trava até a página mudar. */
  segredoNaPagina: boolean;
  /** Quando o bot terminou (D3, 5) ou parou de mexer (pausa em 10 min). */
  atividadeEm: number;
  erro: { causa: string; em: number } | null;
  /** Tamanho da tela do Chrome (a vista mantém a proporção). */
  viewport: { w: number; h: number };
};

/**
 * Quadros do canal ao vivo, servidor → web (JSON por WebSocket, `/api/t/:tenant/agentes/:id/navegador/vivo`).
 * `quadro`: o JPEG da tela (base64), no máximo ~10 por segundo; some enquanto `vista.segredoNaPagina`. `vista`: a vista
 * inteira, a cada mudança e como resposta a uma entrada recusada (a pessoa não está no controle). `fim`: o servidor vai
 * fechar este canal (`motivo` em MOTIVOS_FIM_NAVEGADOR).
 */
export type QuadroAoVivoNavegador =
  | { t: "quadro"; seq: number; jpeg: string; w: number; h: number }
  | { t: "vista"; vista: VistaNavegador }
  | { t: "fim"; motivo: string };

/** Por que o canal ao vivo fecha (o `motivo` do `fim`). */
export const MOTIVOS_FIM_NAVEGADOR = ["outra_janela", "nao_permitido", "servidor_desligando"] as const;
export type MotivoFimNavegador = (typeof MOTIVOS_FIM_NAVEGADOR)[number];

/** Códigos de fechamento do canal ao vivo (os 4xxx são da aplicação; os mesmos da tela do computador, ADR-138). */
export const FECHAMENTOS_NAVEGADOR_VIVO = { recusado: 4403, trocou: 4409, sessao: 4401 } as const;

/** Entrada da pessoa no controle, web → servidor (coordenadas já na escala do viewport). */
export type EntradaNavegador =
  | { t: "mouse"; evento: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel"; x: number; y: number; botao?: "left" | "right" | "middle"; cliques?: number; dx?: number; dy?: number; modificadores?: number }
  | { t: "tecla"; evento: "keyDown" | "keyUp" | "char"; tecla?: string; codigo?: string; texto?: string; modificadores?: number };

/** GET /agentes/:id/navegador: a vista e se o navegador roda neste servidor (sem motor, a tela diz "indisponível"). */
export type RespostaNavegador = { vista: VistaNavegador; disponivel: boolean };

/** POST /agentes/:id/navegador/ensinar: a vista e, ao salvar, a tarefa guardada. */
export type RespostaEnsinar = { ok: true; vista: VistaNavegador; tarefa?: TarefaEnsinada };

/** POST /agentes/:id/navegador {operacao}: o que a pessoa faz com o navegador do bot. */
export const OPERACOES_NAVEGADOR = ["assumir", "devolver", "resolver", "ligar", "encerrar", "retomar", "recarregar"] as const;
export type OperacaoNavegador = (typeof OPERACOES_NAVEGADOR)[number];

/** POST /agentes/:id/navegador/ensinar {operacao, nome?} (T). */
export const OPERACOES_ENSINAR = ["comecar", "descartar", "salvar", "desfazer_descarte"] as const;
export type OperacaoEnsinar = (typeof OPERACOES_ENSINAR)[number];

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

/** Habilidade aprendida com "Ensinar uma tarefa". */
export type TarefaEnsinada = { id: string; nome: string; passos: readonly string[]; criadaEm: number };
