import type { EntradaNavegador } from "./navegador-do-bot.ts";

/**
 * 2026-11-28 (o painel como um navegador normal): a vista LOCAL do navegador do bot. Quando o Chrome do bot roda no
 * computador onde a pessoa está com o app do nod aberto (o Mac pelo app, o PC pelo motor), os quadros e a entrada não dão
 * a volta pela nuvem: o app fala com um servidor só de 127.0.0.1 que a própria máquina abre (`vista-local.ts`), com um
 * token aleatório que nunca sai dela. O canal do servidor continua aberto, mas só para a vista (o estado, a pílula, o
 * pedido de login) e para o espelho da entrada (o que a pessoa digita, para a gravação e o "Guardar no cofre").
 *
 * A web chega pela ponte do app (`window.nodDesktop.navegadorLocal`): o WebSocket fica no processo principal, que não
 * passa pelas travas de rede local do Chromium.
 */

/** Onde a máquina ouve a vista local (o app lê do motor no PC; no Mac é o mesmo processo). */
export type EnderecoVistaLocal = { porta: number; token: string };

/** O arquivo em que o motor do PC publica o endereço para o app (só da pessoa, na pasta do executor). */
export const ARQUIVO_VISTA_LOCAL = "vista-local.json";

/** App → máquina: uma entrada conferida lá de novo, com o número para a confirmação. */
export type EntradaLocal = { t: "entrada"; n: number; e: EntradaNavegador };

/**
 * Máquina → app: as mensagens do stream que podem sair (`frame`, `tabs`, `status`, como o agent-browser as manda), a
 * confirmação de cada entrada (`ok`: o Chrome respondeu) e o fim (o Chrome fechou, não há Chrome do bot aqui).
 */
export type MensagemLocal =
  | { t: "ok"; n: number; ok: boolean }
  | { t: "fim"; motivo: MotivoFimLocal };

export const MOTIVOS_FIM_LOCAL = ["sem_chrome", "fechou", "recusado", "falhou"] as const;
export type MotivoFimLocal = (typeof MOTIVOS_FIM_LOCAL)[number];

/** Os fechamentos do WebSocket local (4xxx: não adianta tentar de novo agora). */
export const FECHAMENTOS_VISTA_LOCAL = { recusado: 4403, semChrome: 4404 } as const;

/**
 * A ponte do app para a web (preload): abre a vista local de um bot e devolve o id dela (null = não há Chrome do bot neste
 * computador, ou o app não tem a vista local). `enviar` resolve quando o Chrome confirmou (false = não confirmou).
 */
export type PonteNavegadorLocal = {
  abrir(agenteId: string): Promise<string | null>;
  enviar(id: string, e: EntradaNavegador): Promise<boolean>;
  fechar(id: string): Promise<void>;
  /** Cada mensagem da vista local (o texto como veio da máquina). Substitui o ouvinte anterior. */
  aoMensagem(fn: (id: string, texto: string) => void): void;
};

/** Os canais IPC da ponte (desktop/navegador-local.ts e os dois preloads). */
export const CANAIS_NAVEGADOR_LOCAL = {
  abrir: "nod:navegador-local:abrir",
  enviar: "nod:navegador-local:enviar",
  fechar: "nod:navegador-local:fechar",
  mensagem: "nod:navegador-local:mensagem",
} as const;
