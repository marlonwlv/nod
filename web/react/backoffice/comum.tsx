import { createContext, useContext, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import type { CasoProblemaDto } from "../../../src/contracts/backoffice.ts";
import { NaoEncontrado, SemSessao, type ApiBackoffice } from "./api.ts";
import type { Janela } from "./rotas.ts";

/** O que toda seção do backoffice recebe do shell (ADR-194). Seção nova = um módulo em secoes/ que lê isto. */
export type ContextoSecao = { api: ApiBackoffice; dias: Janela };

/** Navegação sem recarregar: o shell troca o caminho pela history API. */
export const Navegar = createContext<(caminho: string) => void>((caminho) => location.assign(caminho));

export function Link({ para, className, children, ...resto }: { para: string; className?: string; children: ReactNode; "aria-current"?: "page" }) {
  const navegar = useContext(Navegar);
  const aoClicar = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navegar(para);
  };
  return (
    <a href={para} className={className} onClick={aoClicar} {...resto}>
      {children}
    </a>
  );
}

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
export const fmtN = (n: number) => numero.format(n);
export const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
export const fmtData = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
export const fmtDia = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
export const fmtHoras = (h: number | null) => (h === null ? "—" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${fmtN(h)} h` : `${fmtN(h / 24)} d`);
const curto = (id: string) => id.slice(0, 8);

export type Carga<T> = { estado: "carregando" } | { estado: "ok"; dado: T } | { estado: "nao_encontrado" } | { estado: "sem_sessao" } | { estado: "erro" };

export function useCarga<T>(carregar: () => Promise<T>, deps: unknown[]): Carga<T> {
  const [c, setC] = useState<Carga<T>>({ estado: "carregando" });
  useEffect(() => {
    let vivo = true;
    setC({ estado: "carregando" });
    carregar().then(
      (dado) => vivo && setC({ estado: "ok", dado }),
      (e: unknown) => vivo && setC({ estado: e instanceof SemSessao ? "sem_sessao" : e instanceof NaoEncontrado ? "nao_encontrado" : "erro" }),
    );
    return () => {
      vivo = false;
    };
  }, deps);
  return c;
}

/** A sessão caiu no meio do uso: volta ao login e, depois dele, ao mesmo caminho. */
export const SessaoCaiu = createContext<() => void>(() => undefined);

export function Estado<T>({ carga, children }: { carga: Carga<T>; children: (d: T) => ReactNode }) {
  const sessaoCaiu = useContext(SessaoCaiu);
  useEffect(() => {
    if (carga.estado === "sem_sessao") sessaoCaiu();
  }, [carga.estado, sessaoCaiu]);
  if (carga.estado === "carregando" || carga.estado === "sem_sessao")
    return (
      <div className="bko-grade" aria-busy="true" aria-label="Carregando">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bko-cartao ds-esqueleto bko-esqueleto" />
        ))}
      </div>
    );
  if (carga.estado === "nao_encontrado")
    return (
      <div className="bko-vazio">
        <h2 className="ds-titulo-2">Página não encontrada</h2>
      </div>
    );
  if (carga.estado === "erro")
    return (
      <div className="bko-vazio bko-erro" role="alert">
        <h2 className="ds-titulo-3">Não deu para carregar</h2>
        <p className="ds-corpo-2">Recarregue a página em instantes.</p>
      </div>
    );
  return <>{children(carga.dado)}</>;
}

export function Kpi({ rotulo, valor, nota, tom }: { rotulo: string; valor: string; nota?: string; tom?: "perigo" | "aviso" }) {
  return (
    <div className="bko-cartao bko-kpi" data-tom={tom}>
      <span className="ds-rotulo bko-kpi-rotulo">{rotulo}</span>
      <strong className="bko-kpi-valor">{valor}</strong>
      {nota ? <span className="ds-legenda bko-kpi-nota">{nota}</span> : null}
    </div>
  );
}

/** Barras por dia, em SVG puro. O rótulo do primeiro e do último dia fica embaixo. */
export function Barras({ valores, dias, rotulo }: { valores: number[]; dias: string[]; rotulo: string }) {
  const max = Math.max(1, ...valores);
  const total = valores.reduce((s, x) => s + x, 0);
  const w = 100 / Math.max(1, valores.length);
  return (
    <figure className="bko-barras">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label={`${rotulo}: ${total} no período`}>
        {valores.map((v, i) => (
          <rect key={dias[i] ?? i} x={i * w + w * 0.15} width={w * 0.7} y={40 - (v / max) * 38} height={(v / max) * 38} rx="0.6">
            <title>{`${fmtDia(dias[i] ?? "")}: ${v}`}</title>
          </rect>
        ))}
      </svg>
      <figcaption className="ds-legenda bko-eixo">
        <span>{dias[0] ? fmtDia(dias[0]) : ""}</span>
        <span>máx. {max}</span>
        <span>{dias.at(-1) ? fmtDia(dias.at(-1)!) : ""}</span>
      </figcaption>
    </figure>
  );
}

export function Faisca({ valores }: { valores: number[] }) {
  const max = Math.max(1, ...valores);
  const n = Math.max(1, valores.length - 1);
  const pontos = valores.map((v, i) => `${(i / n) * 100},${20 - (v / max) * 18}`).join(" ");
  return (
    <svg className="bko-faisca" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pontos} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Secao({ titulo, children, nota }: { titulo: string; children: ReactNode; nota?: string }) {
  return (
    <section className="bko-secao">
      <div className="bko-secao-topo">
        <h2 className="ds-titulo-3">{titulo}</h2>
        {nota ? <span className="ds-legenda bko-nota">{nota}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function ListaContagem({ itens, vazio }: { itens: { nome: string; total: number }[]; vazio: string }) {
  if (itens.length === 0) return <p className="ds-corpo-2 bko-nota">{vazio}</p>;
  const max = Math.max(1, ...itens.map((i) => i.total));
  return (
    <ul className="bko-contagem">
      {itens.slice(0, 10).map((i) => (
        <li key={i.nome}>
          <span className="bko-contagem-nome">{i.nome}</span>
          <span className="bko-contagem-barra" style={{ inlineSize: `${(i.total / max) * 100}%` }} />
          <span className="bko-num">{i.total}</span>
        </li>
      ))}
    </ul>
  );
}

export function Ids({ c }: { c: Pick<CasoProblemaDto, "conversaId" | "tarefaId" | "turnoId"> }) {
  return (
    <span className="bko-ids">
      {c.conversaId ? <code title={`conversa ${c.conversaId}`}>conv {curto(c.conversaId)}</code> : null}
      {c.tarefaId ? <code title={`tarefa ${c.tarefaId}`}>tarefa {curto(c.tarefaId)}</code> : null}
      {c.turnoId && !c.tarefaId ? <code title={`turno ${c.turnoId}`}>turno {curto(c.turnoId)}</code> : null}
    </span>
  );
}
