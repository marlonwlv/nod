import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { buscar, categoriasDosChips, detalheDaLinha, estaConectado, milhar, POR_PAGINA, secoesDoInicio, tituloDaLista } from "./modelo.ts";
import { IconeAbaixo, IconeBusca, IconeFechar, IconeSeguir, IconeVoltar, Logo } from "./pecas.tsx";
import type { AppDaVitrine, FotoDoMarketplace } from "./tipos.ts";

/**
 * A vitrine do Marketplace: o início (Paper D1), a busca e a categoria (T1) e a lista dos conectados. As linhas são as
 * mesmas nos três: logo de 36 px, nome, uma linha de detalhe e a pílula da ação.
 */

export type AcoesDaLinha = {
  /** Conectar: o app de chave abre o formulário; o de login abre o login ali mesmo (dentro do clique). */
  conectar: (app: AppDaVitrine) => void;
  abrir: (app: AppDaVitrine) => void;
  cancelar: (app: AppDaVitrine) => void;
};

function Esperando({ app }: { app: AppDaVitrine }) {
  const login = app.login;
  return (
    <p className="rx-mk-linha-detalhe" role="status">
      <span className="rx-mk-giro rx-mk-giro-tinta" aria-hidden="true" />
      <span>Esperando você entrar no {app.nome}…</span>
      {login?.semJanela && login.url ? <a href={login.url} target="_blank" rel="noopener noreferrer">Abrir o login</a> : null}
    </p>
  );
}

export const LinhaDoApp = memo(function LinhaDoApp({ app, acoes, realce = false }: { app: AppDaVitrine; acoes: AcoesDaLinha; realce?: boolean }) {
  const esperando = app.login !== null && !app.login.falhou;
  const falhou = app.login?.falhou ?? null;
  let pilula: ReactNode;
  if (esperando) pilula = <button type="button" className="rx-mk-pilula" onClick={() => acoes.cancelar(app)}>Cancelar</button>;
  else if (falhou) pilula = <button type="button" className="rx-mk-pilula" onClick={() => acoes.conectar(app)}>Tentar de novo</button>;
  else if (estaConectado(app)) pilula = <button type="button" className="rx-mk-pilula" aria-label={`Abrir ${app.nome}`} onClick={() => acoes.abrir(app)}>Abrir</button>;
  else pilula = <button type="button" className="rx-mk-pilula" aria-label={`Conectar ${app.nome}`} onClick={() => acoes.conectar(app)}>Conectar</button>;
  const detalhe = falhou ?? (app.desligado ? `Desligado · ${detalheDaLinha(app)}` : app.situacao === "atencao" && app.falha ? app.falha : detalheDaLinha(app));
  return (
    <li className={`rx-mk-linha${realce ? " rx-mk-realce" : ""}`} data-app={app.slug}>
      <Logo app={app} />
      <div className="rx-mk-linha-texto">
        <h4 className="rx-mk-linha-nome">{app.nome}</h4>
        {esperando ? <Esperando app={app} /> : <p className="rx-mk-linha-detalhe"><span>{detalhe}</span></p>}
      </div>
      {pilula}
    </li>
  );
});

function Grade({ apps, acoes, realce }: { apps: readonly AppDaVitrine[]; acoes: AcoesDaLinha; realce?: string | undefined }) {
  return <ul className="rx-mk-grade">{apps.map((a) => <LinhaDoApp key={a.slug} app={a} acoes={acoes} realce={a.slug === realce} />)}</ul>;
}

/** O topo das telas de lista: o título, "N conectados ›" com os logos e o ×. */
export function Topo({ titulo, conectados, aoVerConectados, aoFechar, trilha }: { titulo: string; conectados: readonly AppDaVitrine[] | null; aoVerConectados?: () => void; aoFechar: () => void; trilha?: (() => void) | undefined }) {
  return (
    <div className="rx-mk-topo">
      {trilha ? (
        <div className="rx-mk-trilha">
          <button type="button" className="rx-mk-trilha-voltar" onClick={trilha}><IconeVoltar />Apps</button>
          <span className="rx-mk-trilha-barra" aria-hidden="true">/</span>
          <h2 className="rx-mk-trilha-aqui" id="rx-mk-titulo">{titulo}</h2>
        </div>
      ) : <h2 className="rx-mk-titulo" id="rx-mk-titulo">{titulo}</h2>}
      <div className="rx-mk-topo-dir">
        {conectados && conectados.length > 0 && aoVerConectados ? (
          <button type="button" className="rx-mk-conectados" onClick={aoVerConectados}>
            <span className="rx-mk-pilha" aria-hidden="true">{conectados.slice(0, 4).map((a) => <Logo key={a.slug} app={a} tamanho="mini" />)}</span>
            {conectados.length === 1 ? "1 conectado" : `${conectados.length} conectados`}
            <IconeSeguir />
          </button>
        ) : null}
        <button type="button" className="rx-mk-fechar" aria-label="Fechar o Marketplace" aria-keyshortcuts="Escape" title="Fechar (Esc)" onClick={aoFechar}><IconeFechar /></button>
      </div>
    </div>
  );
}

function Chips({ chips, mais, atual, aoEscolher }: { chips: readonly string[]; mais: readonly string[]; atual: string | null; aoEscolher: (c: string | null) => void }) {
  const [aberto, setAberto] = useState(false);
  const menu = useRef<HTMLDivElement | null>(null);
  const botao = useRef<HTMLButtonElement | null>(null);
  const daMais = atual !== null && mais.includes(atual);
  useEffect(() => {
    if (!aberto) return;
    menu.current?.querySelector<HTMLElement>("[role=menuitemradio]")?.focus();
    const fora = (ev: PointerEvent) => { if (!menu.current?.contains(ev.target as Node) && !botao.current?.contains(ev.target as Node)) setAberto(false); };
    document.addEventListener("pointerdown", fora);
    return () => document.removeEventListener("pointerdown", fora);
  }, [aberto]);
  const escolher = (c: string | null) => { setAberto(false); aoEscolher(c); };
  return (
    <div className="rx-mk-chips" role="group" aria-label="Categorias">
      <button type="button" className="rx-mk-chip" aria-pressed={atual === null} onClick={() => escolher(null)}>Todos</button>
      {chips.map((c) => <button key={c} type="button" className="rx-mk-chip" aria-pressed={atual === c} onClick={() => escolher(c)}>{c}</button>)}
      {mais.length > 0 ? (
        <button ref={botao} type="button" className="rx-mk-chip rx-mk-chip-mais" aria-pressed={daMais} aria-haspopup="menu" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
          {daMais ? atual : "Mais"}<IconeAbaixo />
        </button>
      ) : null}
      {aberto ? (
        // O Esc fecha só o menu: o preventDefault segura o "cancel" do <dialog>, que fecharia o Marketplace inteiro.
        <div ref={menu} className="rx-mk-menu" role="menu" aria-label="Mais categorias" style={{ left: `${(botao.current?.offsetLeft ?? 0)}px` }}
          onKeyDown={(ev) => {
            if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); setAberto(false); botao.current?.focus(); }
            if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
              ev.preventDefault();
              const itens = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? [])];
              const i = itens.indexOf(document.activeElement as HTMLElement);
              itens[(i + (ev.key === "ArrowDown" ? 1 : itens.length - 1)) % itens.length]?.focus();
            }
          }}>
          {mais.map((c) => <button key={c} type="button" role="menuitemradio" aria-checked={atual === c} className="rx-mk-menu-item" onClick={() => escolher(c)}>{c}</button>)}
        </div>
      ) : null}
    </div>
  );
}

export type PropsDoInicio = {
  foto: FotoDoMarketplace;
  busca: string;
  categoria: string | null;
  /** "Ver tudo" de Recomendados: a lista inteira, sem categoria. */
  todos: boolean;
  realce?: string | undefined;
  autoFoco: boolean;
  acoes: AcoesDaLinha;
  aoBuscar: (t: string) => void;
  aoEscolherCategoria: (c: string | null) => void;
  aoVerTudo: () => void;
  aoVerConectados: () => void;
  aoFechar: () => void;
  aoTrocarChave: (app: AppDaVitrine) => void;
  aoEntrarDeNovo: (app: AppDaVitrine) => void;
  aoAbrirAvancado: () => void;
};

/** O início (D1) ou, com busca ou categoria, a lista de resultados (T1). */
export function Inicio(p: PropsDoInicio) {
  const { foto, busca, categoria } = p;
  const { chips, mais } = categoriasDosChips(foto.apps);
  const conectados = foto.apps.filter(estaConectado);
  const listando = busca.trim() !== "" || categoria !== null || p.todos;
  const [pagina, setPagina] = useState(1);
  useEffect(() => setPagina(1), [busca, categoria, p.todos]);
  const campo = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (p.autoFoco) campo.current?.focus(); }, [p.autoFoco]);
  const resultados = listando ? buscar(foto.apps, busca, categoria) : [];
  const { atencao, secoes } = listando ? { atencao: [], secoes: [] } : secoesDoInicio(foto.apps, chips);
  const visiveis = resultados.slice(0, pagina * POR_PAGINA);
  return (
    <main className={`rx-mk-conteudo${listando ? "" : " rx-mk-inicio"}`} aria-labelledby="rx-mk-titulo">
      <Topo titulo="Apps" conectados={conectados} aoVerConectados={p.aoVerConectados} aoFechar={p.aoFechar} />
      <div className={listando ? "rx-mk-busca-chips" : "rx-mk-sem-grupo"}>
        <label className="rx-mk-busca">
          <IconeBusca />
          <span className="rx-mk-sr">Buscar apps</span>
          <input ref={campo} type="search" value={busca} placeholder={`Buscar entre ${milhar(foto.total)} apps`} autoComplete="off" spellCheck={false} enterKeyHint="search"
            onChange={(ev) => p.aoBuscar(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === "Escape" && busca) { ev.preventDefault(); p.aoBuscar(""); } }} />
        </label>
        <Chips chips={chips} mais={mais} atual={categoria} aoEscolher={p.aoEscolherCategoria} />
      </div>
      {!foto.composioConfigurado ? (
        <p className="rx-mk-nota">Para conectar a maioria dos apps, o Composio do time precisa estar configurado. <button type="button" className="rx-mk-ver-tudo" onClick={p.aoAbrirAvancado}>Configurar em Avançado</button></p>
      ) : null}
      {listando ? (
        <>
          <div className="rx-mk-secao-topo rx-mk-lista-topo"><h3 className="rx-mk-secao-titulo" aria-live="polite">{tituloDaLista(resultados.length, busca, categoria)}</h3></div>
          {resultados.length ? <Grade apps={visiveis} acoes={p.acoes} realce={p.realce} /> : <p className="rx-mk-vazio">Nenhum app com esse nome. Tente outra palavra ou veja todos.</p>}
          {resultados.length > visiveis.length ? <button type="button" className="rx-mk-bt rx-mk-mais-bt" onClick={() => setPagina((n) => n + 1)}>Mostrar mais {Math.min(POR_PAGINA, resultados.length - visiveis.length)}</button> : null}
          {busca.trim() ? (
            <div className="rx-mk-legenda">
              <p><b>Entrar com a conta</b> abre a página do app para você autorizar.</p>
              <p><b>Chave de API</b> pede um código que você gera no próprio app. O nod mostra onde achar.</p>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {atencao.length ? (
            <section className="rx-mk-atencao" aria-labelledby="rx-mk-atencao-t">
              <h3 className="rx-mk-rotulo" id="rx-mk-atencao-t">Precisa de atenção</h3>
              <ul className="rx-mk-caixa">
                {atencao.map((app) => (
                  <li key={app.slug} className="rx-mk-atencao-linha">
                    <span className="rx-mk-atencao-logo"><Logo app={app} tamanho="pequeno" /></span>
                    <div className="rx-mk-atencao-texto">
                      <h4 className="rx-mk-atencao-nome">{app.nome}</h4>
                      <p className="rx-mk-atencao-motivo"><span className="rx-mk-ponto" aria-hidden="true" /><span>{app.falha ?? `O ${app.nome} parou de responder`}</span></p>
                    </div>
                    {app.chave
                      ? <button type="button" className="rx-mk-pilula rx-mk-forte" onClick={() => p.aoTrocarChave(app)}>Trocar a chave</button>
                      : <button type="button" className="rx-mk-pilula rx-mk-forte" onClick={() => p.aoEntrarDeNovo(app)}>Entrar de novo</button>}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {secoes.map((s) => (
            <section key={s.titulo} className="rx-mk-secao" aria-label={s.titulo}>
              <div className="rx-mk-secao-topo">
                <h3 className="rx-mk-secao-titulo">{s.titulo}</h3>
                <button type="button" className="rx-mk-ver-tudo" onClick={() => (s.categoria === null ? p.aoVerTudo() : p.aoEscolherCategoria(s.categoria))} aria-label={`Ver tudo em ${s.titulo}`}>Ver tudo</button>
              </div>
              <Grade apps={s.apps} acoes={p.acoes} realce={p.realce} />
            </section>
          ))}
        </>
      )}
    </main>
  );
}

/** "N conectados ›": a mesma lista de duas colunas, com Abrir em cada app. */
export function Conectados({ foto, acoes, aoVoltar, aoFechar }: { foto: FotoDoMarketplace; acoes: AcoesDaLinha; aoVoltar: () => void; aoFechar: () => void }) {
  const conectados = foto.apps.filter(estaConectado);
  return (
    <main className="rx-mk-conteudo" aria-labelledby="rx-mk-titulo">
      <Topo titulo="Conectados" conectados={null} aoFechar={aoFechar} trilha={aoVoltar} />
      {conectados.length ? <Grade apps={conectados} acoes={acoes} /> : <p className="rx-mk-vazio">Nenhum app conectado ainda.</p>}
    </main>
  );
}

