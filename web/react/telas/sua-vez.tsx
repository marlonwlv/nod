import { useLayoutEffect, useRef } from "react";
import type { Estado } from "../../estado/reducer.ts";
import { contarFios } from "../../lib/perguntas.ts";
import { foraDoArDesde, nadaEsperando } from "../../lib/relogio.ts";
import { dispensavel, renderComIguais, renderItem } from "../../telas/sua-vez.ts";
import { useFocoQueNaoCai } from "../use-foco-que-nao-cai.ts";
import { criarConversor, type ConversorDeHtml } from "../html/html-em-react.tsx";
import type { Loja } from "../loja.ts";
import { useLoja } from "../use-loja.ts";

/**
 * ADR-179 (as telas no lugar da conversa): Sua vez (ADR-007) em React. O mesmo DOM da tela por string
 * (web/telas/sua-vez.ts, `renderSuaVez`, o caminho de volta com `?telas-react=0`). A casca é componente — o título com
 * a conta, o vazio, os fora do ar e os vencidos recolhidos com o "Limpar vencidos" por prop —; os cartões de decisão
 * são os mesmos da conversa (`renderItem`) e entram pelo conversor da ADR-189, com a chave `data-decisao`: o cartão que
 * não mudou nem é lido, e as ações dele seguem na delegação do main até os cartões virarem componentes (o item dos
 * cartões da ADR-179, que vale para a conversa e para cá de uma vez). O `<details>` dos vencidos é o mesmo nó entre
 * desenhos: aberto, fica aberto.
 */
export interface AcoesDeSuaVez { limparVencidos: (ids: readonly string[]) => void }

export function TelaSuaVez({ loja, acoes }: { loja: Loja<Estado>; acoes: AcoesDeSuaVez }) {
  const estado = useLoja(loja, (e) => e);
  const conversor = useRef<ConversorDeHtml | null>(null);
  conversor.current ??= criarConversor();
  useLayoutEffect(() => conversor.current?.fecharQuadro());
  // QA-157: decidir um cartão ou "Limpar vencidos" pelo teclado não deixa o foco no <body>.
  const raiz = useRef<HTMLElement | null>(null);
  useFocoQueNaoCai(raiz, { item: "[data-decisao]", titulo: ".tela-cab h1" });
  const html = (h: string) => (h ? conversor.current!.converter(h) : null);
  const sv = estado.suaVez;
  if (!sv) return <section ref={raiz} className="tela"><header className="tela-cab"><h1>Sua vez</h1></header><p className="mudo">carregando…</p></section>;
  const abertos = sv.itens.filter((i) => i.estadoColuna !== "vencido");
  const vencidos = sv.itens.filter((i) => i.estadoColuna === "vencido");
  // O número do título conta fios (definido em 2026-09-24): as rodadas de uma pergunta são uma espera só.
  const esperando = contarFios(abertos);
  const ids = vencidos.filter(dispensavel).map((i) => i.decisao.id);
  return (
    <section ref={raiz} className="tela tela-sua-vez">
      <header className="tela-cab"><h1>{`Sua vez${esperando ? ` · ${esperando}` : ""}`}</h1><span className="chip">mais antiga no topo · vencidas recolhidas no fim</span></header>
      {sv.vazio && sv.foraDoAr.length === 0 && <p className="vazio">{nadaEsperando(sv.ultimaDecisaoEm, estado.agora)}</p>}
      <ul className="lista">
        {sv.foraDoAr.map((f) => <li key={`fora-${f.nome}`} className="decisao dec-fora"><span className="tag tag-cinza">fora do ar</span>{` ${foraDoArDesde(f.nome, f.desde)}`}</li>)}
        {html(renderComIguais(abertos, estado, false))}
      </ul>
      {vencidos.length > 0 && (
        <div className="dec-vencidos">
          <details className="dec-vencidos-lista" data-disclosure="vencidos-sua-vez">
            <summary>{vencidos.length === 1 ? "1 pedido vencido" : `${vencidos.length} pedidos vencidos`} · ver</summary>
            <ul className="lista">{html(vencidos.map((i) => renderItem(i, estado, false)).join(""))}</ul>
          </details>
          {ids.length > 1 && <button type="button" className="bt sm dec-limpar" data-ids={ids.join(",")} onClick={() => acoes.limparVencidos(ids)}>{`Limpar vencidos (${ids.length})`}</button>}
        </div>
      )}
    </section>
  );
}
