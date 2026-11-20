import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ConectarComChave } from "./conectar-com-chave.tsx";
import { IconeApps, IconeAvancado, IconeBots, IconePlugins } from "./pecas.tsx";
import { QuemPodeUsar } from "./quem-pode-usar.tsx";
import { Conectados, Inicio, type AcoesDaLinha } from "./vitrine.tsx";
import type { ApiDoMarketplace, AppDaVitrine, InicialDoMarketplace, Vista } from "./tipos.ts";
import "./marketplace.css";

/**
 * O Marketplace em modal (Paper "Apps por chave de API · jornada"; ADR-179, região #marketplace): a navegação à esquerda
 * (Apps; Plugins e Bots "Em breve"; Avançado embaixo) e a tela da direita, que anda entre o início, os conectados, o
 * formulário da chave e o "Quem pode usar". Tudo o que vem de fora passa por `api` (tipos.ts).
 *
 * O modal é um <dialog> nativo aberto com showModal(): o resto da página fica inerte (o foco não sai), o Esc chega
 * como "cancel" (que fecha pelo `aoFechar`, para o dono do estado saber) e os atalhos do main.ts, que já se afastam de
 * `dialog`, não disparam por baixo — a mesma regra das Configurações (Esc fecha, o foco volta a quem abriu).
 */

export type PropsDoMarketplace = {
  api: ApiDoMarketplace;
  aoFechar: () => void;
  inicial?: InicialDoMarketplace | undefined;
  /** Só o simulador: o controle dos estados, dentro do <dialog> (fora dele o showModal o deixaria inerte). */
  extra?: ReactNode;
};

export function Marketplace({ api, aoFechar, inicial, extra }: PropsDoMarketplace) {
  const foto = useSyncExternalStore(api.assinar, api.ler, api.ler);
  const [vista, setVista] = useState<Vista>(inicial?.vista ?? { tipo: "inicio" });
  const [busca, setBusca] = useState(inicial?.busca ?? "");
  const [categoria, setCategoria] = useState<string | null>(inicial?.categoria ?? null);
  const [todos, setTodos] = useState(false);
  /** Os apps de login que a pessoa mandou conectar daqui: quando conectam, a tela vai sozinha ao "Quem pode usar". */
  const [esperando, setEsperando] = useState<ReadonlySet<string>>(new Set());
  const dialogo = useRef<HTMLDialogElement | null>(null);
  const janela = useRef<HTMLDivElement | null>(null);

  // Abre como modal ao montar; quem tinha o foco o recebe de volta ao fechar.
  useLayoutEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    const antes = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    }
    // Sem pedido de foco (a busca do T1), o foco fica na janela: nada aceso à toa no primeiro desenho.
    if (!inicial?.busca) janela.current?.focus({ preventScroll: true });
    return () => {
      if (d.open && typeof d.close === "function") d.close();
      if (antes?.isConnected) antes.focus({ preventScroll: true });
    };
    // Só na montagem: o resto do modal vive dentro dele.
  }, []);

  // A cada troca de tela, o título novo recebe o foco (o leitor de tela anuncia onde a pessoa está).
  const primeira = useRef(true);
  useEffect(() => {
    if (primeira.current) { primeira.current = false; return; }
    document.getElementById("rx-mk-titulo")?.setAttribute("tabindex", "-1");
    document.getElementById("rx-mk-titulo")?.focus({ preventScroll: true });
  }, [vista]);

  const porSlug = useMemo(() => new Map(foto.apps.map((a) => [a.slug, a])), [foto.apps]);

  // O login que a pessoa começou aqui terminou: conectou → "Quem pode usar"; falhou ou foi cancelado → só para de esperar.
  useEffect(() => {
    if (esperando.size === 0) return;
    let resto: Set<string> | null = null;
    for (const slug of esperando) {
      const app = porSlug.get(slug);
      if (!app || (app.login && !app.login.falhou)) continue;
      resto ??= new Set(esperando);
      resto.delete(slug);
      if (app.situacao === "conectado" && vista.tipo !== "chave") setVista({ tipo: "acessos", slug, conectorId: app.conectorId, conectadoAgora: true });
    }
    if (resto) setEsperando(resto);
  }, [porSlug, esperando, vista.tipo]);

  const irAoInicio = useCallback(() => setVista({ tipo: "inicio" }), []);
  const conectarLogin = useCallback((app: AppDaVitrine) => {
    setEsperando((s) => new Set(s).add(app.slug));
    api.conectarLogin(app.slug);
  }, [api]);
  const acoes = useMemo<AcoesDaLinha>(() => ({
    conectar: (app) => (app.chave ? setVista({ tipo: "chave", slug: app.slug }) : conectarLogin(app)),
    abrir: (app) => setVista({ tipo: "acessos", slug: app.slug, conectorId: app.conectorId, conectadoAgora: false }),
    cancelar: (app) => api.cancelarLogin(app.slug),
  }), [api, conectarLogin]);

  let tela;
  const app = vista.tipo === "chave" || vista.tipo === "acessos" ? porSlug.get(vista.slug) : undefined;
  if (vista.tipo === "conectados") {
    tela = <Conectados foto={foto} acoes={acoes} aoVoltar={irAoInicio} aoFechar={aoFechar} />;
  } else if (vista.tipo === "chave" && app) {
    tela = (
      <ConectarComChave key={app.slug} app={app} api={api} aoVoltar={irAoInicio} aoFechar={aoFechar} aoAbrirAvancado={api.abrirAvancado}
        aoConectar={(conectorId) => setVista({ tipo: "acessos", slug: app.slug, conectorId, conectadoAgora: true })}
        preenchido={inicial?.vista === vista ? inicial.preenchido : undefined} envioInicial={inicial?.vista === vista ? inicial.envio : undefined} />
    );
  } else if (vista.tipo === "acessos" && app) {
    tela = (
      <QuemPodeUsar key={app.slug} app={app} conectorId={vista.conectorId ?? app.conectorId} conectadoAgora={vista.conectadoAgora} foto={foto} api={api}
        aoVoltar={irAoInicio} aoFechar={aoFechar}
        selecionadosIniciais={inicial?.vista === vista ? inicial.selecionados : undefined} confirmarEscrita={inicial?.vista === vista ? inicial.confirmarEscrita : undefined} />
    );
  } else {
    tela = (
      <Inicio foto={foto} busca={busca} categoria={categoria} todos={todos} realce={inicial?.realce} autoFoco={!!inicial?.busca} acoes={acoes}
        aoBuscar={(t) => { setBusca(t); if (!t.trim()) setTodos(false); }}
        aoEscolherCategoria={(c) => { setCategoria(c); setTodos(false); }}
        aoVerTudo={() => { setCategoria(null); setTodos(true); }}
        aoVerConectados={() => setVista({ tipo: "conectados" })}
        aoFechar={aoFechar}
        aoTrocarChave={(a) => setVista({ tipo: "chave", slug: a.slug })}
        aoEntrarDeNovo={conectarLogin}
        aoAbrirAvancado={api.abrirAvancado} />
    );
  }

  return (
    <dialog ref={dialogo} className="rx-mk" aria-labelledby="rx-mk-nav-titulo"
      onCancel={(ev) => { ev.preventDefault(); aoFechar(); }}
      onClick={(ev) => { if (ev.target === dialogo.current) aoFechar(); }}>
      <div ref={janela} className="rx-mk-janela" tabIndex={-1}>
        <nav className="rx-mk-nav" aria-label="Marketplace">
          <h1 className="rx-mk-nav-titulo" id="rx-mk-nav-titulo">Marketplace</h1>
          <button type="button" className="rx-mk-nav-item" aria-current="page" onClick={irAoInicio}><IconeApps /><span className="rx-mk-nav-texto">Apps</span></button>
          <div className="rx-mk-nav-item" aria-disabled="true"><IconePlugins /><span className="rx-mk-nav-texto">Plugins</span><span className="rx-mk-em-breve">Em breve</span></div>
          <div className="rx-mk-nav-item" aria-disabled="true"><IconeBots /><span className="rx-mk-nav-texto">Bots</span><span className="rx-mk-em-breve">Em breve</span></div>
          <span className="rx-mk-nav-vao" />
          <button type="button" className="rx-mk-nav-item" onClick={api.abrirAvancado}><IconeAvancado /><span className="rx-mk-nav-texto">Avançado</span></button>
        </nav>
        {tela}
      </div>
      {extra}
    </dialog>
  );
}
