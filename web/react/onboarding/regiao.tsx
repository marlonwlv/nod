import { montarRegiao, type Montada } from "../regioes.tsx";
import { CamadaOnboarding, type PropsCamada } from "./camada.tsx";

/**
 * ADR-179 (fase 5): a região `#onboarding` no React. O main.ts carrega este módulo só quando a camada vai aparecer
 * (import dinâmico): quem já passou pelo onboarding não baixa o React por causa dele. A região é montada na primeira
 * vez e fica montada; sem camada, desenha nada (o main.ts põe o `hidden`).
 */
let montada: Montada | null = null;

export type DesenhoDoOnboarding = Omit<PropsCamada, "regiao">;

export function desenharOnboarding(p: DesenhoDoOnboarding | null, doc: Document = document): void {
  const el = doc.getElementById("onboarding");
  if (!el || (!p && !montada)) return;
  montada ??= montarRegiao("onboarding", null, doc);
  montada.desenhar(p ? <CamadaOnboarding {...p} regiao={el} /> : null);
}

/** Só para os testes: devolve a região ao estado de antes de montar. */
export function desmontarOnboarding(): void {
  montada?.desmontar();
  montada = null;
}
