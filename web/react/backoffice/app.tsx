import { Menu } from "@base-ui/react/menu";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BackofficeEuDto } from "../../../src/contracts/backoffice.ts";
import type { ApiBackoffice } from "./api.ts";
import { Link, Navegar, SessaoCaiu, useCarga } from "./comum.tsx";
import { caminhoDaSecao, caminhoDoLogin, JANELAS, lerJanela, lerRota, type Janela, type Rota } from "./rotas.ts";
import { SECOES } from "./secoes/index.tsx";
import { TelaPessoa } from "./secoes/pessoas.tsx";

/**
 * O app do backoffice interno (definido em 2026-11-24, ADR-194): shell com menu lateral (no celular, abas no topo),
 * cabeçalho da seção com a janela 7/30/90 dias e o conteúdo da seção. O servidor já conferiu a sessão e o papel antes de
 * servir esta página; a tela confere de novo por /api/backoffice/eu e cada seção lê só a própria rota.
 */
export type Ambiente = {
  caminho: () => string;
  busca: () => string;
  ir: (url: string) => void;
  empurrar: (url: string) => void;
  sair: () => Promise<void>;
};

export const ambienteDoNavegador = (): Ambiente => ({
  caminho: () => location.pathname,
  busca: () => location.search,
  ir: (url) => location.assign(url),
  empurrar: (url) => history.pushState(null, "", url),
  sair: async () => {
    await fetch("/api/sessao/sair", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
  },
});

export function AppBackoffice({ api, ambiente = ambienteDoNavegador() }: { api: ApiBackoffice; ambiente?: Ambiente }) {
  const [rota, setRota] = useState<Rota>(() => lerRota(ambiente.caminho()));
  const [dias, setDias] = useState<Janela>(() => lerJanela(ambiente.busca()));
  const eu = useCarga(() => api.eu(), [api]);
  // QA r220: o link clicado (o nome na lista, "← Pessoas") some na troca de tela e o foco caía no <body>; ao navegar
  // por um link do app, o foco vai ao título da tela nova, que o leitor de tela anuncia. Voltar do navegador não mexe.
  const titulo = useRef<HTMLHeadingElement>(null);
  const [navegacoes, setNavegacoes] = useState(0);
  useEffect(() => {
    if (navegacoes > 0) titulo.current?.focus({ preventScroll: true });
  }, [navegacoes]);

  useEffect(() => {
    const ouvir = () => {
      setRota(lerRota(ambiente.caminho()));
      setDias(lerJanela(ambiente.busca()));
    };
    addEventListener("popstate", ouvir);
    return () => removeEventListener("popstate", ouvir);
  }, [ambiente]);

  const comJanela = useCallback((caminho: string, n: Janela) => (n === 30 ? caminho : `${caminho}?dias=${n}`), []);
  const navegar = useCallback(
    (caminho: string) => {
      ambiente.empurrar(comJanela(caminho, dias));
      setRota(lerRota(caminho));
      setNavegacoes((n) => n + 1);
      scrollTo?.({ top: 0 });
    },
    [ambiente, comJanela, dias],
  );
  const trocarJanela = (n: Janela) => {
    setDias(n);
    ambiente.empurrar(comJanela(ambiente.caminho(), n));
  };
  const sessaoCaiu = useCallback(() => ambiente.ir(caminhoDoLogin(ambiente.caminho() + ambiente.busca())), [ambiente]);

  useEffect(() => {
    if (eu.estado === "sem_sessao") sessaoCaiu();
  }, [eu.estado, sessaoCaiu]);

  if (eu.estado === "nao_encontrado" || eu.estado === "erro")
    return (
      <div className="bko-vazio bko-sozinho">
        <h1 className="ds-titulo-2">{eu.estado === "erro" ? "Não deu para abrir o backoffice" : "Página não encontrada"}</h1>
        {eu.estado === "erro" ? <p className="ds-corpo-2">Recarregue a página em instantes.</p> : null}
      </div>
    );
  if (eu.estado !== "ok") return <div className="bko-sozinho" aria-busy="true" aria-label="Carregando" />;

  const secao = SECOES.find((s) => s.id === rota.secao) ?? null;
  return (
    <Navegar.Provider value={navegar}>
      <SessaoCaiu.Provider value={sessaoCaiu}>
        <div className="bko">
          <aside className="bko-lateral">
            <div className="bko-marca-topo">
              <a className="bko-logo" href="/" aria-label="Abrir o nod">
                nod
              </a>
              <span className="bko-selo ds-legenda">backoffice</span>
              <Conta eu={eu.dado} sair={async () => {
                await ambiente.sair();
                ambiente.ir("/");
              }} />
            </div>
            <nav className="bko-nav" aria-label="Seções do backoffice">
              <ul>
                {SECOES.map((s) => (
                  <li key={s.id}>
                    <Link para={caminhoDaSecao(s.id)} className="bko-nav-item" {...(s.id === rota.secao ? { "aria-current": "page" as const } : {})}>
                      {s.icone}
                      <span>{s.rotulo}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
          <div className="bko-principal">
            <header className="bko-topo">
              <div className="bko-topo-texto">
                <h1 className="ds-titulo-1" tabIndex={-1} ref={titulo}>{secao?.rotulo ?? "Página não encontrada"}</h1>
                {secao ? <p className="ds-corpo-2 bko-nota">{secao.descricao} · só leitura, nunca o conteúdo das conversas</p> : null}
              </div>
              {secao ? <SeletorJanela dias={dias} trocar={trocarJanela} /> : null}
            </header>
            <main className="bko-conteudo">
              <ConteudoDaRota rota={rota} api={api} dias={dias} />
            </main>
          </div>
        </div>
      </SessaoCaiu.Provider>
    </Navegar.Provider>
  );
}

function ConteudoDaRota({ rota, api, dias }: { rota: Rota; api: ApiBackoffice; dias: Janela }) {
  const secao = useMemo(() => SECOES.find((s) => s.id === rota.secao) ?? null, [rota.secao]);
  if (rota.pessoa) return <TelaPessoa api={api} dias={dias} tenantId={rota.pessoa.tenantId} pessoaId={rota.pessoa.pessoaId} />;
  if (!secao) return <div className="bko-vazio"><p className="ds-corpo-2">Escolha uma seção no menu.</p></div>;
  return <secao.Componente api={api} dias={dias} />;
}

/** A janela do painel (Base UI ToggleGroup, um valor só: clicar no que já está marcado não desmarca). */
export function SeletorJanela({ dias, trocar }: { dias: Janela; trocar: (n: Janela) => void }) {
  return (
    <ToggleGroup
      className="bko-janela"
      aria-label="Janela de dias"
      value={[String(dias)]}
      onValueChange={(v: string[]) => {
        const n = Number(v[0]);
        if ((JANELAS as readonly number[]).includes(n)) trocar(n as Janela);
      }}
    >
      {JANELAS.map((n) => (
        <Toggle key={n} value={String(n)} className="bko-chip">
          {n} dias
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

/** O menu da conta (Base UI Menu): quem está no backoffice, com que papel, e as saídas. */
function Conta({ eu, sair }: { eu: BackofficeEuDto; sair: () => Promise<void> }) {
  return (
    <Menu.Root>
      <Menu.Trigger className="bko-conta" aria-label={`Conta: ${eu.nome}`}>
        <span className="bko-avatar" aria-hidden="true">
          {eu.iniciais || "·"}
        </span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="bko-menu-pos" sideOffset={6} align="end">
          <Menu.Popup className="bko-menu">
            <div className="bko-menu-cabeca">
              <strong>{eu.nome}</strong>
              <span className="ds-legenda bko-nota">{eu.papel === "dono" ? "Dono do backoffice" : "Só leitura"}</span>
            </div>
            <Menu.Separator className="bko-menu-sep" />
            <Menu.LinkItem className="bko-menu-it" href="/">
              Abrir o nod
            </Menu.LinkItem>
            <Menu.Item className="bko-menu-it" onClick={() => void sair()}>
              Sair
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
