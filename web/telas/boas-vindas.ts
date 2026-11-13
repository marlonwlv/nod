import type { Agente } from "../../src/contracts/agente.ts";
import type { Mensagem, PayloadMensagem } from "../../src/contracts/mensagem.ts";
import { esc, iconeAgente } from "../lib/render.ts";
import { htmlDivisor } from "./divisores-de-data.ts";

/**
 * Spec do botão + (telas 3 a 5): o que o bot interativo recém-criado mostra até a pessoa responder. O relógio preserva a
 * conversa vazia e o "Refletindo" mesmo com uma API rápida; depois disso, a fase sai do fluxo. "pensando" é o bot criado nesta janela — na barra o
 * avatar pensa e a prévia some; no chat, o divisor e "Refletindo". "pergunta" é a conversa com a fala `boas_vindas` e
 * nenhuma mensagem da pessoa: o cartão "Para que você quer minha ajuda?", o placeholder da resposta e o ponto de não lido
 * na linha, mesmo com a conversa aberta. A primeira mensagem da pessoa (uma opção, "Outra coisa" ou o campo) encerra.
 */
export type FaseDasBoasVindas = "vazia" | "pensando" | "pergunta" | null;

export const ATRASO_PARA_REFLETIR_MS = 2_000;
export const ATRASO_PARA_PERGUNTAR_MS = 6_200;

export const PLACEHOLDER_DA_PERGUNTA = "Digite sua resposta ou fale sobre outra coisa";

type MensagemDaFase = Pick<Mensagem, "kind" | "payload" | "autoria">;

/** `recemCriado`: esta janela criou o bot (o diálogo "Criar novo bot" ou o segurar do +). */
export function faseDasBoasVindas(c: { mensagens: readonly MensagemDaFase[] } | undefined, o: { recemCriado: boolean; confirmado: boolean; decorridoMs?: number }): FaseDasBoasVindas {
  if (o.recemCriado && (o.decorridoMs ?? 0) < ATRASO_PARA_REFLETIR_MS) return "vazia";
  if (o.recemCriado && (o.decorridoMs ?? 0) < ATRASO_PARA_PERGUNTAR_MS) return "pensando";
  if (!c) return o.recemCriado ? "pensando" : null;
  if (o.confirmado || !c.mensagens.some((m) => m.payload?.kind === "boas_vindas")) return null;
  return c.mensagens.some((m) => m.kind === "texto" && m.autoria.autor_tipo === "pessoa") ? null : "pergunta";
}

/**
 * Como a linha da barra fica em cada fase: pensando, o avatar nas três bolinhas e sem prévia; na pergunta, o ponto de não
 * lido mesmo aberta, com o rótulo "{nome}, atividade não lida". Fora delas, a linha de sempre.
 */
export function linhaDasBoasVindas(fase: FaseDasBoasVindas, nome: string): { pensando: boolean; semPrevia: boolean; naoLida: boolean; rotulo: string | null } {
  if (fase === "pensando") return { pensando: true, semPrevia: true, naoLida: false, rotulo: null };
  if (fase === "pergunta") return { pensando: false, semPrevia: false, naoLida: true, rotulo: `${nome}, atividade não lida` };
  return { pensando: false, semPrevia: false, naoLida: false, rotulo: null };
}

/** Tela 4: o divisor "Hoje H:MM" de quando o bot nasceu e, à esquerda, as três bolinhas na cor dele com "Refletindo". */
export function htmlRefletindo(agente: Pick<Agente, "nome" | "cor" | "forma">, desde: number, agora: number): string {
  return `<div class="timeline">${htmlDivisor(desde, agora, true)}<article class="message bot fala-viva bv-pensando ${esc(agente.cor)}" role="status" aria-label="${esc(agente.nome)} está refletindo">${iconeAgente(agente, "md", "pensando", 'data-parte="mascote"')}<div class="bubble-wrap"><div class="bv-refletindo"><span class="fala-viva-estado" aria-hidden="true">Refletindo</span></div></div></article></div>`;
}

/** As opções das falas `boas_vindas` gravadas antes da pergunta ir no payload. Espelho de src/domain/boas-vindas.ts (a web não importa o domínio; o teste confere). */
export const PERGUNTA_PADRAO = "Para que você quer minha ajuda?";
export const OPCOES_PADRAO: readonly { rotulo: string; texto: string }[] = [
  { rotulo: "Tarefas do dia a dia", texto: "Quero ajuda com tarefas do dia a dia: lembretes e organização." },
  { rotulo: "Trabalho e projetos", texto: "Quero ajuda com meu trabalho e projetos." },
  { rotulo: "Pesquisa e ideias", texto: "Quero ajuda com pesquisa e desenvolvimento de ideias." },
];

type PayloadBoasVindas = Extract<PayloadMensagem, { kind: "boas_vindas" }>;

/**
 * Tela 5: o cartão da pergunta, logo depois do balão da saudação. Cada opção (A, B, C…) manda o texto dela como a resposta
 * da pessoa (`escolher-missao`); a última, "Outra coisa", é um campo livre em que o Enter manda o que foi escrito.
 */
export function cartaoDeBoasVindas(p: PayloadBoasVindas, mensagemId: string): string {
  const opcoes = p.opcoes?.length ? p.opcoes : OPCOES_PADRAO;
  const titulo = `bv-t-${esc(mensagemId)}`;
  const tecla = (i: number) => `<span class="bv-tecla" aria-hidden="true">${String.fromCharCode(65 + i)}</span>`;
  const lista = opcoes.map((o, i) => `<button type="button" class="bv-opcao" data-act="escolher-missao" data-texto="${esc(o.texto)}">${tecla(i)}<span class="bv-rotulo">${esc(o.rotulo)}</span></button>`).join("");
  const outra = `<label class="bv-opcao bv-outra">${tecla(opcoes.length)}<input type="text" class="bv-outra-campo" placeholder="Outra coisa" aria-label="Outra coisa: escreva e tecle Enter" autocomplete="off" /></label>`;
  return `<section class="bv-cartao" role="group" aria-labelledby="${titulo}"><h2 class="bv-titulo" id="${titulo}">${esc(p.pergunta || PERGUNTA_PADRAO)}</h2><div class="bv-lista">${lista}${outra}</div></section>`;
}
