/**
 * Spec do botão + (tela 5): a fala que o bot interativo grava ao nascer. O balão é só a saudação; a pergunta e as opções
 * vão no payload `boas_vindas`, e a web as desenha num cartão (A, B, C e "Outra coisa" como campo livre). A prévia da barra
 * mostra a pergunta (listar-frota.ts). As falas gravadas antes não têm pergunta nem opções no payload.
 */
export const PERGUNTA_BOAS_VINDAS = "Para que você quer minha ajuda?";

/** `rotulo` é o que o cartão mostra; `texto`, o que vai como a resposta da pessoa quando ela escolhe a opção. */
export type OpcaoBoasVindas = { rotulo: string; texto: string };

export const OPCOES_BOAS_VINDAS: readonly OpcaoBoasVindas[] = [
  { rotulo: "Tarefas do dia a dia", texto: "Quero ajuda com tarefas do dia a dia: lembretes e organização." },
  { rotulo: "Trabalho e projetos", texto: "Quero ajuda com meu trabalho e projetos." },
  { rotulo: "Pesquisa e ideias", texto: "Quero ajuda com pesquisa e desenvolvimento de ideias." },
];

/** "Oi, Ana! Eu sou Frida. Acabamos de nos conhecer." — só o primeiro nome da pessoa; sem ele, "Oi!". */
export function saudacaoDeBoasVindas(pessoa: string | null | undefined, nome: string): string {
  const primeiro = pessoa?.trim().split(/\s+/)[0] ?? "";
  return `${primeiro ? `Oi, ${primeiro}!` : "Oi!"} Eu sou ${nome}. Acabamos de nos conhecer.`;
}
