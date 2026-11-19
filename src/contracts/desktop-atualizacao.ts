/**
 * ADR-188 (emenda o item 6 da ADR-149): a atualização do app do Mac aparece na janela web — o cartão "Atualizar o nod"
 * no pé da barra e Configurações › Sobre o nod. A web só lê o estado e pede; quem procura, baixa e reinicia continua sendo
 * o processo principal (desktop/atualizacao.ts), que valida cada pedido de novo.
 */

export const CANAIS_ATUALIZACAO = {
  estado: "nod:atualizacao-app:estado",
  mudou: "nod:atualizacao-app:mudou",
  reiniciar: "nod:atualizacao-app:reiniciar",
  procurar: "nod:atualizacao-app:procurar",
  definirSozinho: "nod:atualizacao-app:definir-sozinho",
  avisoVisto: "nod:atualizacao-app:aviso-visto",
} as const;

export type FaseAtualizacaoNaTela = "desligada" | "ociosa" | "procurando" | "baixando" | "pronta" | "erro";

export type AtualizacaoNaTela = {
  fase: FaseAtualizacaoNaTela;
  /** A versão que está rodando agora. */
  versaoAtual: string;
  /** A versão baixada, pronta para entrar ao reiniciar (só na fase "pronta"). */
  versaoNova: string | null;
  /** Desligada: o motivo; erro: a frase do erro. */
  motivo: string | null;
  /** Quando procurou pela última vez (ms); null = ainda não procurou desde que abriu. */
  procuradaEm: number | null;
  /** A pessoa pediu "Reiniciar quando terminar": o app reinicia sozinho quando nenhum bot estiver trabalhando. */
  esperandoLivre: boolean;
  /** O reinício começou (a janela vai fechar). */
  reiniciando: boolean;
  /** ADR-173: reiniciar sozinho com o Mac parado (15 min sem teclado e mouse e nada rodando); null = o sistema não tem (Windows). */
  sozinho: boolean | null;
  /** O app acabou de voltar de uma atualização: a versão de antes (o aviso "nod atualizado para a x.y.z", uma vez). */
  atualizadoDe: string | null;
};

/**
 * `agora`: reinicia já se nada estiver rodando; com bot trabalhando devolve `ocupado` (a tela pergunta).
 * `forcar`: a pessoa respondeu "Reiniciar agora" na pergunta (só a ligação ainda recusa).
 * `quandoLivre`: espera o último bot terminar; `cancelarEspera` desfaz.
 */
export type PedidoReinicio = { quando: "agora" | "forcar" | "quandoLivre" | "cancelarEspera" };

export type RespostaReinicio =
  | { ok: true; esperando: boolean }
  | { ok: false; motivo: "emLigacao" | "naoPronta" }
  | { ok: false; motivo: "ocupado"; turnos: number; telas: number };

export type PonteAtualizacaoApp = {
  /** Ausente = a web no navegador, no Windows sem a ponte ou um app antigo. */
  atualizacaoApp?: {
    estado(): Promise<AtualizacaoNaTela>;
    aoMudar(fn: (estado: AtualizacaoNaTela) => void): void;
    reiniciar(pedido: PedidoReinicio): Promise<RespostaReinicio>;
    /** Procura agora (o "Procurar agora" de Sobre o nod). */
    procurar(): Promise<AtualizacaoNaTela>;
    definirSozinho(ligado: boolean): Promise<AtualizacaoNaTela>;
    /** A web mostrou o "nod atualizado para…": não mostra de novo. */
    avisoVisto(): Promise<void>;
  };
};
