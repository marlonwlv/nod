import { ehCelular } from "./celular.ts";

/**
 * NOD-383: no celular, o "computador" e o "Mac" de que a interface falava não são o aparelho na mão da pessoa. Os textos que
 * falam do próprio aparelho dizem "aparelho"; o Mac do servidor (ADR-092) vira "Seu Mac", porque "Este Mac" lido no celular
 * aponta para o celular. No desktop (e sem `matchMedia`, nos testes) tudo fica como era.
 */
export function nesteAparelho(celular = ehCelular()): string {
  return celular ? "neste aparelho" : "neste computador";
}

/** O Mac onde o servidor roda, visto de onde a pessoa está. */
export function rotuloDoMac(celular = ehCelular()): string {
  return celular ? "Seu Mac" : "Este Mac";
}

/** O sistema do computador pelo `navigator.platform` ("MacIntel", "Win32", "Linux x86_64"); fora do navegador, vazio. */
function plataformaAtual(): string {
  return (globalThis as { navigator?: { platform?: string } }).navigator?.platform ?? "";
}

/**
 * O detalhe do Tema: no celular, o sistema é o do aparelho, não o macOS. PR #333 (achado 7, QA do rc.10 no Windows): no
 * Windows o texto dizia "macOS"; agora nomeia o sistema de verdade (Mac → macOS, Windows → Windows, outro → do sistema).
 */
export function detalheDoTema(celular = ehCelular(), plataforma = plataformaAtual()): string {
  if (celular) return "Sistema segue o modo claro ou escuro do aparelho";
  const sistema = /Win/i.test(plataforma) ? "do Windows" : /Linux|X11|CrOS/i.test(plataforma) ? "do sistema" : "do macOS";
  return `Sistema acompanha o modo claro ou escuro ${sistema}. Vale para este computador.`;
}
