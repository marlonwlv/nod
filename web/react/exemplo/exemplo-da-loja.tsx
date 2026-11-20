import { Collapsible } from "@base-ui/react/collapsible";
import type { Loja } from "../loja.ts";
import { useLoja } from "../use-loja.ts";
import "./exemplo-da-loja.css";

/**
 * ADR-179 (fase 1): componente de EXEMPLO da infra. Não vai para a tela em produção — nenhum código do app o importa;
 * só o teste (tests/unit/web/react/exemplo-da-loja.test.tsx). Mostra o caminho que as regiões vão seguir: primitivo
 * headless do Base UI, CSS próprio sobre os tokens (var(--…)), leitura da loja por seletor e evento por prop, sem
 * data-act. Some quando a primeira região de verdade entrar (fase 2).
 */
export type EstadoDoExemplo = { titulo: string; itens: readonly string[] };

export function ExemploDaLoja({ loja, aoEscolher }: { loja: Loja<EstadoDoExemplo>; aoEscolher: (item: string) => void }) {
  const titulo = useLoja(loja, (e) => e.titulo);
  const itens = useLoja(loja, (e) => e.itens);
  return (
    <Collapsible.Root className="rx-exemplo">
      <Collapsible.Trigger className="rx-exemplo-gatilho">{titulo}</Collapsible.Trigger>
      <Collapsible.Panel className="rx-exemplo-painel">
        <ul className="rx-exemplo-lista">
          {itens.map((item) => (
            <li key={item}>
              <button type="button" className="rx-exemplo-item" onClick={() => aoEscolher(item)}>
                {item}
              </button>
            </li>
          ))}
        </ul>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
