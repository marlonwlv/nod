import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Menu } from "@base-ui/react/menu";
import type { Html } from "../../telas/quadro.ts";

/**
 * ADR-180 (fase 2 do React): um card da grade. O corpo é o mesmo HTML do card por string (web/telas/quadro.ts,
 * `partesDoCard`): os botões de dentro (abrir, prioridade, Responder) seguem na delegação do quadro-na-tela. O que é do
 * React: o `li` arrastável (dnd-kit) e o "Mover para…" (Menu do Base UI).
 *
 * `memo`: o card só redesenha quando o corpo, a classe ou os destinos mudam (comparados por valor) — um frame que mexe
 * em outra tarefa não toca neste. A key é o id da tarefa (quem chama).
 */
export interface DestinoDoMover { id: string; nome: string; nota: string | null; icone: Html }

export interface DadosDoCard {
  id: string;
  titulo: string;
  classe: string;
  corpo: Html;
  /** O menu por string que segue aberto no card (o de prioridade); o "Mover para…" é o Menu daqui. */
  menu?: Html;
  arrastavel: boolean;
}

export interface PropsDoCard {
  card: DadosDoCard;
  coluna: string;
  /** Para onde o card pode ir, com a nota de cada coluna. Lido só com o menu aberto (o Popup monta ao abrir). */
  destinos: (tarefa: string) => readonly DestinoDoMover[];
  aoMover: (tarefa: string, coluna: string) => void;
}

function CardDaGradeBase({ card, coluna, destinos, aoMover }: PropsDoCard) {
  const s = useSortable({ id: card.id, data: { coluna, tipo: "card" }, disabled: !card.arrastavel });
  const estilo = { transform: CSS.Translate.toString(s.transform), transition: s.transition };
  return (
    <li
      ref={s.setNodeRef}
      className={`${card.classe}${s.isDragging ? " qd-arrastando" : ""}`}
      data-tarefa={card.id}
      data-rx-arrasta={card.arrastavel ? "1" : undefined}
      style={estilo}
      {...(card.arrastavel ? s.listeners : {})}
    >
      <CorpoDoCard corpo={card.corpo} />
      {card.arrastavel && <MoverPara titulo={card.titulo} tarefa={card.id} destinos={destinos} aoMover={aoMover} />}
      {card.menu && <CorpoDoCard corpo={card.menu} />}
    </li>
  );
}

/** O HTML do card por string, num `div` com display: contents (o layout do li segue o de antes). */
const CorpoDoCard = memo(function CorpoDoCard({ corpo }: { corpo: Html }) {
  return <div className="rx-qd-corpo" dangerouslySetInnerHTML={{ __html: corpo }} />;
});

function MoverPara({ titulo, tarefa, destinos, aoMover }: { titulo: string; tarefa: string; destinos: PropsDoCard["destinos"]; aoMover: PropsDoCard["aoMover"] }) {
  return (
    <Menu.Root>
      <Menu.Trigger className="qd-card-mover rx-qd-mover" aria-label={`Mover ${titulo} para…`}>Mover para…</Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="rx-qd-menu-pos" sideOffset={4} align="start">
          <Menu.Popup className="qd-menu qd-menu-mover rx-qd-menu" aria-label={`Mover ${titulo} para`}>
            {destinos(tarefa).map((d) => (
              <Menu.Item key={d.id} className="qd-menu-it" onClick={() => aoMover(tarefa, d.id)}>
                <span className="rx-qd-ic" dangerouslySetInnerHTML={{ __html: d.icone }} />
                <span>{d.nome}</span>
                {d.nota && <small className="qd-menu-porque">{d.nota}</small>}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export const CardDaGrade = memo(CardDaGradeBase, (a, b) =>
  a.coluna === b.coluna && a.aoMover === b.aoMover && a.destinos === b.destinos &&
  a.card.id === b.card.id && a.card.classe === b.card.classe && a.card.corpo === b.card.corpo && a.card.menu === b.card.menu &&
  a.card.arrastavel === b.card.arrastavel && a.card.titulo === b.card.titulo);

/** O card no DragOverlay: só o arrastado, sem dnd-kit nem menu (não é a lista desenhada de novo). */
export const CardFlutuante = memo(function CardFlutuante({ card }: { card: DadosDoCard }) {
  return (
    <div className={`${card.classe} rx-qd-flutuante`} aria-hidden="true">
      <CorpoDoCard corpo={card.corpo} />
    </div>
  );
});
