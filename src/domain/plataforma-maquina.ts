import type { PlataformaMaquina } from "../contracts/ponte.ts";

/**
 * ADR-147 (definido em 2026-11-03): a máquina do motor sem janela — Linux (ADR-090) ou Windows. Ela é nomeada nos
 * avisos ("a máquina X parou"), não depende do Mac e tem a pasta e os arquivos nela. Null (a chave que ainda não disse
 * o sistema) segue como o Mac, a convenção do `compor.ts`.
 */
export function ehMaquinaDoMotor(plataforma: PlataformaMaquina | null | undefined): boolean {
  return plataforma === "linux" || plataforma === "win32";
}

/**
 * ADR-147: o trecho "um Linux sempre ligado" dos textos do terminal vira "um PC com Windows" no win32. revisto em
 * 2026-11-26 (QA da rc.15 no Windows, achado 7): no Windows o motor roda no PC da própria pessoa, então o texto não diz
 * mais "e não no Mac dela" nem que ela não vê os arquivos no Mac (o bot respondia "aconteceu no PC, não no seu Mac").
 */
export function noSistemaDaMaquina(texto: string, plataforma: PlataformaMaquina | null | undefined): string {
  if (plataforma !== "win32") return texto;
  return texto
    .replaceAll("um Linux sempre ligado, e não no Mac dela.", "o PC com Windows dela.")
    .replaceAll("um Linux sempre ligado", "um PC com Windows")
    .replace(/Os arquivos ficam aqui: [^:]*? não os vê no Mac, então entregue/g, "Os arquivos ficam neste PC; mesmo assim, entregue");
}
