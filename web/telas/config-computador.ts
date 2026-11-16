import type { LugarDoComputador } from "../../src/contracts/computador.ts";
import type { Estado } from "../estado/reducer.ts";
import { explicarComputador, htmlMiniatura, situacaoDaPessoa, TENTAR_V2, type EstadoDaMiniatura } from "../lib/computador-estados.ts";
import { dicaDaOperacao, horaCurta, htmlDialogoDoPainel, ICONE_CB, link, pctDaOperacao, preparoAtivo, tamanhoEmPalavras, textoAppDesatualizado, type ComputadorPessoaDto, type ComputadorUi, type OperacaoPessoa, type TelaDaPessoa } from "../lib/computador-pessoa.ts";
import { ICONE } from "../lib/icones.ts";
import { htmlMascote } from "../lib/mascote.ts";
import { esc } from "../lib/render.ts";
import { botsDaPessoa } from "./maquinas.ts";

/**
 * Especificação D, item 7 (2026-11-12): Configurações › Computador, logo depois de Máquinas. O painel "Computador do
 * bot" que morava embaixo de Máquinas veio para cá, em cinco grupos: Computador dos bots (a miniatura do item 2 e a
 * memória), Telas abertas (Abrir leva à tela cheia), Onde o computador mora, Manutenção e Logins. A "Atividade" de antes
 * saiu (fica na Atividade do bot). Os botões fazem o que faziam: `operar-computador` (Redefinir, Sair de todos e
 * Esquecer senhas confirmam pelos diálogos de sempre, htmlDialogoDoPainel), `abrir-computador` e a troca de lugar.
 */

type Bot = ReturnType<typeof botsDaPessoa>[number];

const ROTULO_DO_LUGAR: Readonly<Record<LugarDoComputador["tipo"], string>> = {
  onde_o_nod_roda: "Onde o nod roda",
  este_mac: "Este Mac",
  outra_maquina: "Outra máquina sua",
};

/** O valor do seletor "Onde o computador mora" que leva a conectar uma máquina nova (não há outra ainda). */
export const LUGAR_CONECTAR = "__conectar";

/** Os textos de Manutenção e Logins (os de hoje; os botões e as confirmações não mudam). */
export const ACOES_DO_COMPUTADOR: readonly { op: OperacaoPessoa; grupo: "Manutenção" | "Logins"; titulo: string; texto: string; botao: string }[] = [
  { op: "atualizar", grupo: "Manutenção", titulo: "Atualizar o computador", texto: "Reinicia o computador com a versão mais nova. Arquivos e logins ficam.", botao: "Atualizar" },
  { op: "redefinir", grupo: "Manutenção", titulo: "Redefinir o computador", texto: "Recria o computador do zero: apaga os arquivos e o que foi instalado. Os logins ficam.", botao: "Redefinir…" },
  { op: "sair_de_todos", grupo: "Logins", titulo: "Sair de todos os sites", texto: "Seus bots saem de todas as contas em que entraram neste computador.", botao: "Sair de todos…" },
  { op: "esquecer_senhas", grupo: "Logins", titulo: "Esquecer senhas salvas", texto: "Apaga as senhas que o Chrome guardou. Os bots deixam de entrar sozinhos quando a sessão expirar.", botao: "Esquecer senhas…" },
];

/** A tela de um bot está ativa (aberta, abrindo ou com a pessoa no controle) ou só aberta, em repouso. */
function telaAtiva(t: TelaDaPessoa): boolean {
  return t.estado === "abrindo" || t.estado === "esperando" || t.controle === "pessoa" || (t.estado === "aberta" && t.ultimaAcaoEm != null && Date.now() - t.ultimaAcaoEm < 60_000);
}

/** O estado do computador inteiro, nas palavras do item 2 (sem as esperas do cartão de cada bot). */
export function estadoDoComputadorDosBots(dto: ComputadorPessoaDto): EstadoDaMiniatura {
  if (dto.estado === "fora_do_ar" || dto.semContatoDesde != null) return "fora";
  if (dto.estado === "ligando" || dto.operacao) return "ligando";
  return dto.telas.some((t) => t.estado !== "fechada" && telaAtiva(t)) ? "ativo" : "repouso";
}

const PALAVRA: Readonly<Record<EstadoDaMiniatura, string>> = { repouso: "Em repouso", ativo: "Ativo", ligando: "Ligando…", fora: "Fora do ar" };

function memoria(dto: ComputadorPessoaDto): string {
  const m = dto.memoria;
  if (!m || m.totalMb <= 0) return "";
  return `${tamanhoEmPalavras(m.usadaMb * 1024 ** 2)} de ${tamanhoEmPalavras(m.totalMb * 1024 ** 2)}`;
}

const grupo = (titulo: string, corpo: string, id = ""): string =>
  `<section class="cpc-grupo"${id ? ` aria-labelledby="${id}"` : ""}><h3 class="cpc-grupo-tit"${id ? ` id="${id}"` : ""}>${esc(titulo)}</h3><div class="cpc-cartao">${corpo}</div></section>`;

const linha = (p: { ic?: string; titulo: string; texto?: string; extra?: string; lado?: string; attrs?: string; classe?: string; selo?: string }): string =>
  `<div class="cpc-linha${p.classe ? ` ${p.classe}` : ""}"${p.attrs ? ` ${p.attrs}` : ""}>${p.ic ?? ""}<span class="cpc-txt"><b>${esc(p.titulo)}${p.selo ? ` <span class="cpc-selo">${esc(p.selo)}</span>` : ""}</b>${p.texto ? `<span>${p.texto}</span>` : ""}${p.extra ?? ""}</span>${p.lado ?? ""}</div>`;

const botao = (rotulo: string, attrs: string, desabilitado = false): string =>
  `<button type="button" class="cpc-bt" ${attrs}${desabilitado ? " disabled" : ""}>${esc(rotulo)}</button>`;

function grupoDoComputador(dto: ComputadorPessoaDto, bots: readonly Bot[]): string {
  const estado = estadoDoComputadorDosBots(dto);
  const ativo = dto.telas.find((t) => t.estado !== "fechada" && telaAtiva(t));
  const dono = (ativo && bots.find((b) => b.id === ativo.agenteId)) ?? bots[0];
  const mini = htmlMiniatura(estado, { nome: dono?.nome ?? "Computador", cor: estado === "ativo" ? (dono?.cor ?? "c-gray") : "c-gray", forma: dono?.forma ?? "" });
  // Item 8 (Acessos · computador): o motivo junto do "Fora do ar desde 14:02" e, no app do Mac, a barra do download.
  const ex = explicarComputador(situacaoDaPessoa(dto), "O bot");
  const palavra = estado === "fora" && ex?.caso === "fora" && ex.desde !== null ? `Fora do ar desde ${horaCurta(ex.desde)}` : PALAVRA[estado];
  const partes = [dto.operacao ? (dicaDaOperacao(dto) ?? palavra) : palavra, memoria(dto)].filter(Boolean).join(" · ");
  const extra = estado === "fora" && ex?.caso === "fora"
    ? `<span class="cpc-detalhe">${esc(`${ex.detalhe ?? "O computador parou de responder."} Enquanto isso, os bots trabalham sem ele.`)}</span>`
    : !dto.operacao && (ex?.caso === "baixando" || ex?.caso === "pausado") && ex.detalhe
      ? `<span class="cpc-detalhe">${esc(ex.detalhe)}${ex.caso === "pausado" ? ` ${link("tentar agora", 'data-act="vm-tentar-agora"')}` : ""}</span>`
      : "";
  const pct = dto.operacao ? pctDaOperacao(dto) : ex?.caso === "baixando" || ex?.caso === "pausado" ? ex.progresso?.pct ?? 0 : null;
  const progresso = pct !== null
    ? `<div class="cpc-progresso" role="progressbar" aria-label="${dto.operacao ? "Progresso" : "Baixando o computador"}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>`
    : "";
  return grupo("Computador dos bots", linha({ ic: mini, titulo: "Computador dos bots", texto: esc(partes), extra, classe: "cpc-pc", ...(estado === "fora" ? { lado: `<span class="cpc-lado">${botao("Tentar de novo", TENTAR_V2)}</span>` } : {}) }) + progresso);
}

function grupoDasTelas(dto: ComputadorPessoaDto, bots: readonly Bot[]): string {
  const telas = dto.telas.filter((t) => t.estado !== "fechada");
  const fora = estadoDoComputadorDosBots(dto) === "fora";
  const linhas = telas.map((t) => {
    const b = bots.find((x) => x.id === t.agenteId);
    const nome = b?.nome ?? "Bot";
    const ativa = telaAtiva(t);
    // Item 8: com o computador fora do ar, a tela não está "Ativa": ela espera o computador voltar.
    const rotulo = fora ? "Esperando o computador" : ativa ? "Ativo" : "Em repouso";
    const sub = `<i class="cpc-ponto${ativa && !fora ? " ativo" : ""}" aria-hidden="true"></i>${esc(t.titulo && (ativa || fora) ? `${rotulo} · ${t.titulo}` : rotulo)}`;
    return linha({ ic: b ? `<span class="cpc-avatar">${htmlMascote(b, "sm", "disponivel", 'aria-hidden="true"').replace(' role="img"', "")}</span>` : "", titulo: nome, texto: sub, lado: botao("Abrir", `data-act="abrir-computador" data-id="${esc(t.agenteId)}" aria-label="${esc(`Abrir a tela de ${nome}`)}"`), classe: "cpc-tela" });
  }).join("");
  const esperando = dto.esperando.map((id) => bots.find((b) => b.id === id)?.nome ?? "Bot");
  const vazio = `<p class="cpc-vazio">${dto.estado === "dormindo" ? "O computador está em repouso. Nenhuma tela aberta." : "Nenhum bot está usando o navegador agora."}</p>`;
  const espera = esperando.length ? `<p class="cpc-vazio">${esc(`Esperando uma tela livre: ${new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" }).format(esperando)}.`)}</p>` : "";
  return grupo("Telas abertas", (linhas || vazio) + espera);
}

function grupoDoLugar(dto: ComputadorPessoaDto, ui: ComputadorUi, agora: number): string {
  const lugares = dto.lugares ?? [];
  const atual = lugares.find((l) => l.atual);
  const nome = dto.maquina?.nome ?? atual?.nome ?? "Computador";
  const online = dto.semContatoDesde != null || atual?.conectada === false
    ? `Sem contato${dto.semContatoDesde != null ? ` desde ${new Date(dto.semContatoDesde).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}`
    : dto.maquina?.contato != null && agora - dto.maquina.contato < 5 * 60_000 ? "Online agora" : "Online";
  const texto = [atual ? ROTULO_DO_LUGAR[atual.tipo] : "", online].filter(Boolean).join(" · ");
  const emCurso = Boolean(dto.operacao) || dto.estado === "ligando";
  const opcoes = lugares.map((l) => `<option value="${esc(l.maquinaId)}"${l.atual ? " selected" : ""}${!l.atual && !l.pronta ? " disabled" : ""}>${esc(lugares.filter((x) => x.tipo === l.tipo).length > 1 ? `${ROTULO_DO_LUGAR[l.tipo]} · ${l.nome}` : ROTULO_DO_LUGAR[l.tipo])}</option>`).join("")
    + (lugares.some((l) => l.tipo === "outra_maquina") ? "" : `<option value="${LUGAR_CONECTAR}">${ROTULO_DO_LUGAR.outra_maquina}</option>`);
  const seletor = lugares.length
    ? `<span class="cpc-seletor"><select aria-label="Onde o computador mora" data-act-change="pc-lugar"${emCurso ? " disabled" : ""}>${opcoes}</select><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5"/></svg></span>`
    : "";
  const recusa = ui.recusaDaTroca
    ? `<p class="cpc-recusa" role="alert">${esc(ui.recusaDaTroca.texto)} · ${link("Trocar sem os logins", `data-act="pc-trocar-sem-logins" data-maquina="${esc(ui.recusaDaTroca.maquinaId)}"`)}</p>`
    : "";
  return grupo("Onde o computador mora", linha({ ic: `<span class="cpc-ic" aria-hidden="true">${ICONE.laptop}</span>`, titulo: nome, texto: esc(texto), lado: seletor, attrs: atual ? `data-pc-lugar="${esc(atual.maquinaId)}"` : "" }) + recusa, "pc-lugar-tit");
}

function grupoDeAcoes(dto: ComputadorPessoaDto, ui: ComputadorUi, g: "Manutenção" | "Logins"): string {
  const travado = Boolean(dto.operacao) || dto.estado === "ligando";
  const linhas = ACOES_DO_COMPUTADOR.filter((a) => a.grupo === g).map((a) => {
    const realce = ui.realce === a.op || (ui.realce === "tentar_de_novo" && a.op === "atualizar");
    return linha({ titulo: a.titulo, texto: esc(a.texto), lado: `<span class="cpc-lado">${botao(a.botao, `data-act="operar-computador" data-op="${a.op}"`, travado)}</span>`, attrs: `data-pc-acao="${a.op}"`, classe: realce ? "realce" : "" });
  }).join("");
  return grupo(g, linhas);
}

/** Configurações › Computador. Sem o computador da pessoa (o motor desligado), só a frase de que ainda não há. */
export function renderSecaoComputador(estado: Estado, avisoRecriadoDispensado = false): string {
  const dto = estado.computadorPessoa;
  const cab = `<h2 id="cpc-titulo" class="cpc-titulo">Computador</h2><p class="cpc-intro">Um computador para todos os seus bots. Cada bot tem a própria tela e o próprio navegador; um login feito aqui vale para todos.</p>`;
  if (!dto) return `<section class="espaco-secao cfg-secao cpc" aria-labelledby="cpc-titulo">${cab}<p class="cpc-vazio">O computador dos bots ainda não está ligado nesta conta.</p></section>`;
  const bots = botsDaPessoa(estado);
  const faixas = [
    dto.aviso_recriado && !avisoRecriadoDispensado ? faixa("Entre nos sites de novo uma vez", "O computador do bot foi recriado e os logins não vieram junto. Da próxima vez que um bot precisar de um site com login, ele pede para você entrar; o login vale para todos.", botao("Entendi", 'data-act="entendi-computador"')) : "",
    (() => { const app = textoAppDesatualizado(dto); return app ? faixa(app.titulo, esc(app.apoio), app.acoes.join("")) : ""; })(),
    // Item 8 (Acessos · computador): a faixa do macOS antigo volta, com o caminho da VM sempre ligada.
    preparoAtivo(dto)?.estado === "macos_antigo" ? faixa("O computador do bot pede macOS 13 ou mais novo", "Este Mac não roda o computador do bot. Numa VM Linux sempre ligada, ele roda.", link("Conectar uma VM", 'data-act="conectar-sempre-ligada"')) : "",
  ].join("");
  const grupos = [
    grupoDoComputador(dto, bots),
    grupoDasTelas(dto, bots),
    grupoDoLugar(dto, estado.computadorUi, estado.agora > 0 ? estado.agora : Date.now()),
    grupoDeAcoes(dto, estado.computadorUi, "Manutenção"),
    grupoDeAcoes(dto, estado.computadorUi, "Logins"),
  ].join("");
  return `<section class="espaco-secao cfg-secao cpc seu-pc" aria-labelledby="cpc-titulo">${cab}${faixas}<div class="cpc-grupos">${grupos}</div>${htmlDialogoDoPainel(dto, bots, estado.computadorUi)}</section>`;
}

function faixa(titulo: string, texto: string, acao: string): string {
  return `<div class="pc-faixa" role="status">${ICONE_CB.info}<div><b>${esc(titulo)}</b><p>${texto}</p></div>${acao}</div>`;
}
