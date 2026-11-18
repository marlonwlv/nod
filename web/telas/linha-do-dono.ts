import type { Estado } from "../estado/reducer.ts";
import { fraseDoDono, linhaDoDono, temDonos } from "../lib/dono.ts";
import { esc } from "../lib/render.ts";
import { abertosDoBot, maquinasDe, leituraDoMac, rodandoNoMac, textoDaContagemDeMemoria } from "../lib/trabalhos.ts";
import { chipTrabalhosDoBot } from "./trabalhos.ts";

/**
 * O dono de cada bot na tela (definido em 2026-10-12, ADR-099 item 10, parte 5; protótipo docs/prototipos/um-dono-por-bot/,
 * quadros 01 e 05): o sinal do bot na barra lateral e na grade. As frases saem de web/lib/dono.ts; aqui, o HTML. Servidor
 * sem o dono (anterior ao I10): o chip com o número. A tela Tarefas com uma linha por bot mora em web/telas/tela-tarefas.ts
 * (ADR-187 §8, 2026-11-18); a linha acima do campo virou a aba das tarefas (web/telas/pilula-do-bot.ts).
 */

type Agente = NonNullable<Estado["frota"]>["agentes"][number];

/**
 * O estado da memória (ou do disco cheio que segura tudo) do Mac agora, com a frase, a cor e para onde leva: o ponto da
 * pílula do bot e do progresso na fala (PR 8) e a linha "Agora" da Atividade (ADR-114) leem daqui. null = nada pede a pessoa.
 */
export function memoriaDoMac(estado: Estado, agenteId: string, conversaId: string | null | undefined): { texto: string; nivel: "amarela" | "vermelha"; alvo: string; abertos: number; rodandoAqui: number; disco: boolean } | null {
  const maquinas = maquinasDe(estado.trabalhos);
  // NOD-372: com as máquinas no DTO, a memória conta só os trabalhos do bot rodando no Mac (sem nenhum, ela some); o
  // servidor anterior segue com os abertos. `abertos` segue sendo os abertos do bot: é por ele que a pílula e a fala
  // mostram o disco cheio, que vale mesmo sem nada rodando no Mac (a fila parada é justamente o caso dele).
  const doBot = abertosDoBot(estado, agenteId, conversaId);
  const abertos = doBot.length;
  const rodandoAqui = maquinas ? rodandoNoMac(doBot).length : abertos;
  const legado = estado.trabalhos?.motivoEspera === "disco" && estado.trabalhos.seguraTudoNovo === true;
  const disco = maquinas ? maquinas.find((m) => m.motivoEspera === "disco" && m.seguraTudoNovo) : legado ? { ehMac: true, nome: "seu Mac" } : undefined;
  const nivel = maquinas ? leituraDoMac(estado.trabalhos).pressao : estado.pressao;
  const n = textoDaContagemDeMemoria(rodandoAqui, maquinas ? "rodando" : "abertos");
  const semMemoria = maquinas !== undefined && rodandoAqui === 0;
  const alvo = disco ? `data-act="secao-espaco" data-secao="${disco.ehMac ? "este-mac" : "maquinas"}"` : 'data-act="navegar" data-tela="trabalhos"';
  const texto = disco
    ? `${disco.ehMac ? "Pouco espaço no disco do seu Mac" : `Pouco espaço no disco em ${disco.nome}`} · nenhuma tarefa nova começa`
    : semMemoria ? null : nivel === "amarela" ? `Pouca memória no seu Mac · ${n}` : nivel === "vermelha" ? `Seu Mac está quase sem memória · pode travar; ${n}` : null;
  if (!texto) return null;
  return { texto, nivel: disco || nivel === "vermelha" ? "vermelha" : "amarela", alvo, abertos, rodandoAqui, disco: Boolean(disco) };
}

// ---- a barra lateral (quadro 01 × o desenho) ----------------------------------------------------------------------------

/**
 * O sinal do bot ao lado do nome: um só — ponto vivo trabalhando (com o número de frentes, se mais de uma), vazado só
 * esperando (ou só com fila), azul quando precisa de você; o `title` diz a frase inteira ("1 trabalhando · 10
 * esperando"). Só lê `GET trabalhos` (a barra é lembrada pelo que lê, web/lib/lembrar.ts); por isso o turno da própria
 * conversa não conta aqui — o mascote já anima. Sem o dono no servidor, o chip de antes.
 */
export function sinalDoBot(estado: Estado, a: Pick<Agente, "id" | "cor" | "conversaId">): string {
  if (!temDonos(estado)) return chipTrabalhosDoBot(estado, a);
  const dono = estado.trabalhos?.donos?.find((d) => d.estado.agenteId === a.id);
  const l = dono ? linhaDoDono(dono, 0) : null;
  if (!dono || !l) return "";
  const frase = fraseDoDono({ ...dono, estado: { ...dono.estado, conversaTrabalhando: false, conversaPropriaTrabalhando: false } });
  const ponto = l.sinal === "voce" ? "precisa" : l.sinal === "vivo" ? `${esc(a.cor)} pulso-trab` : "fora-do-mac";
  const n = l.sinal === "vivo" && dono.estado.frentes > 1 ? `<span class="sinal-n">${dono.estado.frentes}</span>` : "";
  return `<span class="chip-trab sinal-dono" data-sinal="${l.sinal}" title="${esc(frase)}" aria-label="${esc(frase)}"><span class="ponto-trabalho ${ponto}" aria-hidden="true"></span>${n}</span>`;
}

/**
 * Paper 15–17 (rodada 3 da casca, "igual ao Paper"): o sinal do bot no canto do avatar da grade — o ponto na cor do bot
 * trabalhando (com o número à esquerda quando são 2 ou mais frentes), o vazado esperando e o laranja precisando de você.
 * Só com o dono no servidor; a fila sozinha não ganha sinal. O mesmo critério de `sinalDoBot` (o turno da conversa não conta).
 */
export function sinalNaGrade(estado: Estado, a: Pick<Agente, "id" | "cor">): string {
  if (!temDonos(estado)) return "";
  const dono = estado.trabalhos?.donos?.find((d) => d.estado.agenteId === a.id);
  const l = dono ? linhaDoDono(dono, 0) : null;
  if (!dono || !l || (l.sinal !== "vivo" && l.sinal !== "espera" && l.sinal !== "voce")) return "";
  const n = l.sinal === "vivo" && dono.estado.frentes > 1 ? `<b>${dono.estado.frentes}</b>` : "";
  return `<span class="fixado-sinal ${esc(a.cor)}" data-sinal="${l.sinal}" aria-hidden="true">${n}<i></i></span>`;
}
