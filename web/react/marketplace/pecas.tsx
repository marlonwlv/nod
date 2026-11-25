import { useState, type CSSProperties, type ReactNode } from "react";
import type { NivelPedido, NivelVisto } from "../../lib/acessos-otimistas.ts";
import { ROTULO } from "../../telas/acessos-do-app.ts";
import type { Trecho } from "./modelo.ts";
import type { AppDaVitrine, PassoDaChave } from "./tipos.ts";

/**
 * As peças pequenas do Marketplace em modal. Os ícones são os traços do Paper (16×16, traço 1,4), em `currentColor`:
 * a cor sai do CSS (tokens), nunca do SVG.
 */

type PropsIcone = { tamanho?: number };
const svg = (tamanho: number, filhos: ReactNode, traco = 1.4) => (
  <svg width={tamanho} height={tamanho} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={traco} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{filhos}</svg>
);

export const IconeApps = ({ tamanho = 15 }: PropsIcone) => svg(tamanho, <><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.2" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1.2" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1.2" /><rect x="9" y="9" width="4.5" height="4.5" rx="1.2" /></>);
export const IconePlugins = ({ tamanho = 15 }: PropsIcone) => svg(tamanho, <path d="M6 2.5h4v2a1.3 1.3 0 0 0 2.6 0v-.1h.9v4h-1a1.3 1.3 0 0 0 0 2.6h1v2.5h-4v-1a1.3 1.3 0 0 0-2.6 0v1H2.5V9.6h1a1.3 1.3 0 0 0 0-2.6h-1V2.5z" />, 1.3);
export const IconeBots = ({ tamanho = 15 }: PropsIcone) => svg(tamanho, <><circle cx="8" cy="8.5" r="5.5" /><path d="M6.5 7v1.5M9.5 7v1.5" /></>);
export const IconeAvancado = ({ tamanho = 15 }: PropsIcone) => svg(tamanho, <><path d="M2.5 5h7M12.5 5h1M2.5 11h1M6.5 11h7" /><circle cx="11" cy="5" r="1.5" /><circle cx="5" cy="11" r="1.5" /></>);
export const IconeBusca = ({ tamanho = 15 }: PropsIcone) => svg(tamanho, <><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L13.5 13.5" /></>);
export const IconeFechar = ({ tamanho = 14 }: PropsIcone) => svg(tamanho, <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />);
export const IconeVoltar = ({ tamanho = 14 }: PropsIcone) => svg(tamanho, <path d="M10 3.5L5.5 8l4.5 4.5" />);
export const IconeSeguir = ({ tamanho = 11 }: PropsIcone) => svg(tamanho, <path d="M6 3.5L10.5 8 6 12.5" />, 1.5);
export const IconeAbaixo = ({ tamanho = 11 }: PropsIcone) => svg(tamanho, <path d="M4.5 6.5L8 10l3.5-3.5" />, 1.5);
export const IconeExterno = ({ tamanho = 11 }: PropsIcone) => svg(tamanho, <path d="M6 3.5h6.5V10M12.5 3.5L4 12" />, 1.5);
export const IconeCadeado = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
);

/** O logo do app: a imagem da marca por cima da inicial; sem imagem (ou se ela falhar), fica a inicial. */
export function Logo({ app, tamanho = "linha" }: { app: Pick<AppDaVitrine, "nome" | "logo" | "cor" | "sigla">; tamanho?: "linha" | "grande" | "media" | "pequeno" | "mini" }) {
  const [falhou, setFalhou] = useState(false);
  const letra = app.sigla ?? app.nome.slice(0, 1).toUpperCase();
  const classe = `rx-mk-logo${tamanho === "linha" ? "" : ` rx-mk-${tamanho}`}${app.cor ? " rx-mk-com-cor" : ""}${letra.length > 1 ? " rx-mk-sigla" : ""}`;
  const estilo = app.cor ? ({ "--mk-cor": app.cor } as CSSProperties) : undefined;
  return (
    <span className={classe} style={estilo} aria-hidden="true">
      {letra}
      {app.logo && !falhou ? <img src={app.logo} alt="" loading="lazy" onError={() => setFalhou(true)} /> : null}
    </span>
  );
}

/** Um texto com trechos em negrito (a frase do formulário, os passos). */
export function Trechos({ trechos, peso = "b" }: { trechos: readonly Trecho[] | PassoDaChave; peso?: "b" }) {
  return <>{trechos.map((t, i) => (typeof t === "string" ? <span key={i}>{t}</span> : peso === "b" ? <b key={i}>{t.destaque}</b> : null))}</>;
}

/** Nenhum / Ler / Ler e alterar. `atual` nulo (ou "personalizado") deixa nenhum aceso; `acao` = o do lote, sem estado. */
export function Segmentado({ rotulo, atual, aoEscolher, acao = false, ocupado = false }: { rotulo: string; atual: NivelVisto | null; aoEscolher: (n: NivelPedido) => void; acao?: boolean; ocupado?: boolean }) {
  return (
    <div className={`segmentado rx-mk-seg${acao ? " rx-mk-acao" : ""}`} role="group" aria-label={rotulo} aria-busy={ocupado || undefined}>
      {(["nenhum", "leitura", "escrita"] as const).map((n) => (
        <button key={n} type="button" className={`seg${n === atual ? " ativo" : ""}`} aria-pressed={acao ? undefined : n === atual} onClick={() => aoEscolher(n)}>{ROTULO[n]}</button>
      ))}
    </div>
  );
}

/** O aviso de erro do design system (NOD-399, `avisoErro` de web/lib/card-proposta.ts): o "!" vermelho e a frase neutra. */
export function AvisoDeErro({ frase, mais, acoes, id }: { frase: string; mais?: string; acoes?: ReactNode; id?: string }) {
  return (
    <div className="cp-erro cp-solto rx-mk-erro" role="status" id={id}>
      <i className="cp-erro-ic" aria-hidden="true">!</i>
      <div className="cp-erro-corpo">
        <p className="cp-erro-frase"><span className="cp-sr">Erro: </span>{frase}</p>
        {mais ? <p className="cp-erro-mais">{mais}</p> : null}
      </div>
      {acoes ? <div className="cp-acoes">{acoes}</div> : null}
    </div>
  );
}
