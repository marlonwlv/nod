import type { EstadoIa, ResultadoColarCodigo } from "./estado-ia.ts";
import type { CausaDoMac, CausaInventario, CausaSemIa } from "./inventario.ts";
import type { PonteContas } from "./contas-desktop.ts";
import type { PonteMidia } from "./midia-desktop.ts";
/**
 * Ponte da JANELA WEB do app desktop (definido em 2026-09-24, "aviso no Mac"): o que o preload dela (desktop/preload-web.ts)
 * expõe como `window.nodDesktop`. Só tipos e `as const` (EMENDA 26): a web importa com `import type`; o processo
 * principal valida cada argumento (desktop/avisos-mac.ts), porque quem chama é uma página remota.
 *
 * Separada da ponte da tela de conexão (`window.nod`, desktop/preload.ts): aquela entrega `conectar` e
 * a chave da máquina, e a web já usa `window.nod` para inspeção no console.
 */

/** Para onde o aviso ou link `nod://` (NOD-136, sem `agenteId`) leva: conversa, task (NOD-114) ou "Sua vez". */
export type AlvoAviso = { tipo: "conversa"; conversaId: string; agenteId?: string } | { tipo: "trabalho"; trabalhoId: string; agenteId: string; conversaId: string } | { tipo: "sua-vez" } | { tipo: "computador-do-bot"; primeiroUso?: boolean };

/** Um aviso já redigido pela web (web/lib/avisos.ts): o Mac só mostra. `grupo` (NOD-114): o bot, um grupo do macOS por bot. */
export type AvisoDesktop = { titulo: string; corpo: string; alvo: AlvoAviso; grupo?: string };

/** Tema escolhido em Preferências (definido em 2026-10-04, ADR-070); "sistema" segue o macOS. */
export type TemaDesktop = "sistema" | "claro" | "escuro";

/** As preferências do app (userData/preferencias.json) e o que o macOS deixou mostrar. */
export type PreferenciasDesktop = {
  avisos: boolean;
  /** O tema da janela: o processo principal o aplica em nativeTheme, que é o que o prefers-color-scheme da página lê. */
  tema: TemaDesktop;
  /**
   * O aviso toca o som padrão do macOS (definido em 2026-10-07, NOD-196); desligado, ele aparece em silêncio. Local a
   * cada Mac, como o tema; o Foco e os Ajustes do Sistema continuam mandando (o nod nunca força o som).
   */
  som: boolean;
  /** O último aviso falhou ao aparecer: as notificações do nod estão desligadas nos Ajustes do Sistema. */
  bloqueados: boolean;
};

/**
 * O acesso do macOS ao microfone (definido em 2026-10-04, ADR-071): "concedido" pode pedir o microfone; "negado" a
 * pessoa desligou nos Ajustes do Sistema; "restrito" um perfil de gestão do Mac proíbe.
 */
export type EstadoMicrofone = "concedido" | "negado" | "restrito";

/** As IAs que o Mac sabe entrar ou instalar (ADR-077): o id do harness (src/contracts/harness.ts). */
export const IAS_DESKTOP = ["claude-cli", "codex-cli"] as const;
export type IaDesktop = (typeof IAS_DESKTOP)[number];
/** "iniciado": o login (ou a página) abriu no navegador; o app sonda de novo a cada 3 s e reanuncia quando ficar pronto. */
export type ResultadoIaDesktop = { ok: true } | { ok: false; motivo: "nao_instalado" | "falhou" };

/**
 * O teste de verdade de uma IA do Mac (definido em 2026-10-05, emenda da ADR-019/077): um turno de uma frase, pago pela
 * assinatura da pessoa. `resposta` é o que a IA disse (até RESPOSTA_TESTE_IA_MAX caracteres), só quando ficou pronta;
 * `causa` só quando a IA está logada e mesmo assim não serviu. O Mac reanuncia o inventário ao servidor com o veredito.
 */
/** `causa: "sonda_lenta"` (NOD-178): o CLI só demorou; não é veredito da conta, e a tela testa de novo. */
/** `atualizando` (NOD-9) nunca sai de um teste: é o app que atualiza, não um veredito. */
export type TesteDeIa = { ia: IaDesktop; estado: "pronto" | "nao_autenticado" | "ausente"; causa?: CausaSemIa | Exclude<CausaInventario, CausaDoMac | "atualizando">; resposta?: string };
export const RESPOSTA_TESTE_IA_MAX = 200;
/** O nome que entra na pergunta do teste ("Diga oi para {nome}…"): só letras, espaço, ponto e hífen, até este tamanho. */
export const NOME_TESTE_IA_MAX = 40;

/**
 * As IAs do Mac pela tela (definido em 2026-10-09, plano "IAs", PR 1): o estado único de cada uma
 * (src/contracts/estado-ia.ts) e as ações de instalar e entrar DENTRO do app. Tudo devolve o estado novo da IA; o
 * progresso (a linha da instalação, o link e o código do login, o fim do teste) chega por `aoMudar`.
 *  - instalar: `npm install` do pacote oficial na pasta do nod (desktop/instalar-ia.ts); resolve quando termina;
 *  - entrar: abre o login do CLI e resolve logo; o link e o código vêm em `login` pelo `aoMudar`;
 *  - abrirLink: abre no navegador o link do login em curso — só o que o app leu do CLI e conferiu na lista oficial;
 *    a página nunca passa um endereço;
 *  - colarCodigo: o código da página do Claude vai ao stdin do CLI, só com a forma de um código;
 *  - cancelar: encerra o login (e a instalação) em curso;
 *  - verificar: confere agora (login em curso: o status do CLI; senão, uma sonda grátis).
 */
export type PonteIas = {
  estados(): Promise<EstadoIa[]>;
  instalar(ia: IaDesktop): Promise<EstadoIa>;
  entrar(ia: IaDesktop): Promise<EstadoIa>;
  abrirLink(ia: IaDesktop): Promise<boolean>;
  colarCodigo(ia: IaDesktop, codigo: string): Promise<ResultadoColarCodigo>;
  cancelar(ia: IaDesktop): Promise<EstadoIa>;
  verificar(ia: IaDesktop): Promise<EstadoIa>;
  /**
   * NOD-9: atualiza o CLI (o clique; `agora` passa à frente dos bots que rodam). Resolve quando termina; a fase vem em
   * `atualizacao`. Opcional: o app instalado antes desta versão não tem, e a web mostra o comando do terminal.
   */
  atualizar?(ia: IaDesktop, opcoes?: { agora?: boolean }): Promise<EstadoIa>;
  /** Um ouvinte só (registrar de novo troca o anterior). */
  aoMudar(fn: (estado: EstadoIa) => void): void;
};

// ADR-101: as várias contas ficam em contas-desktop.ts (o teto de 200 linhas por contrato).
export type { ContaNaTela, ContasNaTela, DetalheDaConta, DetalhesDasContas, PonteContas } from "./contas-desktop.ts";

export type NodDesktop = import("./desktop-barra.ts").PonteBarraDesktop & import("./desktop-conta-app.ts").PonteContaNoApp & import("./desktop-esta-maquina.ts").PonteEstaMaquina & import("./remover-computador.ts").PonteRemoverDesktop & { // NOD-119 barra; ADA-242 conta; ADA-243 estaMaquina; ADA-245 remover
  /** Mostra o aviso só se a janela do nod não estiver na frente; devolve se mostrou. */
  avisar?(aviso: AvisoDesktop): Promise<boolean>;
  /** O número no ícone do Dock: pedidos abertos (0 apaga). */
  contador?(n: number): Promise<void>;
  preferencias?(): Promise<PreferenciasDesktop>;
  definirAvisos?(ligado: boolean): Promise<PreferenciasDesktop>;
  /**
   * Grava o tema fora da página: o localStorage da janela web é apagado a cada conexão. Opcional porque o app
   * instalado antes de 2026-10-04 não tem: a web confere antes de chamar.
   */
  definirTema?(tema: TemaDesktop): Promise<PreferenciasDesktop>;
  /**
   * Liga ou desliga o som dos avisos (NOD-196); com os avisos desligados, a escolha continua guardada. Opcional porque o
   * app instalado antes de 2026-10-07 não tem: a web confere antes de chamar.
   */
  definirSom?(ligado: boolean): Promise<PreferenciasDesktop>;
  /**
   * Modo ligação (definido em 2026-10-04, ADR-071): confere e, se o macOS ainda não perguntou, pede o acesso ao
   * microfone. Opcional porque o app instalado antes desta versão não tem: a web confere antes de chamar.
   */
  microfone?(): Promise<EstadoMicrofone>;
  /**
   * A página avisa que abriu (ou fechou) uma ligação: o processo principal impede a suspensão do app, desliga o
   * throttling da janela e passa a perguntar "Encerrar a ligação?" antes de fechar. Opcional pelo mesmo motivo.
   */
  emLigacao?(ativa: boolean): Promise<void>;
  /**
   * Onboarding (definido em 2026-10-04, ADR-077): sem IA pronta no Mac, a web mostra os cards de IA e o clique chega
   * aqui. "entrar" roda o login do próprio CLI (`claude auth login` / `codex login`), que abre o navegador: o nod nunca
   * vê token. "instalar" abre a página oficial no navegador. Opcionais pelo mesmo motivo dos de cima.
   */
  iaEntrar?(ia: IaDesktop): Promise<ResultadoIaDesktop>;
  iaInstalar?(ia: IaDesktop): Promise<ResultadoIaDesktop>;
  /**
   * Testa de verdade as IAs do Mac que têm login (ou só `ia`, quando dada) e devolve o veredito de cada uma das duas.
   * `nome` personaliza a pergunta. Chamadas simultâneas esperam o mesmo teste. Opcional: o app instalado antes de
   * 2026-10-05 não tem, e a web segue então com o que a sonda de login disse.
   */
  iaTestar?(pedido?: { nome?: string; ia?: IaDesktop }): Promise<TesteDeIa[]>;
  /**
   * O estado único e as ações das IAs dentro do app (definido em 2026-10-09). Opcional: o app instalado antes da rc.7
   * não tem, e a web segue então com `iaEntrar`/`iaInstalar` (que continuam funcionando como antes).
   */
  ias?: PonteIas;
  /** ADR-101: as várias contas de cada IA. Opcional: o app instalado antes de 2026-10-12 não tem. */
  contas?: PonteContas;
  /** NOD-323: a mídia do bot que ficou no Mac (Mostrar no Finder). Opcional: o app anterior não tem. */
  midia?: PonteMidia;
  /** NOD-345 (ADR-124): a pessoa entrou numa conta pela janela do app; a página passa o código de troca de uso único e o
   * processo principal o troca pela chave do espaço novo e reconecta. `false` = código recusado (a página segue na sessão
   * web). Opcional: o app instalado antes desta versão não tem, e a página então só pede para reconectar o app. */
  trocarConta?(codigo: string): Promise<boolean>;
  desafioConta?(): Promise<string>; // O desafio (SHA-256) do segredo de troca: a página o manda no login para receber o código.
  souDaEquipe?(): Promise<boolean>; // NOD-406: sai do espaço provisório para a tela de conexão (false = cancelado/ocupado/não provisória).
  vmTentarAgora?(): Promise<void>; // NOD-93: retoma já o download pausado da VM local (sem a VM: nada). Ausente = app antigo.
  aoAbrir?(fn: (alvo: AlvoAviso) => void): void; // a pessoa clicou num aviso: a web abre o alvo.
  aoBuscar?(fn: (acao: "abrir" | "proxima" | "anterior") => void): void; // NOD-42: Editar › Buscar (ausente = app antigo).
  aoDeepLink?(fn: () => void): void;
  deepLinkPendente?(): Promise<AlvoAviso | null>; // NOD-136: aviso sem dado; o pull esvazia a fila.
};

export { CANAIS_DESKTOP, LIMITES_AVISO } from "./desktop-canais.ts";
