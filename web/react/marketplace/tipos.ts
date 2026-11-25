import type { FormaAgente, CorAgente } from "../../../src/contracts/agente.ts";
import type { NivelPedido, NivelVisto } from "../../lib/acessos-otimistas.ts";
import type { SituacaoApp } from "../../telas/app-acesso.ts";

/**
 * O Marketplace em modal (Paper "Apps por chave de API · jornada", artboards D1 e T1–T6b; ADR-179, região #marketplace).
 * O modal só fala com o mundo por esta interface: no app, o adaptador real (real.ts) lê o estado do reducer e chama
 * api.ts e os fluxos de sempre do main.ts; no simulador (simulado.ts), dados de mentira com a mesma forma. Assim cada
 * estado do protótipo abre sem chave de verdade, e o componente não sabe qual dos dois tem na mão.
 *
 * Nenhum tipo daqui carrega o VALOR de um campo secreto: o valor mora só no <input> (o mesmo precedente do cartão de
 * credencial, web/telas/card-credencial.ts) e vai direto de lá para `conectarComChave`.
 */

/** Um app na vitrine, já com o estado dele para esta pessoa. */
export type AppDaVitrine = {
  slug: string;
  nome: string;
  descricao: string;
  categoria: string;
  /** Conecta com a chave de API da pessoa (`AppComLogo.conexao === "chave"`); sem isto, entra pelo login. */
  chave: boolean;
  /** A frase curta da linha ("Resume reuniões"); sem ela, a linha usa a descrição (cortada com reticências). */
  resumo?: string;
  /** URL do logo (a mesma que `logoApp` usa) ou null: a inicial aparece no lugar. */
  logo: string | null;
  /** Só o simulador: a cor do ladrilho da inicial, como no protótipo (o app real mostra o logo da marca). */
  cor?: string;
  /** Só o simulador: o que vai no ladrilho no lugar da inicial ("31" do Google Calendar no protótipo). */
  sigla?: string;
  situacao: SituacaoApp;
  /** O conector desta pessoa para o app (conectado, em atenção ou desligado). */
  conectorId: string | null;
  /** Conectado mas desligado (o conector existe e não está habilitado, sem falha nova). Conta como conectado. */
  desligado?: boolean;
  /** Em atenção: o que parou ("A chave parou de funcionar · foi apagada ou trocada no Fireflies"). */
  falha: string | null;
  /** O login em andamento (o `estado.conectando[slug]` do reducer); null fora do login. */
  login: { url: string | null; falhou: string | null; semJanela: boolean } | null;
  /** O nível de cada bot da pessoa neste app (só com conector). */
  niveis: Readonly<Record<string, NivelVisto>>;
  /** Entra em "Recomendados para você". */
  recomendado?: boolean;
  /** Onde a pessoa abre o app para achar a chave ("Abrir o Fireflies ↗"). */
  site?: string;
  /**
   * ADR-196: o app aceita mais de uma conta (login do Composio; fora o GitHub e o app de chave). Conectado, abre na tela
   * "Contas" (Paper M1) em vez de ir direto ao "Quem pode usar".
   */
  multiconta?: boolean;
  /** As contas da pessoa neste app, a primeira antes (só com `multiconta` e conectado). */
  contas?: readonly ContaDaVitrine[];
};

/**
 * Uma conta do app (ADR-196): a primeira é o conector de sempre ("gmail"); as outras, os conectores `<app>--<conta>`.
 * `chave` é o slug do conector, e é também a chave do login em andamento (`estado.conectando`).
 */
export type ContaDaVitrine = {
  chave: string;
  conectorId: string | null;
  /** "Gmail" ou "Gmail (pessoal)": o nome do conector, que o Renomear troca. */
  nome: string;
  principal: boolean;
  email: string | null;
  situacao: SituacaoApp;
  desligado: boolean;
  falha: string | null;
  login: { url: string | null; falhou: string | null; semJanela: boolean } | null;
  niveis: Readonly<Record<string, NivelVisto>>;
};

export type BotDaVitrine = { id: string; nome: string; titulo: string; forma: FormaAgente; cor: CorAgente };

/** O que "Quem pode usar" lê do app: o padrão e quem ainda segue o padrão (GET /conectores/:id/acessos). */
export type AcessosDoConector = { padrao: NivelPedido; seguePadrao: ReadonlySet<string> };

/** A foto que o modal desenha. Um objeto novo só quando algo mudou (é o snapshot do useSyncExternalStore). */
export type FotoDoMarketplace = {
  apps: readonly AppDaVitrine[];
  /** Quantos apps o catálogo tem ("Buscar entre 1.445 apps"). */
  total: number;
  bots: readonly BotDaVitrine[];
  /** Por conector; ausente = ainda não carregado. */
  acessos: Readonly<Record<string, AcessosDoConector | undefined>>;
  /** Sem a chave do Composio do time, só o GitHub conecta (o resto leva para Avançado). */
  composioConfigurado: boolean;
};

/** Um campo do formulário de chave, como a tela o desenha (o `CampoDeConexao` do servidor e o que a tela soma). */
export type CampoNaTela = {
  nome: string;
  rotulo: string;
  /** O texto do provedor (em inglês no app real): onde achar o valor. */
  descricao: string;
  segredo: boolean;
  obrigatorio: boolean;
  /** A dica curta em português embaixo de um campo que não é segredo ("É o começo do endereço…"). */
  dica?: string;
  /** Como o campo entra na frase de explicação ("endereço da sua conta"). */
  naFrase?: string;
  prefixo?: string;
  sufixo?: string;
  exemplo?: string;
};

/** Um passo de "Onde achar a chave": texto com trechos em destaque (o nome do menu no app). */
export type PassoDaChave = readonly (string | { destaque: string })[];

export type FormularioDaChave = { campos: CampoNaTela[]; passos?: PassoDaChave[] };

/** O que volta de conectar com a chave. Nunca traz o valor da chave. */
export type ResultadoDaChave =
  | { tipo: "conectado"; conectorId: string }
  /** A chave entrou, mas o app não respondeu ao teste (200 com `falhou`). */
  | { tipo: "sem_resposta"; conectorId: string | null }
  | { tipo: "recusada" }
  | { tipo: "invalida" }
  | { tipo: "nao_configurado" }
  | { tipo: "indisponivel" }
  | { tipo: "rede" };

/** O que a tela "Quem pode usar" diz sobre o que cada nível libera neste app. */
export type NotasDosNiveis = { ler: string; escrita: string; verbosDaEscrita: string };

export type ApiDoMarketplace = {
  ler(): FotoDoMarketplace;
  assinar(ouvinte: () => void): () => void;
  /** GET /marketplace/:slug/campos. Rejeita com `ErroDoFormulario` quando não dá para montar. */
  campos(slug: string): Promise<FormularioDaChave>;
  /** POST /marketplace/:slug/conectar-com-chave. Os valores vêm do formulário e só passam por aqui. */
  conectarComChave(slug: string, valores: Record<string, string>): Promise<ResultadoDaChave>;
  /**
   * O login de sempre (web/lib/conexao.ts). Chamar DENTRO do clique: a janela só abre no gesto da pessoa. ADR-196: `slug`
   * pode ser a chave de uma conta a mais ("gmail--pessoal"), com o nome que a pessoa digitou em `rotulo`.
   */
  conectarLogin(slug: string, rotulo?: string): void;
  /** ADR-196: troca o nome que aparece (PATCH conectores/:id/nome). Rejeita se o servidor recusar. */
  renomearConta(conectorId: string, nome: string): Promise<void>;
  /** ADR-196: tira a conta a mais (DELETE marketplace/contas/:id). Rejeita se o servidor recusar. */
  removerConta(conectorId: string): Promise<void>;
  cancelarLogin(slug: string): void;
  /** Garante que o padrão e o "segue o padrão" do conector estão carregados (e relê ao abrir de novo). */
  abrirAcessos(conectorId: string): void;
  definirNivel(agenteId: string, conectorId: string, nivel: NivelPedido): void;
  /**
   * O lote do "Aplicar aos N" (POST /conectores/:id/acessos/lote). Devolve o recibo que a tela mostra dentro do modal
   * (o aviso solto da página fica por baixo do <dialog>); null = nada aplicado.
   */
  aplicarLote(conectorId: string, nivel: NivelPedido, bots: "todos" | readonly string[], confirmado: boolean): Promise<ReciboDoLote | null>;
  /** POST /acessos/lotes/:id/desfazer (até 24 h). Devolve a frase de quem mudou depois e ficou como está, ou null. */
  desfazerLote(conectorId: string, recibo: ReciboDoLote): Promise<string | null>;
  /** O "Desconectar" da tela antiga: desliga o app (as escolhas ficam guardadas para ligar de novo). */
  desconectar(conectorId: string): Promise<void>;
  /** "Bots novos começam com" (POST /conectores/:id/padrao). */
  definirPadrao(conectorId: string, nivel: NivelPedido, confirmado: boolean): Promise<void>;
  notas(app: AppDaVitrine): NotasDosNiveis;
  /** A tela avançada de sempre (chave do Composio, MCP próprio): fecha o modal e navega. */
  abrirAvancado(): void;
};

/** O que um lote aplicado diz e o que o Desfazer precisa. `loteId` null = nada mudou (sem Desfazer). */
export type ReciboDoLote = { frase: string; loteId: string | null; alvos: readonly string[] };

export class ErroDoFormulario extends Error {
  readonly motivo: "nao_configurado" | "indisponivel";
  constructor(motivo: "nao_configurado" | "indisponivel") {
    super(motivo);
    this.name = "ErroDoFormulario";
    this.motivo = motivo;
  }
}

/** Onde o modal está. `conectadoAgora`: chegou ao "Quem pode usar" logo depois de conectar. */
export type Vista =
  | { tipo: "inicio" }
  | { tipo: "conectados" }
  | { tipo: "chave"; slug: string }
  | { tipo: "acessos"; slug: string; conectorId: string | null; conectadoAgora: boolean; conta?: string }
  /** ADR-196 (Paper M1): as contas do app. `adicionando` abre já com o nome da conta nova (M2). */
  | { tipo: "contas"; slug: string; adicionando?: boolean };

/** Como o modal abre (o simulador usa para pular direto a um estado do protótipo). */
export type InicialDoMarketplace = {
  vista?: Vista;
  busca?: string;
  categoria?: string | null;
  /** Só o simulador: valores já digitados nos campos (o T3 do protótipo vem preenchido). */
  preenchido?: Record<string, string>;
  /** Só o simulador: abre o formulário já num estado de envio (T4 testando, T5 recusada). */
  envio?: "testando" | "recusada";
  /** Só o simulador: bots já marcados no "Quem pode usar" e a confirmação do lote aberta (T6b). */
  selecionados?: readonly string[];
  confirmarEscrita?: boolean;
  /** Só o simulador: a linha com o ponteiro em cima (o T1 mostra o Fireflies assim). */
  realce?: string;
};
