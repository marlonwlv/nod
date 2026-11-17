import { plataformaDaTela } from "./plataforma-da-tela.ts";
import { botao } from "./render.ts";

/**
 * O microfone bloqueado pelo sistema (17/11/2026, primeiro teste do microfone no Windows): no app do Windows o aviso
 * falava dos "Ajustes do Sistema" do Mac e não levava a lugar nenhum. Agora o texto diz o caminho do sistema em que a
 * pessoa está e, quando o app tem a ponte (`nodDesktop.ajustesMicrofone`), o aviso traz o botão que abre essa tela.
 * Na web pura nada muda: quem libera é o navegador.
 */

/** A ponte do app, sem depender do DOM (os testes da tela também passam pelo tsconfig do servidor). */
const ponte = (): { ajustesMicrofone?: () => Promise<boolean> } | undefined => (globalThis as { nodDesktop?: { ajustesMicrofone?: () => Promise<boolean> } }).nodDesktop;

/** O código do banner do ditado quando o microfone foi negado: é ele que ganha o botão (main.ts `htmlDoErro`). */
export const CODIGO_DITADO_MICROFONE = "ditado_microfone";

/** Onde, no app, a pessoa libera o microfone: Configurações do Windows ou Ajustes do Sistema do Mac. */
export function ondeLiberarMicrofone(windows = plataformaDaTela() === "windows"): string {
  return windows
    ? "Libere o microfone para o nod em Configurações › Privacidade e segurança › Microfone, com o acesso dos aplicativos da área de trabalho ligado."
    : "Libere o microfone em Ajustes do Sistema › Privacidade › Microfone.";
}

/** O app sabe abrir a tela do sistema? (O app de antes desta versão e a web pura não.) */
export function podeAbrirAjustesDoMicrofone(): boolean {
  return typeof ponte()?.ajustesMicrofone === "function";
}

export function botaoAjustesDoMicrofone(classe = "pri sm", windows = plataformaDaTela() === "windows"): string {
  return botao("microfone-ajustes", windows ? "Abrir Configurações" : "Abrir Ajustes", { classe });
}

/** O clique: abre a tela do sistema (o endereço é do processo principal; a página só pede). */
export function abrirAjustesDoMicrofone(): void {
  void ponte()?.ajustesMicrofone?.().catch(() => false);
}

/**
 * A falha do getUserMedia em palavras do nod. No app do Windows o bloqueio das Configurações (o acesso dos aplicativos
 * da área de trabalho desligado) chega como NotReadableError, não NotAllowedError: lá ele também é "negado", para o
 * aviso apontar o lugar certo em vez de "Nenhum microfone encontrado".
 */
export function falhaDoMicrofone(nome: string, windowsNoApp: boolean): "microfone-negado" | "microfone-indisponivel" {
  if (nome === "NotAllowedError" || nome === "SecurityError") return "microfone-negado";
  if (nome === "NotReadableError" && windowsNoApp) return "microfone-negado";
  return "microfone-indisponivel";
}

/** O app do Windows (a janela tem a ponte e o user-agent é do Windows). */
export function windowsNoApp(): boolean {
  return ponte() !== undefined && plataformaDaTela() === "windows";
}
