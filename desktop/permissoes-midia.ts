import type { EstadoMicrofone } from "../src/contracts/desktop.ts";
import { origemDe } from "./avisos-mac.ts";

/**
 * O microfone da janela web (definido em 2026-10-04, ADR-071, exceção à "página sem permissão nenhuma" de `proteger`):
 * a página remota só ganha `media` de ÁUDIO, só na origem do servidor configurado e só no frame de topo. Vídeo, outro
 * frame (o iframe do artefato), outra origem ou qualquer outra permissão continuam negados. Sem Electron: testável no
 * vitest (tests/unit/desktop/permissoes-midia.test.ts).
 */

/** O pedido (`setPermissionRequestHandler`): `mediaTypes` só com "audio", nada de vídeo. */
export function permitirPedidoDeMidia(p: { permissao: string; tiposDeMidia: readonly string[] | undefined; urlDoPedido: string | undefined; frameDeTopo: boolean; servidor: string | null | undefined }): boolean {
  const servidor = origemDe(p.servidor);
  const tipos = p.tiposDeMidia ?? [];
  return p.permissao === "media" && p.frameDeTopo && servidor !== null && origemDe(p.urlDoPedido) === servidor && tipos.length > 0 && tipos.every((t) => t === "audio");
}

/** A checagem (`setPermissionCheckHandler`): o Chromium pergunta por um tipo de cada vez ("audio" | "video" | "unknown"). */
export function permitirChecagemDeMidia(p: { permissao: string; tipoDeMidia: string | undefined; origem: string | undefined; frameDeTopo: boolean; servidor: string | null | undefined }): boolean {
  const servidor = origemDe(p.servidor);
  return p.permissao === "media" && p.tipoDeMidia === "audio" && p.frameDeTopo && servidor !== null && origemDe(p.origem) === servidor;
}

/**
 * O que o macOS diz do microfone (`systemPreferences.getMediaAccessStatus("microphone")`) em três palavras. "not-determined"
 * devolve null: ainda não perguntou, quem chama pede (`askForMediaAccess`). Status desconhecido conta como negado.
 */
export function estadoDoMicrofone(status: string): EstadoMicrofone | null {
  if (status === "granted") return "concedido";
  if (status === "restricted") return "restrito";
  if (status === "not-determined") return null;
  return "negado";
}

/**
 * O mesmo no Windows (17/11/2026). O Electron lê `DeviceAccessInformation` do microfone: "denied" é o acesso do app
 * desligado e "restricted" o acesso ao microfone desligado no computador todo; os dois a pessoa liga em Configurações ›
 * Privacidade e segurança › Microfone, então os dois viram "negado" (com o botão que abre essa tela). O Windows não tem
 * pergunta (não há `askForMediaAccess`): "not-determined"/"unknown" deixam o getUserMedia tentar.
 */
export function estadoDoMicrofoneWindows(status: string): EstadoMicrofone {
  return status === "denied" || status === "restricted" ? "negado" : "concedido";
}

/**
 * Onde o sistema libera o microfone (o botão do aviso "libere o microfone"). Endereço fixo daqui: a página só pede abrir.
 * Windows: Configurações › Privacidade e segurança › Microfone. Mac: Ajustes do Sistema › Privacidade › Microfone.
 */
export const AJUSTES_DO_MICROFONE = {
  win32: "ms-settings:privacy-microphone",
  darwin: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
} as const;

/** O argumento de `emLigacao`: só boolean; qualquer outra coisa → null (o handler recusa). */
export function lerEmLigacao(valor: unknown): boolean | null {
  return typeof valor === "boolean" ? valor : null;
}

export const TEXTO_FECHAR_EM_LIGACAO = {
  mensagem: "Encerrar a ligação?",
  detalhe: "Fechar o nod desliga a ligação com o bot.",
  encerrar: "Encerrar e fechar",
  continuar: "Continuar na ligação",
} as const;
