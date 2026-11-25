import { useLayoutEffect, useRef } from "react";
import type { Estado } from "../../estado/reducer.ts";
import { avatarAgente } from "../../lib/render.ts";
import { criarConversor, type ConversorDeHtml } from "../html/html-em-react.tsx";
import type { Loja } from "../loja.ts";
import { useLoja } from "../use-loja.ts";

/**
 * ADR-179 (as telas no lugar da conversa): o novo chat em grupo (Nova sala) em React. O mesmo DOM da tela por string
 * (web/telas/sala.ts, `renderNovaSala`, o caminho de volta com `?telas-react=0`); o envio é prop (o formulário, que o
 * main lê como sempre), sem `data-form`. Os campos ficam sem controle do React (o nome e os marcados ficam entre desenhos).
 */
export interface AcoesDaNovaSala { criar: (form: HTMLFormElement) => void }

export function TelaNovaSala({ loja, acoes }: { loja: Loja<Estado>; acoes: AcoesDaNovaSala }) {
  const frota = useLoja(loja, (e) => e.frota);
  const conversor = useRef<ConversorDeHtml | null>(null);
  conversor.current ??= criarConversor();
  useLayoutEffect(() => conversor.current?.fecharQuadro());
  const agentes = frota?.agentes ?? [];
  return (
    <section className="tela tela-nova-sala">
      <header className="tela-cab"><h1>Novo chat em grupo</h1><span className="chip">2 a 6 bots · entre os selecionados, o primeiro da lista lidera</span></header>
      <form className="form" onSubmit={(ev) => { ev.preventDefault(); acoes.criar(ev.currentTarget); }}>
        <label>Nome <input name="nome" placeholder="revisão" required maxLength={60} /></label>
        <div className="opcoes">{agentes.length
          ? agentes.map((a) => <label key={a.id} className="opcao"><input type="checkbox" name="agenteIds" value={a.id} />{" "}{conversor.current!.converter(avatarAgente(a, "sm"))}{` ${a.nome}`}</label>)
          : <p className="mudo">Crie ao menos dois bots primeiro.</p>}</div>
        <button className="bt pri" type="submit">Criar sala</button>
      </form>
    </section>
  );
}
