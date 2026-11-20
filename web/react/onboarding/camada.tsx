import { useLayoutEffect, useRef } from "react";
import type { VistaCamada, VistaOnboarding } from "../../telas/onboarding.ts";
import { Apresentacao } from "./apresentacao.tsx";
import type { AcoesDoCartaoIa } from "./cartao-ia.tsx";
import { DialogoAviso } from "./dialogo-aviso.tsx";
import { EsteComputador } from "./este-computador.tsx";
import { Executor } from "./executor.tsx";
import { Chamando, GuiaSolta, Ola, PainelEntrevista } from "./ligacao.tsx";
import type { Executar } from "./tipos.ts";
import "./onboarding.css";

/**
 * ADR-179 (fase 5): a região `#onboarding` inteira em React — as camadas de tela cheia do onboarding (ADR-077, ADR-174,
 * ADA-242) e o aviso de leitura por cima delas. O controlador (web/telas/onboarding-controle.ts) decide o que aparece
 * (`vista()`); o main.ts entrega a vista e as ações a cada desenho (web/react/onboarding/regiao.tsx).
 */
export type PropsCamada = {
  vista: VistaOnboarding;
  executar: Executar;
  copiar: (texto: string) => Promise<boolean>;
  cartao: AcoesDoCartaoIa;
  /** O elemento da região: para o foco não se perder quando a tela troca. */
  regiao: HTMLElement;
};

function Tela({ camada, executar, copiar, cartao }: Omit<PropsCamada, "vista" | "regiao"> & { camada: VistaCamada }) {
  switch (camada.tipo) {
    case "ola": return <Ola executar={executar} />;
    case "apresentacao": return <Apresentacao e={camada.apres} emailGoogle={camada.emailGoogle} ligacao={camada.ligacao} executar={executar} />;
    case "computador": return <EsteComputador v={camada.computador} executar={executar} />;
    case "executor": return <Executor e={camada.tela} executar={executar} copiar={copiar} cartao={cartao} />;
    case "chamando": return <Chamando e={camada.tela} executar={executar} />;
    case "entrevista": return <PainelEntrevista dados={camada.dados} />;
    case "guia-solta": return <GuiaSolta e={camada.tela} executar={executar} />;
  }
}

export function CamadaOnboarding({ vista, executar, copiar, cartao, regiao }: PropsCamada) {
  // O botão com o foco pode sumir quando a tela troca sozinha (o teste da IA voltou, a sonda achou o login). definido em
  // 2026-10-05: o foco vai ao título da tela nova, que o leitor de tela anuncia. Sem foco na camada, nada muda. O "tinha
  // foco" é lido ao desenhar (antes de o React trocar o DOM) e conferido depois da troca.
  const tinhaFoco = useRef(false);
  tinhaFoco.current = typeof document !== "undefined" && regiao.contains(document.activeElement);
  useLayoutEffect(() => {
    if (!tinhaFoco.current || regiao.contains(document.activeElement)) return;
    regiao.querySelector<HTMLElement>("h1[tabindex]")?.focus();
  });
  return (
    <>
      <Tela camada={vista.camada} executar={executar} copiar={copiar} cartao={cartao} />
      <DialogoAviso aviso={vista.aviso} aoFechar={() => executar("onboarding-fechar-aviso")} />
    </>
  );
}
