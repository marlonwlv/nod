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

/** De onde vem o login (L1): o cofre do nod (cifrado no servidor), o 1Password ou o Bitwarden da pessoa (no app do Mac). */
export const FONTES_COFRE = ["nod", "1password", "bitwarden"] as const;
export type FonteCofre = (typeof FONTES_COFRE)[number];

/**
 * Um item de cofre que casa com o site (L1), sem segredo: `ref` é o id do login no cofre do nod, a referência `op://…`
 * do 1Password ou o id do item do Bitwarden. `rotulo` = "Itaú · marlon@…" (usuário mascarado). `disponivel: false`
 * (cinza) traz o motivo: "precisa do seu Mac ligado" ou "destravar no seu Mac".
 */
export type OpcaoLogin = { fonte: FonteCofre; ref: string; rotulo: string; disponivel: boolean; motivoIndisponivel?: string };

/**
 * Em que pé está o login (L1, L2, L5): `escolher` (o cartão com as opções), `confirme_no_mac` (a pessoa escolheu o
 * 1Password, o Bitwarden ou o Chrome e o Mac pede o Touch ID ou o Keychain), `eu_mesmo` (a pessoa está entrando com as
 * próprias mãos; a pílula diz "A Ada espera você entrar | Pronto, pode seguir").
 */
export const ETAPAS_LOGIN = ["escolher", "confirme_no_mac", "eu_mesmo"] as const;
export type EtapaLogin = (typeof ETAPAS_LOGIN)[number];

/** A caixa do alvo na página (coordenadas do viewport), para a web desenhar o realce fora da imagem (A1). */
export type CaixaNavegador = { x: number; y: number; w: number; h: number };

/**
 * Pedido aberto para a pessoa: login (L), ajuda (captcha; `codigo` = a página pede um código de uso único, L4),
 * aprovação no ponto sem volta (A1) ou o combinado de antemão (A2). Todos apontam para UMA decisão: respondida num
 * lugar (pílula, conversa, celular), some dos outros.
 */
export type PedidoDaVistaNavegador =
  | {
    tipo: "login"; decisaoId: string; site: string; motivo: string;
    /** Os itens que casam com o site, na ordem do cartão (o primeiro disponível é o botão preto). */
    opcoes: readonly OpcaoLogin[];
    /** "Trazer do meu Chrome" só existe com o app do Mac conectado. */
    podeTrazerDoChrome: boolean;
    etapa: EtapaLogin;
    /** A última tentativa falhou (frase pronta, sem dado da pessoa). */
    erro: string | null;
  }
  | { tipo: "ajuda"; decisaoId: string; motivo: string; codigo: boolean }
  | {
    tipo: "aprovacao"; decisaoId: string; pergunta: string; botao: string;
    classe: "pagar" | "apagar" | "enviar";
    /** Pagar pede o Touch ID no Mac (ADR-177). false com `avisoTouchId`: o Mac está desligado e vale o botão. */
    touchId: boolean;
    avisoTouchId: string | null;
    caixa: CaixaNavegador | null;
    /** A3: só envio com destino visto na página; dinheiro nunca leva. `padrao` true = a caixa vem marcada. */
    lembrar: { padrao: true; texto: string } | null;
    /** A3: o que vai ser enviado (o último texto que o bot preencheu nesta página), para a pessoa ler antes. Só em envio. */
    citacao?: string | null;
  }
  | { tipo: "combinar"; decisaoId: string; titulo: string; texto: string; sim: string; nao: string; touchId: boolean };

/**
 * L5: a pessoa entrou digitando ("Entrar eu mesmo") e a página mudou. A linha discreta "Você entrou no Bradesco digitando.
 * Guardar no cofre? Guardar | Não" com os cofres possíveis (o 1Password e o Bitwarden só com o Mac ligado). O que ela
 * digitou fica só em memória do servidor, cifrado, por até 5 min (`ate`).
 */
export type OfertaGuardarLogin = { site: string; usuario: string; destinos: readonly FonteCofre[]; ate: number };

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
  /** L5: guardar no cofre o login que a pessoa digitou. */
  ofertaGuardar: OfertaGuardarLogin | null;
  /** Quando o bot terminou (D3, 5) ou parou de mexer (pausa em 10 min). */
  atividadeEm: number;
  erro: { causa: string; em: number } | null;
  /** Tamanho da tela do Chrome (a vista mantém a proporção). */
  viewport: { w: number; h: number };
  /**
   * Controle assumido à mão e parado (2026-11-22): quando ele volta sozinho ao bot. Aparece no último minuto; a pílula diz
   * "Volta para a Ada em 1 min". null/ausente = não está para voltar.
   */
  devolveEm?: number | null;
  /**
   * 2026-11-22: o aparelho da pessoa com o app do nod (o Mac ou o PC), para os textos da confirmação e do "ligado"
   * (textosDoAparelho). Ausente = o Mac (a vista de antes).
   */
  aparelho?: "mac" | "pc";
  /** 2026-11-23: o Google recusou o login aqui; `site` = o host de origem, para o "Trazer do meu Chrome". */
  googleRecusou?: { site: string } | null;
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

/** Entrada da pessoa no controle, web → servidor (coordenadas já na escala do viewport); `tamanho` vale assistindo. */
export type EntradaNavegador =
  | { t: "mouse"; evento: "mousePressed" | "mouseReleased" | "mouseMoved" | "mouseWheel"; x: number; y: number; botao?: "left" | "right" | "middle"; cliques?: number; dx?: number; dy?: number; modificadores?: number }
  | { t: "tecla"; evento: "keyDown" | "keyUp" | "char"; tecla?: string; codigo?: string; texto?: string; modificadores?: number }
  /** O tamanho da área da vista em CSS px (emenda de 2026-11-20 da ADR-190, item 4): o Chrome do bot acompanha quem assiste. */
  | { t: "tamanho"; w: number; h: number };

/** GET /agentes/:id/navegador: a vista e se o navegador roda neste servidor (sem motor, a tela diz "indisponível"). */
export type RespostaNavegador = { vista: VistaNavegador; disponivel: boolean };

/** POST /agentes/:id/navegador/ensinar: a vista e, ao salvar, a tarefa guardada. */
export type RespostaEnsinar = { ok: true; vista: VistaNavegador; tarefa?: TarefaEnsinada };

/** POST /agentes/:id/navegador {operacao}: o que a pessoa faz com o navegador do bot ("voltar": a barra no controle, D2 B). */
export const OPERACOES_NAVEGADOR = ["assumir", "devolver", "resolver", "ligar", "encerrar", "retomar", "recarregar", "voltar"] as const;
export type OperacaoNavegador = (typeof OPERACOES_NAVEGADOR)[number];

/** POST /agentes/:id/navegador/ensinar {operacao, nome?} (T). */
export const OPERACOES_ENSINAR = ["comecar", "descartar", "salvar", "desfazer_descarte"] as const;
export type OperacaoEnsinar = (typeof OPERACOES_ENSINAR)[number];

/** Onde o navegador mora (quadros M e N): moram em ./navegador-lugar-do-bot.ts (o limite de 200 linhas por contrato). */
export type { EscolhaLugarNavegador, MudancaLugarNavegador, PayloadNavegadorLugar, PayloadNavegadorPergunta, RespostaLugarNavegador, RespostaMacDesligado } from "./navegador-lugar-do-bot.ts";

/** Habilidade aprendida com "Ensinar uma tarefa". */
export type TarefaEnsinada = { id: string; nome: string; passos: readonly string[]; criadaEm: number };

/**
 * POST /agentes/:id/navegador/login (L1): o que a pessoa escolheu no cartão de login. O segredo nunca passa por aqui nem
 * pelo chat: só a fonte e a referência do item.
 */
export type EscolhaLoginNavegador = { fonte: FonteCofre; ref: string } | "eu_mesmo" | "chrome";

/** A resposta do POST /navegador/login: a vista e, quando o Mac pede a confirmação, a frase do celular (L2). */
export type RespostaLoginNavegador = { ok: true; vista: VistaNavegador; aviso: string | null };
export type RespostaTrazerDoChrome = { ok: true; vista: VistaNavegador; trazidos: number; aviso: string }; // trazidos 0 = não trouxe

/** GET /cofre/logins: o cofre do nod na tela, sem a senha (só site, usuário mascarado e data). */
export type LoginDoCofreNaTela = { id: string; site: string; usuario: string; criadoEm: number };
