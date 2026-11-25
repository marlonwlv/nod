import { memo } from "react";
import { useDraggable } from "@dnd-kit/core";
import { Menu } from "@base-ui/react/menu";
import type { Html } from "../../telas/quadro.ts";

/**
 * ADR-180 (fase 2 do React): um card da grade. O corpo é o mesmo HTML do card por string (web/telas/quadro.ts,
 * `partesDoCard`): os botões de dentro (abrir, prioridade, Responder) seguem na delegação do quadro-na-tela. O que é do
 * React: o `li` arrastável (dnd-kit) e o botão do "Mover para…".
 *
 * Fase 5 da ADR-179 (medido em 2026-11-19): o card é só arrastável (`useDraggable`), não ordenável — sem ordem manual não
 * há o que abrir espaço, e o `useSortable` media os 160 cards a cada arrasto e redesenhava todos a cada coluna sob o
 * ponteiro. O "Mover para…" é um `Menu.Trigger` destacado (o `handle` do Base UI): o menu é um só, na grade, aberto pelo
 * trigger do card com a tarefa como `payload` — um `Menu.Root` por card custava ~70 ms por desenho com 160 cards. O
 * trigger cuida do foco e do teclado (Enter entra no menu, Esc devolve ao botão), como o menu por card fazia.
 *
 * `memo`: o card só redesenha quando o corpo, a classe, o menu aberto ou o arrastável mudam (comparados por valor) — um
 * frame que mexe em outra tarefa não toca neste. A key é o id da tarefa (quem chama).
 */
export interface DestinoDoMover { id: string; nome: string; nota: string | null; icone: Html }

export interface DadosDoCard {
  id: string;
  titulo: string;
  classe: string;
  corpo: Html;
  /** O menu por string que segue aberto no card (o de prioridade); o "Mover para…" é o Menu da grade. */
  menu?: Html;
  arrastavel: boolean;
}

/** O menu único da grade (Menu.createHandle): o trigger do card o abre com o id da tarefa. */
export type MenuDoMover = Menu.Handle<string>;

export interface PropsDoCard {
  card: DadosDoCard;
  coluna: string;
  /** O "Mover para…" da grade (estável: criado uma vez na grade). */
  menu: MenuDoMover;
}

function CardDaGradeBase({ card, coluna, menu }: PropsDoCard) {
  const d = useDraggable({ id: card.id, data: { coluna, tipo: "card" }, disabled: !card.arrastavel });
  return (
    <li
      ref={d.setNodeRef}
      className={`${card.classe}${d.isDragging ? " qd-arrastando" : ""}`}
      data-tarefa={card.id}
      data-rx-arrasta={card.arrastavel ? "1" : undefined}
      {...(card.arrastavel ? d.listeners : {})}
    >
      <CorpoDoCard corpo={card.corpo} />
      {card.arrastavel && (
        <Menu.Trigger handle={menu} payload={card.id} className="qd-card-mover rx-qd-mover" aria-label={`Mover ${card.titulo} para…`}>Mover para…</Menu.Trigger>
      )}
      {card.menu && <CorpoDoCard corpo={card.menu} />}
    </li>
  );
}

/** O HTML do card por string, num `div` com display: contents (o layout do li segue o de antes). */
const CorpoDoCard = memo(function CorpoDoCard({ corpo }: { corpo: Html }) {
  return <div className="rx-qd-corpo" dangerouslySetInnerHTML={{ __html: corpo }} />;
});

/** O mesmo card, por valor (o que muda o que se vê ou o que o arrasto lê). */
export const mesmoCard = (a: DadosDoCard, b: DadosDoCard): boolean =>
  a === b || (a.id === b.id && a.classe === b.classe && a.corpo === b.corpo && a.menu === b.menu && a.arrastavel === b.arrastavel && a.titulo === b.titulo);

export const CardDaGrade = memo(CardDaGradeBase, (a, b) =>
  a.coluna === b.coluna && a.menu === b.menu && mesmoCard(a.card, b.card));

/** O card no DragOverlay: só o arrastado, sem dnd-kit nem menu (não é a lista desenhada de novo). */
export const CardFlutuante = memo(function CardFlutuante({ card }: { card: DadosDoCard }) {
  return (
    <div className={`${card.classe} rx-qd-flutuante`} aria-hidden="true">
      <CorpoDoCard corpo={card.corpo} />
    </div>
  );
});
