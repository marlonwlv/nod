import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { gruposDasTarefas, iniciaisDeVoce, quantasPerguntaram, rotuloDaLinha, resumoDosQuadros, type FiltrosDasTarefas, type GrupoDasTarefas, type LinhaDaTarefa, type VistaDasTarefas } from "../../lib/tarefas-de-todos.ts";
import type { TarefasDeTodosNaTela } from "../../lib/tarefas-de-todos-na-tela.ts";
import { iconeDaPrioridade } from "../../telas/opcoes-quadro.ts";
import { criarConversor, type ConversorDeHtml } from "../html/html-em-react.tsx";

/**
 * ADR-179 (as telas no lugar da conversa): Tarefas de todos os bots (tela 18d do Paper) em React. O mesmo DOM da tela por
 * string (web/telas/tarefas-de-todos.ts, que o controlador desenha no `#tdt` com `?telas-react=0`). O controlador
 * (web/lib/tarefas-de-todos-na-tela.ts) segue lendo os quadros e relendo no `quadro.mudou`; a tela assina o que ele leu
 * e guarda o estado de interface dela (Por quadro | Por bot | Minhas, a busca e os filtros). A busca é um campo do React:
 * digitar não regrava a tela inteira, então o foco e o cursor ficam sem guardar e devolver.
 */
export interface AcoesDasTarefas {
  fonte: Pick<TarefasDeTodosNaTela, "dados" | "assinar" | "tentarDeNovo"> & Partial<Pick<TarefasDeTodosNaTela, "escolhas" | "guardarEscolhas">>;
  /** O mascote do bot (o HTML do main). */
  avatar: (agenteId: string | null) => string;
  /** QA-181: o nome de quem lê (as iniciais do "Você" nas linhas sem bot; ausente = "V"). */
  voce?: () => string | null;
  abrirTarefa: (donoId: string, tarefaId: string, quadroId: string) => void;
  abrirPagina: (agenteId: string, quadroId: string | null) => void;
  agora?: () => number;
}

const svg = (d: string, w = 16): string =>
  `<svg width="${w}" height="${w}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  quadro: svg('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M6 2.5v11"/>', 15),
  mais: svg('<path d="M8 3v10M3 8h10"/>', 14),
  busca: svg('<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>', 14),
  filtro: svg('<path d="M3 4.5h10M5 8h6M7 11.5h2"/>', 14),
  sino: svg('<path d="M4 11V7.5a4 4 0 018 0V11l1 1.5H3z"/><path d="M6.5 14h3"/>', 12),
  seta: svg('<path d="M6 4l4 4-4 4"/>', 12),
} as const;
const VISTAS: readonly [VistaDasTarefas, string][] = [["quadro", "Por quadro"], ["bot", "Por bot"], ["minhas", "Minhas"]];

export function TelaTarefasDeTodos({ acoes }: { acoes: AcoesDasTarefas }) {
  const { quadros, erro } = useSyncExternalStore(acoes.fonte.assinar, acoes.fonte.dados, acoes.fonte.dados);
  // QA-147: começa no que a pessoa tinha escolhido (o controlador guarda entre aberturas) e guarda cada escolha.
  const [vista, setVista] = useState<VistaDasTarefas>(() => acoes.fonte.escolhas?.().vista ?? "quadro");
  const [filtros, setFiltros] = useState<FiltrosDasTarefas>(() => acoes.fonte.escolhas?.().filtros ?? { busca: "", emAberto: true, porPrioridade: false });
  const { guardarEscolhas } = acoes.fonte;
  useEffect(() => { guardarEscolhas?.(vista, filtros); }, [guardarEscolhas, vista, filtros]);
  const conversor = useRef<ConversorDeHtml | null>(null);
  conversor.current ??= criarConversor();
  useLayoutEffect(() => conversor.current?.fecharQuadro());
  const html = (h: string) => conversor.current!.converter(h);
  const agora = (acoes.agora ?? Date.now)();
  const pronto = !erro && quadros ? { grupos: gruposDasTarefas(quadros, vista, filtros, agora), resumo: resumoDosQuadros(quadros), perguntaram: quantasPerguntaram(quadros, agora), total: quadros.length } : null;
  let corpo;
  if (erro) corpo = <p className="tdt-erro" role="alert">{`${erro} `}<button type="button" className="tdt-link" onClick={acoes.fonte.tentarDeNovo}>Tentar de novo</button></p>;
  else if (!pronto) corpo = <div className="tdt-carregando" aria-busy="true"><div className="tdt-esq" /><div className="tdt-esq" /></div>;
  else if (pronto.total === 0) corpo = <p className="tdt-vazio">Nenhum bot tem quadro ainda. Peça a um bot para criar o dele, ou abra a página Quadro de um bot.</p>;
  else if (!pronto.grupos.some((g) => g.linhas.length)) corpo = <p className="tdt-vazio">{`Nenhum card ${vista === "minhas" ? "com você" : "com esse filtro"}.`}</p>;
  else corpo = pronto.grupos.map((g) => <Grupo key={`${g.quadroId ?? ""}|${g.agenteId ?? ""}|${g.nome}`} g={g} acoes={acoes} html={html} />);
  return (
    <div className="tdt">
      <div className="tdt-coluna">
        <header className="tdt-topo">
          <div className="tdt-titulos"><h1 className="tdt-h">Cards</h1><p className="tdt-sub">{`Os quadros de todos os seus bots num lugar só${pronto ? ` · ${pronto.resumo}` : ""}`}</p></div>
          <div className="tdt-seg" role="group" aria-label="Agrupar">
            {VISTAS.map(([v, r]) => <button key={v} type="button" className="tdt-seg-bt" aria-pressed={vista === v} onClick={() => setVista(v)}>{r}</button>)}
          </div>
          <button type="button" className="tdt-nova" onClick={() => { const q = quadros?.[0]?.quadro; if (q) acoes.abrirPagina(q.agenteId, q.id); }}>{html(IC.mais)}<span>Novo card</span></button>
        </header>
        <div className="tdt-filtros">
          <label className="tdt-busca">{html(IC.busca)}<input type="search" className="tdt-busca-campo" data-tdt="busca" placeholder="Buscar card por título ou código" value={filtros.busca}
            onChange={(e) => { const busca = e.currentTarget.value; setFiltros((f) => ({ ...f, busca })); }} aria-label="Buscar card por título ou código" /></label>
          <button type="button" className="tdt-filtro" aria-pressed={filtros.emAberto} onClick={() => setFiltros((f) => ({ ...f, emAberto: !f.emAberto }))}>{html(IC.filtro)}<span>{`Status: ${filtros.emAberto ? "em aberto" : "todas"}`}</span></button>
          <button type="button" className="tdt-filtro" aria-pressed={filtros.porPrioridade} onClick={() => setFiltros((f) => ({ ...f, porPrioridade: !f.porPrioridade }))}><span>Prioridade</span></button>
          <span className="tdt-esp" />
          {pronto && pronto.perguntaram > 0 && (
            <button type="button" className="tdt-perg" onClick={() => setVista("minhas")}>{html(IC.sino)}<span>{`${pronto.perguntaram} te ${pronto.perguntaram === 1 ? "perguntou" : "perguntaram"}`}</span></button>
          )}
        </div>
        <div className="tdt-grupos">{corpo}</div>
      </div>
    </div>
  );
}

type Conv = (h: string) => ReturnType<ConversorDeHtml["converter"]>;

function Grupo({ g, acoes, html }: { g: GrupoDasTarefas; acoes: AcoesDasTarefas; html: Conv }) {
  const nome = g.projeto !== null
    ? <><span className="tdt-proj">{g.projeto}</span><span className="tdt-sep" aria-hidden="true">/</span><span className="tdt-nome">{g.nome}</span></>
    : <span className="tdt-nome">{g.nome}</span>;
  const cab = g.agenteId
    ? (
      <button type="button" className="tdt-cab" data-agente={g.agenteId} data-quadro={g.quadroId ?? undefined} onClick={() => acoes.abrirPagina(g.agenteId!, g.quadroId ?? null)}>
        {html(IC.quadro)}{nome}<span className="tdt-av" aria-hidden="true">{html(acoes.avatar(g.agenteId))}</span><span className="tdt-pagina">{`página Quadro de ${g.agenteNome}`}</span>
        <span className="tdt-esp" />
        {g.progresso !== null && <><span className="tdt-prog" role="img" aria-label={`${g.progresso}% feito`}><i style={{ width: `${g.progresso}%` }} /></span><span className="tdt-pct" aria-hidden="true">{`${g.progresso}%`}</span></>}
        {html(IC.seta)}
      </button>
    )
    : <div className="tdt-cab">{html(IC.quadro)}{nome}<span className="tdt-esp" /></div>;
  return (
    <section className="tdt-grupo" aria-label={g.projeto ? `${g.projeto} / ${g.nome}` : g.nome}>
      {cab}
      {g.linhas.length ? <ul className="tdt-linhas">{g.linhas.map((l) => <Linha key={`${l.quadroId}|${l.id}`} l={l} acoes={acoes} html={html} />)}</ul> : <p className="tdt-vazio-grupo">Nada em aberto neste quadro.</p>}
    </section>
  );
}

function Linha({ l, acoes, html }: { l: LinhaDaTarefa; acoes: AcoesDasTarefas; html: Conv }) {
  return (
    <li className="tdt-linha">
      <button type="button" className="tdt-linha-bt" data-tarefa={l.id} data-quadro={l.quadroId} data-dono={l.donoId} onClick={() => acoes.abrirTarefa(l.donoId, l.id, l.quadroId)}
        aria-label={rotuloDaLinha(l)}>
        {html(iconeDaPrioridade(l.prioridade))}<span className="tdt-cod">{l.codigo}</span><span className="tdt-tit">{l.titulo}</span>
        <span className="tdt-col"><i className={`tdt-ponto tdt-ponto-${l.tom}`} aria-hidden="true" />{l.coluna}</span>
        <span className="tdt-quem">{l.agenteId
          ? <><span className="tdt-av" aria-hidden="true">{html(acoes.avatar(l.agenteId))}</span><span className="tdt-quem-nome">{l.agenteNome ?? ""}</span></>
          : <><span className="tdt-voce" aria-hidden="true">{iniciaisDeVoce(acoes.voce?.())}</span><span className="tdt-quem-nome">Você</span></>}</span>
        <span className={`tdt-dir${l.direita.tom === "aguardando" ? " tdt-dir-aguardando" : ""}`}>{l.direita.texto}</span>
      </button>
    </li>
  );
}
