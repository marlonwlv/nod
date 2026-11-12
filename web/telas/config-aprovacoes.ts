import type { AjustesAprovacao, ListaRegra, NivelFerramenta, RegraRevisor, TetoModo, TipoNivel } from "../../src/contracts/ajustes-aprovacao.ts";
import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import { ICONE } from "../lib/icones.ts";
import { botaoLinkDoAjuste, grupoConfig, linhaConfig, seletorLinha } from "../lib/linha-config.ts";
import { esc } from "../lib/render.ts";

/**
 * Configurações › Aprovações (definido em 2026-11-12, ADR-166; tela 07 do protótipo "nod x Grok Bot"). Uma seção, de cima
 * para baixo: os três modos (título + frase, Automático "Recomendado"), "Vale para" (Todos os bots ou um), o só leitura do
 * bot, o teto do admin, as duas listas de regras do revisor ("Sempre me pergunte" e "Pode fazer sem perguntar", N de 20) e o
 * nível de cada app, separado em leitura e escrita. Puro: recebe o estado da tela e devolve HTML; quem busca e grava é
 * web/lib/ajustes-aprovacao.ts. A web não importa valores de src: os rótulos se repetem aqui (o teste confere).
 */

export type BotDaTela = { id: string; nome: string; modo: ModoAprovacao };

export type TelaAprovacoes = {
  dados: AjustesAprovacao | null;
  carregando: boolean;
  erro: string | null;
  /** O "Vale para": null = Todos os bots. */
  agenteId: string | null;
  /** A regra em edição (id null = nova) e o texto digitado até agora. */
  editando: { lista: ListaRegra; id: string | null; texto: string } | null;
  /** O primeiro clique em Total pede o segundo (como o menu do campo, ADR-059). */
  confirmandoTotal: boolean;
};

/** Os códigos de erro do servidor em frase (a tabela de erros não vaza `cause`; aqui só o que a pessoa pode corrigir). */
export function fraseDoErro(e: unknown): string {
  const codigo = typeof e === "object" && e !== null && "codigo" in e ? String((e as { codigo: unknown }).codigo) : "";
  if (codigo === "nao_permitido") return "Só a dona do bot muda as aprovações dele.";
  if (codigo === "entrada_invalida") return "Não deu para salvar: confira o texto (até 1000 caracteres, sem repetir uma regra, até 20 por lista).";
  return "Não deu para salvar. Tente de novo.";
}

export const TELA_APROVACOES_INICIAL: TelaAprovacoes = { dados: null, carregando: false, erro: null, agenteId: null, editando: null, confirmandoTotal: false };

/** Os três modos como a tela 07 os diz (título + frase). */
export const MODOS_DA_TELA: readonly { modo: ModoAprovacao; titulo: string; frase: string; recomendado?: true }[] = [
  { modo: "manual", titulo: "Manual", frase: "Você aprova cada ação que sai do nod." },
  { modo: "automatico", titulo: "Automático", frase: "Um revisor confere cada ação e só pergunta o que as suas regras pedem.", recomendado: true },
  { modo: "total", titulo: "Total", frase: "Tudo roda sem perguntar e fica registrado na Atividade." },
];

export const TITULO_LISTA: Readonly<Record<ListaRegra, { titulo: string; frase: string; exemplo: string }>> = {
  perguntar: { titulo: "Sempre me pergunte", frase: "Para e pergunta quando uma ação bate com uma destas regras.", exemplo: "Ex.: Mandar e-mail para fora da empresa" },
  permitir: { titulo: "Pode fazer sem perguntar", frase: "Segue sozinho quando uma ação bate com uma destas regras.", exemplo: "Ex.: Comentar em PRs do repositório do time" },
};

export const NIVEIS_DA_TELA: readonly { nivel: NivelFerramenta; rotulo: string }[] = [
  { nivel: "revisor", rotulo: "O revisor decide" },
  { nivel: "sempre_permitir", rotulo: "Sempre permitir" },
  { nivel: "sempre_pedir", rotulo: "Sempre pedir" },
  { nivel: "bloqueado", rotulo: "Bloqueado" },
];

export const TETOS_DA_TELA: readonly { teto: TetoModo | ""; rotulo: string }[] = [
  { teto: "", rotulo: "Sem teto" },
  { teto: "automatico", rotulo: "Até Automático" },
  { teto: "manual", rotulo: "Só Manual" },
  { teto: "so_leitura", rotulo: "Só leitura" },
];

const NOME_DO_MODO: Readonly<Record<ModoAprovacao, string>> = { manual: "Manual", automatico: "Automático", total: "Total" };

/** O modo que a tela marca: o do bot escolhido; em Todos os bots, o comum a todos (ou nenhum, se estão misturados). */
export function modoMarcado(t: TelaAprovacoes, bots: readonly BotDaTela[]): ModoAprovacao | null {
  if (t.agenteId) return t.dados?.modoPedido ?? bots.find((b) => b.id === t.agenteId)?.modo ?? null;
  const modos = new Set(bots.map((b) => b.modo));
  return modos.size === 1 ? [...modos][0] ?? null : null;
}

function radioModo(m: (typeof MODOS_DA_TELA)[number], marcado: boolean, confirmando: boolean, bloqueado: boolean): string {
  const fraseTotal = confirmando ? "Clique de novo para confirmar: o bot roda tudo sem perguntar, até com as credenciais do seu Mac." : m.frase;
  return `<button type="button" class="apv-modo${marcado ? " apv-marcado" : ""}${m.modo === "total" && confirmando ? " apv-confirmando" : ""}" role="radio" aria-checked="${marcado}" data-act="apv-modo" data-modo="${m.modo}"${bloqueado ? " disabled" : ""}>
    <span class="apv-radio" aria-hidden="true"></span>
    <span class="apv-modo-txt"><b>${esc(m.titulo)}</b><small>${esc(m.modo === "total" ? fraseTotal : m.frase)}</small></span>
    ${m.recomendado ? '<span class="apv-selo">Recomendado</span>' : ""}
  </button>`;
}

function linhaRegra(r: RegraRevisor, herdada: boolean): string {
  const dados = ` data-regra="${esc(r.id)}" data-lista="${r.lista}"`;
  const acoes = herdada
    ? '<span class="apv-herdada">Todos os bots</span>'
    : `<span class="apv-regra-acoes"><button type="button" class="apv-icone" data-act="apv-editar-regra"${dados} aria-label="Editar regra" title="Editar">${ICONE.lapis}</button><button type="button" class="apv-icone" data-act="apv-apagar-regra"${dados} aria-label="Apagar regra" title="Apagar">${ICONE.lixo}</button></span>`;
  return `<div class="apv-regra${herdada ? " apv-regra-herdada" : ""}" id="apv-regra-${esc(r.id)}"><span class="apv-regra-txt">${esc(r.texto)}</span>${acoes}</div>`;
}

function campoRegra(lista: ListaRegra, texto: string, id: string | null, max: number): string {
  return `<div class="apv-regra apv-regra-campo" data-lista="${lista}"${id ? ` data-regra="${esc(id)}"` : ""}>
    <input class="apv-input" name="texto" maxlength="${max}" value="${esc(texto)}" placeholder="${esc(TITULO_LISTA[lista].exemplo)}" aria-label="${esc(TITULO_LISTA[lista].titulo)}: texto da regra" data-apv-campo="1" data-manter-foco="apv-regra" autocomplete="off">
    <button type="button" class="apv-botao apv-primario" data-act="apv-salvar-regra" data-lista="${lista}"${id ? ` data-regra="${esc(id)}"` : ""}>Salvar</button>
    <button type="button" class="apv-botao" data-act="apv-cancelar-regra">Cancelar</button>
  </div>`;
}

function blocoRegras(t: TelaAprovacoes, d: AjustesAprovacao, lista: ListaRegra): string {
  const proprias = (t.agenteId ? d.regras.doBot : d.regras.padrao).filter((r) => r.lista === lista);
  const herdadas = t.agenteId ? d.regras.padrao.filter((r) => r.lista === lista) : [];
  const max = d.limites.regrasPorLista;
  const cheia = proprias.length >= max;
  const ed = t.editando?.lista === lista ? t.editando : null;
  const linhas = [
    ...herdadas.map((r) => linhaRegra(r, true)),
    ...proprias.map((r) => (ed?.id === r.id ? campoRegra(lista, ed.texto, r.id, d.limites.caracteresPorRegra) : linhaRegra(r, false))),
    ...(ed && ed.id === null ? [campoRegra(lista, ed.texto, null, d.limites.caracteresPorRegra)] : []),
  ];
  const info = TITULO_LISTA[lista];
  const vazio = linhas.length === 0 ? `<p class="apv-vazio">Nenhuma regra ainda. ${esc(info.exemplo)}.</p>` : "";
  // Frente "igual ao Grok": o 1º bloco de regras é o alvo do link "regras-revisor" (web/lib/ajustes.ts).
  const ancora = lista === "perguntar" ? ' id="ajuste-regras-revisor" data-ajuste="regras-revisor"' : "";
  const link = lista === "perguntar" ? botaoLinkDoAjuste("regras-revisor", "Regras do revisor") : "";
  return `<section class="apv-bloco"${ancora} aria-labelledby="apv-tit-${lista}">
    <div class="apv-cabeca">
      <div class="apv-cabeca-txt"><h3 id="apv-tit-${lista}">${esc(info.titulo)}</h3><p>${esc(info.frase)}</p></div>${link}
      <span class="apv-conta">${proprias.length} de ${max}</span>
      <button type="button" class="apv-botao" data-act="apv-nova-regra" data-lista="${lista}"${cheia || ed ? " disabled" : ""}>${ICONE.mais}<span>Adicionar regra</span></button>
    </div>
    ${linhas.length ? `<div class="apv-lista">${linhas.join("")}</div>` : vazio}
  </section>`;
}

function linhaApp(d: AjustesAprovacao, app: { slug: string; nome: string }): string {
  const nivel = (tipo: TipoNivel) => d.niveis.find((n) => n.conector === app.slug && n.ferramenta === "" && n.tipo === tipo)?.nivel ?? "revisor";
  const seletor = (tipo: TipoNivel) => seletorLinha({
    tipo: "seletor",
    acao: "apv-nivel",
    rotulo: `${app.nome}: ${tipo === "leitura" ? "leitura" : "escrita"}`,
    dados: { conector: app.slug, tipo },
    opcoes: NIVEIS_DA_TELA.map((o) => ({ valor: o.nivel, rotulo: o.rotulo, selecionado: o.nivel === nivel(tipo) })),
  });
  return `<div class="lc-linha apv-app"><span class="lc-txt"><b>${esc(app.nome)}</b></span><span class="apv-app-ctrl"><label><small>Ler</small>${seletor("leitura")}</label><label><small>Mudar</small>${seletor("escrita")}</label></span></div>`;
}

export function renderConfigAprovacoes(t: TelaAprovacoes, bots: readonly BotDaTela[]): string {
  const d = t.dados;
  if (!d) {
    const corpo = t.erro ? `<p class="lc-vazio" role="alert">${esc(t.erro)} <button type="button" class="apv-link" data-act="apv-recarregar">Tentar de novo</button></p>` : '<p class="lc-vazio">Carregando…</p>';
    return `<section class="cfg-secao apv"><h2>Aprovações</h2>${corpo}</section>`;
  }
  const marcado = modoMarcado(t, bots);
  const limitado = d.teto && d.modoEfetivo && d.modoPedido && d.modoEfetivo !== d.modoPedido;
  const modos = `<div class="apv-modos" role="radiogroup" aria-label="Modo de aprovação">${MODOS_DA_TELA.map((m) => radioModo(m, marcado === m.modo, t.confirmandoTotal && m.modo === "total", bots.length === 0)).join("")}</div>`;
  const avisoTeto = d.teto
    ? `<p class="apv-aviso" role="note">${esc(d.teto === "so_leitura" ? "Seu admin deixou os bots do time em só leitura." : `Seu admin limitou os bots do time a ${NOME_DO_MODO[d.teto]}.`)}${limitado ? ` ${esc(`Este bot pediu ${NOME_DO_MODO[d.modoPedido!]} e roda em ${NOME_DO_MODO[d.modoEfetivo!]}.`)}` : ""}</p>`
    : "";
  const valePara = linhaConfig({
    titulo: "Vale para",
    detalhe: "Escolha se o que está abaixo vale para todos os bots ou só para um.",
    controle: { tipo: "seletor", acao: "apv-vale-para", rotulo: "Vale para", opcoes: [{ valor: "", rotulo: "Todos os bots", selecionado: t.agenteId === null }, ...bots.map((b) => ({ valor: b.id, rotulo: b.nome, selecionado: b.id === t.agenteId }))] },
  });
  const extras: string[] = [valePara];
  if (t.agenteId) {
    extras.push(linhaConfig({
      titulo: "Só leitura",
      ajuste: "so-leitura",
      detalhe: d.teto === "so_leitura" ? "O admin do time ligou o só leitura para todos os bots." : "O bot só lê: tudo que muda algo é barrado, sem cartão.",
      controle: { tipo: "switch", ligado: d.soLeitura || d.teto === "so_leitura", acao: "apv-so-leitura", desabilitado: d.teto === "so_leitura" },
    }));
  }
  if (d.admin) {
    extras.push(linhaConfig({
      titulo: "Teto do time",
      ajuste: "teto-do-time",
      detalhe: "Admin: o modo mais aberto que os bots do time podem usar.",
      controle: { tipo: "seletor", acao: "apv-teto", rotulo: "Teto do time", opcoes: TETOS_DA_TELA.map((o) => ({ valor: o.teto, rotulo: o.rotulo, selecionado: (d.teto ?? "") === o.teto })) },
    }));
  }
  const notaRevisor = d.revisorLigado ? "" : " O revisor ainda está desligado neste servidor: as regras ficam guardadas e passam a valer quando ele ligar.";
  const apps = d.apps.length
    ? `<div id="ajuste-nivel-por-app" data-ajuste="nivel-por-app">${grupoConfig("Por app", d.apps.map((a) => linhaApp(d, a)), { nota: "Ler e mudar têm níveis separados. Sempre permitir vale em turno limpo; depois de ler conteúdo de fora, o modo decide." }).replace("</h3>", `${botaoLinkDoAjuste("nivel-por-app", "Nível por app")}</h3>`)}</div>`
    : "";
  return `<section class="cfg-secao apv" aria-busy="${t.carregando}">
    <h2>Aprovações</h2>
    <div id="ajuste-aprovacoes-modo" data-ajuste="aprovacoes-modo">${modos}${botaoLinkDoAjuste("aprovacoes-modo", "Modo de aprovação")}</div>
    ${avisoTeto}
    <div class="lc-lista apv-extras">${extras.join("")}</div>
    ${blocoRegras(t, d, "perguntar")}
    ${blocoRegras(t, d, "permitir")}
    <p class="lc-nota apv-nota">As regras valem só no modo automático. Manual e Total não usam regras.${esc(notaRevisor)}</p>
    ${apps}
    ${t.erro ? `<p class="apv-erro" role="alert">${esc(t.erro)}</p>` : ""}
  </section>`;
}
