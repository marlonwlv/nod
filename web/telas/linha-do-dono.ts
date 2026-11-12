import type { DonoDto } from "../../src/contracts/dono.ts";
import type { TrabalhoDto } from "../../src/contracts/trabalho.ts";
import type { Estado } from "../estado/reducer.ts";
import { acaoLocal, comAcaoLocal, htmlDasAcoes } from "../lib/esperas-de-colega.ts";
import { conversaViva, esperaNaTela, fraseDoDono, frentesDoBot, grupoDaLinha, linhaDoDono, quemPediu, temDonos, type GrupoDoBot, type LinhaDoDono } from "../lib/dono.ts";
import { ICONE } from "../lib/icones.ts";
import { duracaoCurta } from "../lib/relogio.ts";
import { esc, hora, horaSemZero, iconeAgente } from "../lib/render.ts";
import { aberto, abertosDoBot, maquinasDe, meiaNoiteDe, memoriaDosBots, naFilaDaCota, pilulaDaCota, textoNaFilaDaCota, pilulaDasMaquinas, pilulaMac, ICONE_MEMORIA, leituraDoMac, maquinasDoAviso, rodandoNoMac, textoDaContagemDeMemoria, pontoTrabalho, seguradoPeloMac, situacaoDe, tempoDe, tituloCurto } from "../lib/trabalhos.ts";
import { agente, chipTrabalhosDoBot, segmentadoDosTrabalhos } from "./trabalhos.ts";

/**
 * O dono de cada bot na tela (definido em 2026-10-12, ADR-099 item 10, parte 5; protótipo docs/prototipos/um-dono-por-bot/,
 * quadros 01 e 05): o sinal do bot na barra lateral e a tela Trabalhos com uma linha por bot. As frases saem de
 * web/lib/dono.ts; aqui, o HTML. Servidor sem o dono (anterior ao I10): as telas de antes (o chip com o número, a lista por
 * task). A linha acima do campo virou a pílula que se alarga (chat limpo, PR 8: web/telas/pilula-do-bot.ts).
 */

type Agente = NonNullable<Estado["frota"]>["agentes"][number];

/** As decisões abertas do bot (a mais nova primeiro): o "Esperando você" leva até a mensagem dela na conversa. */
function decisoesDoBot(estado: Estado, agenteId: string): { id: string; frase: string; desde: number; tipo: string }[] {
  const itens = (estado.suaVez?.itens ?? []).filter((i) => i.decisao.agenteId === agenteId && i.estadoColuna !== "vencido");
  return itens.map((i) => ({ id: i.decisao.id, frase: i.decisao.frase, desde: Date.parse(i.decisao.criadoEm), tipo: i.decisao.tipo })).sort((a, b) => b.desde - a.desde);
}

/** Paper 16 (rodada 3): "1 aprovação", "2 pedidos" — o que o bot sem frente pede da pessoa, à direita da linha. */
function pedidosDoBot(ds: readonly { tipo: string }[]): string {
  if (!ds.length) return "";
  const todos = ds.every((d) => d.tipo === "aprovacao");
  return todos ? plural(ds.length, "aprovação", "aprovações") : plural(ds.length, "pedido", "pedidos");
}
const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

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
    ? `${disco.ehMac ? "Pouco espaço no disco do seu Mac" : `Pouco espaço no disco em ${disco.nome}`} · nenhuma task nova começa`
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

// ---- Trabalhos com uma linha por bot (quadro 05) ----------------------------------------------------------------------

const GRUPOS: { chave: GrupoDoBot; titulo: string }[] = [
  { chave: "precisa", titulo: "Precisa de você" },
  { chave: "trabalhando", titulo: "Trabalhando" },
  { chave: "esperando", titulo: "Esperando" },
];

type LinhaDoBot = { bot: Agente; dono: DonoDto; linha: LinhaDoDono; grupo: GrupoDoBot };

/** A frase e o detalhe curto do bot em Trabalhos: a pergunta (ou "Esperando você"), a frente que trabalha, a espera. */
function fraseDoBot(estado: Estado, x: LinhaDoBot, todos: readonly TrabalhoDto[]): { frase: string; detalhe: string; tempo: string } {
  const e = x.dono.estado;
  const desde = e.desde ?? estado.agora;
  // Paper 16 (rodada 3 da casca): à direita, a contagem curta ("4 frentes", "1 frente", "1 aprovação") e o tempo — "desde
  // 10:05" para quem tem frentes, "há 3 min" para o pedido sem frente; o resto (esperas, fila) fica no title da linha.
  const frentes = e.frentes > 0 ? plural(e.frentes, "frente", "frentes") : "";
  if (x.grupo === "precisa") {
    const ds = decisoesDoBot(estado, x.bot.id);
    const d = ds[0];
    // A frase da fila da pergunta é "parei para perguntar a Marlon: <a pergunta>"; aqui só a pergunta.
    const frase = d?.frase.replace(/^parei para perguntar a [^:]{1,60}:\s*/, "") || "Esperando você";
    if (frentes) return { frase, detalhe: frentes, tempo: `desde ${horaSemZero(desde)}` };
    const pedido = ds.length ? Math.min(...ds.map((x) => x.desde)) : desde;
    return { frase, detalhe: pedidosDoBot(ds) || x.linha.extras.join(" · "), tempo: `há ${duracaoCurta(estado.agora - pedido)}` };
  }
  if (x.grupo === "trabalhando") {
    // Uma frente só trabalhando: o título dela é a frase (quadro 05); mais de uma, o título da mais antiga e "· N frentes"
    // à direita (Paper 16: "Protótipo da pílula · exportando as telas", "2 frentes").
    const vivas = todos.filter((t) => t.agenteId === x.bot.id && t.estado === "rodando" && t.turnoVivoId).sort((a, b) => (a.iniciadoEm ?? a.criadoEm) - (b.iniciadoEm ?? b.criadoEm));
    const [primeira] = vivas;
    const frase = primeira ? `${tituloCurto(primeira.titulo)}${primeira.ultimoPasso && vivas.length > 1 ? ` · ${primeira.ultimoPasso.charAt(0).toLowerCase()}${primeira.ultimoPasso.slice(1)}` : ""}` : x.linha.texto;
    // Paper 16: a que começou há menos de uma hora diz "há 12 min"; a mais antiga, "desde 9:14".
    const recente = estado.agora - desde < 60 * 60_000;
    return { frase, detalhe: frentes || x.linha.extras.join(" · "), tempo: recente ? `há ${duracaoCurta(estado.agora - desde)}` : `desde ${horaSemZero(desde)}` };
  }
  // Esperando: o tempo já vai à direita ("desde 17:58"); a duração sai do detalhe. NOD-377: a única espera, de colega
  // vencida, diz "sem resposta há 26h" no lugar do "desde".
  // Revisão do PR #544: com a ação local por cima (a cobrada já não está vencida; a desistida sai).
  const esperas = x.dono.esperas.map((e) => comAcaoLocal(e)).filter((e) => e !== null);
  const [unica] = esperas;
  const vencida = esperas.length === 1 && unica?.tipo === "colega" && unica.colega?.vencida === true && unica.colega.tarefaId ? esperaNaTela(unica, estado.agora).colega?.resumo : undefined;
  // Paper 16: "38 min  desde 10:31" — a duração da espera fica à direita, antes do "desde".
  return { frase: x.linha.texto, detalhe: x.linha.extras.join(" · "), tempo: vencida ?? `desde ${horaSemZero(desde)}` };
}

/** "2 bots trabalhando · 1 esperando · 1 precisa de você" e, quando há leitura, a memória dos bots em cada máquina. */
function resumoPorBot(linhas: readonly LinhaDoBot[], memoria: string): string {
  const n = (g: GrupoDoBot) => linhas.filter((l) => l.grupo === g).length;
  const t = n("trabalhando");
  const partes = [
    `${t} ${t === 1 ? "bot trabalhando" : "bots trabalhando"}`,
    n("esperando") ? `${n("esperando")} esperando` : "",
    n("precisa") ? `${n("precisa")} ${n("precisa") === 1 ? "precisa" : "precisam"} de você` : "",
    memoria,
  ];
  return partes.filter(Boolean).join(" · ");
}

/**
 * Trabalhos com uma linha por bot (ADR-099 item 10): Precisa de você, Trabalhando e Esperando (pelo sinal da linha do
 * dono), e "Livres: …" numa linha no fim. Cada linha: ponto, mascote, nome, a frase e o detalhe curto, o tempo; o clique
 * abre as frentes do bot embaixo dela (quadro 05). As pílulas da cota e das máquinas ficam no topo
 * (NOD-369: o custo de hoje saiu).
 */
export function renderTrabalhosPorBot(estado: Estado): string {
  if (!estado.trabalhos) return '<section class="tela-trabalhos"><p class="mudo">carregando…</p></section>';
  const todos = estado.trabalhos.trabalhos;
  const linhas: LinhaDoBot[] = [];
  const livres: Agente[] = [];
  for (const dono of estado.trabalhos.donos ?? []) {
    const bot = agente(estado, dono.estado.agenteId);
    if (!bot) continue;
    const vivaAgora = conversaViva(estado, bot.conversaId);
    const viva = { ...dono, estado: { ...dono.estado, conversaTrabalhando: vivaAgora, conversaPropriaTrabalhando: vivaAgora } };
    const linha = linhaDoDono(viva, estado.agora, { comConversa: true });
    const grupo = grupoDaLinha(linha);
    if (linha && grupo) linhas.push({ bot, dono: viva, linha, grupo });
    else livres.push(bot);
  }
  const secoes = GRUPOS.map((g) => {
    // Paper 16: em "Precisa de você", a ordem é a do pedido mais antigo (a aprovação de 3 min antes da pergunta de agora).
    const pedidos = (l: LinhaDoBot) => decisoesDoBot(estado, l.bot.id).map((d) => d.desde);
    const chave = (l: LinhaDoBot): number => (g.chave === "precisa" && pedidos(l).length ? Math.min(...pedidos(l)) : l.dono.estado.desde ?? 0);
    const doGrupo = linhas.filter((l) => l.grupo === g.chave).sort((a, b) => chave(a) - chave(b));
    if (!doGrupo.length) return "";
    return `<section class="tt-grupo tb-grupo" data-grupo="${g.chave}"><h2>${g.titulo} <span class="tb-conta">${doGrupo.length}</span></h2><div class="tt-lista">${doGrupo.map((x) => linhaDoBot(estado, x, todos)).join("")}</div></section>`;
  }).join("");
  // Paper 16: "Livres" são todos os bots sem linha, não só os donos sem nada (o bot que nunca trabalhou também está livre).
  const comLinha = new Set([...linhas.map((l) => l.bot.id), ...livres.map((b) => b.id)]);
  for (const b of estado.frota?.agentes ?? []) if (!comLinha.has(b.id) && b.papel !== "nod") livres.push(b);
  const nomesLivres = livres.map((b) => b.nome);
  // ADR-167 (Paper 16): "Livres", os mascotes e os nomes (até três, depois "e mais N").
  const nomes = nomesLivres.length > 4 ? `${nomesLivres.slice(0, 3).join(", ")} e mais ${nomesLivres.length - 3}` : nomesLivres.join(", ");
  const livresHtml = nomesLivres.length ? `<p class="tb-livres"><span class="tb-livres-rot">Livres</span><span class="tb-livres-av" aria-hidden="true">${livres.map((b) => iconeAgente(b, "sm")).join("")}</span><span class="tb-livres-nomes">${esc(nomes)}</span></p>` : "";
  const vazio = linhas.length ? "" : `<p class="tt-vazio">Nenhum bot está trabalhando agora. Quando um bot começar uma frente, esperar algo ou precisar de você, aparece aqui.</p>`;
  return `<section class="tela-trabalhos" aria-label="Trabalhos">
    <header class="tt-cab"><div><h1>Trabalhos</h1><p>${esc(resumoPorBot(linhas, memoriaDosBots(estado.trabalhos)))}</p></div>${segmentadoDosTrabalhos(true)}</header>
    ${pilulaDaCota(estado.trabalhos.cota, todos, estado.agora, estado.trabalhos.pedidosNaFila)}${pilulaDoTopo(estado)}
    ${secoes}${vazio}${livresHtml}
  </section>`;
}

/** A pílula das máquinas ou da memória no topo (a mesma regra de "Todos os trabalhos": o disco primeiro, uma pílula só). */
function pilulaDoTopo(estado: Estado): string {
  const dto = estado.trabalhos;
  if (!dto) return "";
  const todos = dto.trabalhos;
  const abertos = todos.filter(aberto).length;
  const segurando = dto.segurando === true;
  const maquinas = maquinasDe(dto);
  if (maquinas) return pilulaDasMaquinas(maquinas.filter((m) => m.motivoEspera === "disco"), todos) || faixaDeMemoria(leituraDoMac(dto).pressao, rodandoNoMac(todos).length, "rodando") || pilulaDasMaquinas(maquinasDoAviso(maquinas, todos), todos);
  const motivo = dto.motivoEspera ?? null;
  const esperam = todos.filter((t) => seguradoPeloMac(t, segurando)).length;
  return (motivo === "disco" ? pilulaMac(segurando, esperam, true, motivo) : "") || faixaDeMemoria(estado.pressao ?? dto.pressao ?? null, abertos, "abertos") || pilulaMac(segurando, esperam, true, motivo);
}

/**
 * Paper 16 (rodada 3 da casca): em Trabalhos a memória é a faixa cinza da largura da tela — "Seu Mac está com pouca
 * memória · 9 frentes rodando aqui" e "Ver ›" (abre Máquinas › este Mac). A vermelha diz "quase sem memória" e é alerta.
 */
function faixaDeMemoria(nivel: string | null, n: number, rotulo: "rodando" | "abertos"): string {
  if (nivel !== "amarela" && nivel !== "vermelha") return "";
  if (rotulo === "rodando" && n <= 0) return "";
  const conta = rotulo === "rodando" ? `${n} ${n === 1 ? "frente rodando" : "frentes rodando"} aqui` : `${n} ${n === 1 ? "frente aberta" : "frentes abertas"}`;
  const frase = nivel === "amarela" ? "Seu Mac está com pouca memória · " : "Seu Mac está quase sem memória · pode travar; ";
  return `<button type="button" class="tb-faixa-memoria ${nivel}" data-act="secao-espaco" data-secao="este-mac"${nivel === "vermelha" ? ' role="alert"' : ""}>${ICONE_MEMORIA}<span class="tb-faixa-txt">${frase}${esc(conta)}</span><span class="tb-faixa-ver">Ver${ICONE.seta}</span></button>`;
}

function linhaDoBot(estado: Estado, x: LinhaDoBot, todos: readonly TrabalhoDto[]): string {
  const { frase, detalhe, tempo } = fraseDoBot(estado, x, todos);
  const aberta = estado.botAbertoEmTrabalhos === x.bot.id;
  const ponto = x.linha.sinal === "voce" ? "precisa" : x.linha.sinal === "vivo" ? `${esc(x.bot.cor)} pulso-trab` : "fora-do-mac";
  // Paper 16: com 2 ou mais frentes trabalhando, o número antes do ponto ("2 ●").
  const n = x.linha.sinal === "vivo" && x.dono.estado.frentes > 1 ? `<span class="tb-n" aria-hidden="true">${x.dono.estado.frentes}</span>` : "";
  // ADR-167 (Paper 16): ponto, mascote, "Nome  Título" e a frase embaixo (laranja quando precisa de você); à direita o
  // detalhe curto ("4 frentes"), o tempo e a seta.
  const linha = `<button type="button" class="tt-linha tb-linha" data-act="bot-trabalhos" data-agente="${esc(x.bot.id)}" aria-expanded="${aberta}" data-grupo="${x.grupo}">${n}<span class="ponto-trabalho ${ponto}" aria-hidden="true"></span>${iconeAgente(x.bot, "sm", x.grupo === "trabalhando" ? "trabalhando" : x.grupo === "precisa" ? "aguardando" : "disponivel")}<span class="tb-meio"><span class="tb-nome"><b>${esc(x.bot.nome)}</b>${x.bot.titulo ? `<small>${esc(x.bot.titulo)}</small>` : ""}</span><span class="tb-frase">${esc(frase)}</span></span>${detalhe ? `<span class="tb-detalhe">${esc(detalhe)}</span>` : ""}<span class="tt-fim">${esc(tempo)}</span>${aberta ? ICONE.recolher : ICONE.seta}</button>`;
  return aberta ? linha + frentesAbertasDoBot(estado, x, todos) : linha;
}

/** As frentes do bot aberto em Trabalhos (quadro 05): abertas, terminadas hoje, as esperas da conversa e a fila. */
function frentesAbertasDoBot(estado: Estado, x: LinhaDoBot, todos: readonly TrabalhoDto[]): string {
  const { abertas, terminadas } = frentesDoBot(todos, x.bot.id, meiaNoiteDe(estado.agora));
  const frente = (t: TrabalhoDto): string => {
    // Paper 16 (rodada 3): o título e, embaixo, o passo (a pergunta em laranja); à direita só o tempo ("agora", "4 min").
    const tempo = tempoDe(t, estado.agora);
    const fim = aberto(t) ? (t.estado === "na_fila" ? "na fila" : /^(0 min|menos de 1 min)$/.test(tempo) ? "agora" : tempo) : hora(t.terminadoEm ?? t.criadoEm);
    // Revisão do Gil no #340: a linha corta com reticências e o fim (a hora da volta) some primeiro — o title mostra a frase inteira.
    const situacao = aberto(t) ? situacaoDe(t, todos, false, estado.agora) : "";
    const passo = situacao ? situacao.charAt(0).toUpperCase() + situacao.slice(1) : "";
    return `<button type="button" class="tb-frente" data-act="abrir-trabalho" data-id="${esc(t.id)}"${t.estado === "precisa_de_voce" ? ' data-pede="1"' : ""}>${pontoTrabalho(t, x.bot.cor)}<span class="tb-frente-txt"><span class="tb-frente-titulo">${esc(tituloCurto(t.titulo))}</span><span class="tb-frente-passo"${passo ? ` title="${esc(passo)}"` : ""}>${esc(passo)}</span></span><span class="tb-frente-fim">${esc(fim)}</span></button>`;
  };
  const daConversa = x.dono.esperas.filter((e) => e.trabalhoId === null).map((d) => comAcaoLocal(d)).filter((e) => e !== null).map((e) => {
    const v = esperaNaTela(e, estado.agora);
    const c = v.colega;
    // NOD-377 (protótipo, passo 10): vencida, "sem resposta há 26h" à direita e a linha de Cobrar/Desistir embaixo.
    const fim = c?.vencida ? c.resumo : v.tempo;
    const passo = c?.resumo && !c.vencida ? `${c.resumo} · ${v.linhas.at(-1) ?? ""}` : v.linhas.at(-1) ?? "";
    const acoes = c?.acoes ? htmlDasAcoes({ agenteId: x.bot.id, tarefaId: c.tarefaId, colega: c.nome, podeCobrar: c.podeCobrar, fase: acaoLocal.fase(c.tarefaId), classe: "p377-acoes-tb" }) : "";
    return `<div class="tb-frente estatica${c?.vencida ? " p377-frente" : ""}"><span class="ponto-trabalho fora-do-mac" aria-hidden="true"></span><span class="tb-frente-titulo">${esc(v.titulo)}</span><span class="tb-frente-passo">${esc(passo)}</span><span class="tb-frente-fim${c?.vencida ? " p377-venc" : ""}">${esc(fim)}</span></div>${acoes}`;
  }).join("");
  const fila = x.dono.fila.map((p, i) => {
    // NOD-302: o pedido que a cota da IA segura diz "na fila (cota)" e quando volta.
    const cota = naFilaDaCota(estado.trabalhos, p.turnoId);
    return `<div class="tb-frente estatica"${cota ? ' data-cota="1"' : ""}><span class="ld-ordem" aria-hidden="true">${i + 1}</span><span class="tb-frente-titulo">Na fila: ${esc(quemPediu(p))}</span><span class="tb-frente-passo">${cota ? esc(textoNaFilaDaCota(cota, estado.agora)) : ""}</span><span class="tb-frente-fim">${esc(hora(p.desde))}</span></div>`;
  }).join("");
  // Paper 16 (rodada 3): só o que está aberto — as terminadas de hoje ficam na tela "Por frente" e na conversa.
  void terminadas;
  const corpo = [...abertas.map(frente), daConversa, fila].join("");
  const conversa = `<button type="button" class="tb-abrir-conversa" data-act="abrir-conversa" data-conversa="${esc(x.bot.conversaId)}" data-agente="${esc(x.bot.id)}">Abrir a conversa com ${esc(x.bot.nome)} ›</button>`;
  return `<div class="tb-frentes" role="group" aria-label="Frentes de ${esc(x.bot.nome)}">${corpo || '<p class="tb-sub">Nenhuma frente hoje.</p>'}${conversa}</div>`;
}
