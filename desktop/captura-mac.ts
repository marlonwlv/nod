import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CapturaDesktop } from "../src/contracts/desktop-mac.ts";

/**
 * Captura de janela ou região (ADR-173, definido em 2026-11-12) pelo `screencapture` do próprio macOS, em modo
 * interativo: a pessoa arrasta uma região, ou aperta Espaço e clica numa janela (o mesmo gesto do ⇧⌘4). Sem módulo
 * nativo: um addon de ScreenCaptureKit não é preciso; o `screencapture` dá o mesmo resultado com zero dependência e já
 * respeita a permissão de Gravação de Tela do macOS (sem ela, a imagem sai só com o fundo da mesa).
 *
 * Cancelou (Esc) = nenhum arquivo = null. O arquivo temporário sai sempre, deu certo ou não. Só PNG, até 10 MB (o teto
 * do anexo do chat).
 */
export const TETO_CAPTURA_BYTES = 10 * 1024 * 1024;
/** definido em 2026-11-12: dois minutos para a pessoa escolher a região; depois o pedido cai sozinho. */
export const PRAZO_CAPTURA_MS = 120_000;

export type DepsCaptura = {
  plataforma: NodeJS.Platform;
  /** Executa o screencapture (injetável no teste). Resolve quando ele sai, com ou sem arquivo. */
  executar?: (bin: string, args: readonly string[]) => Promise<void>;
  /** Largura e altura da imagem (no app, `nativeImage`); null se não der para ler. */
  medir: (bytes: Buffer) => { largura: number; altura: number } | null;
  agora?: () => Date;
};

function executarPadrao(bin: string, args: readonly string[]): Promise<void> {
  return new Promise((resolver) => {
    execFile(bin, [...args], { timeout: PRAZO_CAPTURA_MS, shell: false }, () => resolver());
  });
}

export function nomeDaCaptura(agora: Date): string {
  const d = (n: number) => String(n).padStart(2, "0");
  return `captura-${agora.getFullYear()}-${d(agora.getMonth() + 1)}-${d(agora.getDate())}-${d(agora.getHours())}${d(agora.getMinutes())}${d(agora.getSeconds())}.png`;
}

export async function capturarNoMac(deps: DepsCaptura): Promise<CapturaDesktop | null> {
  if (deps.plataforma !== "darwin") return null;
  const pasta = await mkdtemp(join(tmpdir(), "nod-captura-"));
  const arquivo = join(pasta, "captura.png");
  try {
    // -i interativo (região; Espaço troca para janela) · -x sem som · -o sem a sombra da janela · -t png
    await (deps.executar ?? executarPadrao)("/usr/sbin/screencapture", ["-i", "-x", "-o", "-t", "png", arquivo]);
    const info = await stat(arquivo).catch(() => null);
    if (!info || info.size === 0) return null;
    if (info.size > TETO_CAPTURA_BYTES) return { erro: "grande_demais" };
    const bytes = await readFile(arquivo);
    const medida = deps.medir(bytes);
    return { nome: nomeDaCaptura(deps.agora?.() ?? new Date()), mime: "image/png", base64: bytes.toString("base64"), largura: medida?.largura ?? null, altura: medida?.altura ?? null };
  } finally {
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
}
