import { memo, useCallback, useMemo, useState, type CSSProperties } from "react";
import { DndContext, DragOverlay, PointerSensor, pointerWithin, rectIntersection, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
import { Menu } from "@base-ui/react/menu";
import type { Html, PartesDaColuna } from "../../telas/quadro.ts";
import { CardDaGrade, CardFlutuante, mesmoCard, type DadosDoCard, type DestinoDoMover, type MenuDoMover as HandleDoMover } from "./card-da-grade.tsx";

/**
 * ADR-180 (fase 2 do React): a grade do quadro no computador. As colunas e os cards vêm prontos do quadro-real.ts (as
 * mesmas partes do desenho por string); aqui ficam o arrasto (dnd-kit) e o "Mover para…" (Base UI). Quem decide o que
 * soltar faz — a trava, o diálogo de handoff da coluna com responsável, o mudar_tarefa otimista, a ordem — é o
 * quadro-na-tela, pelas `acoes`: a regra é uma só para o arrasto, o menu e o teclado.
 *
 * Fase 5 da ADR-179 (medido em 2026-11-19 com 160 cards): a coluna que não mudou não redesenha (memo por valor: o
 * desenho por string recria os objetos a cada frame), o "Mover para…" é um menu só para a grade inteira, e os cards são
 * só arrastáveis (sem ordem manual não há o que reordenar; com ela, a coluna volta a ter o `SortableContext`).
 */
export interface ColunaDaGrade { partes: PartesDaColuna; antes: Html[]; cards: DadosDoCard[] }
export type ItemDaGrade = { tipo: "coluna"; coluna: ColunaDaGrade } | { tipo: "extra"; chave: string; html: Html };

export interface AcoesDaGrade {
  /** A pessoa soltou (ou escolheu no menu) a tarefa numa coluna; a mesma coluna também chega (a ordem decide). */
  soltar: (tarefa: string, coluna: string) => void;
  /** A linha sob o cabeçalho da coluna sob o card ("Começa com Fulano"); null = nada a dizer. */
  dica: (tarefa: string, coluna: string) => string | null;
  destinos: (tarefa: string) => readonly DestinoDoMover[];
  /** Começou ou acabou um arrasto (o quadro-na-tela segura a regravação enquanto dura). */
  arrastando: (ativo: boolean) => void;
}

export interface PropsDaGrade { rotulo: string; classe: string; trilhas: string; itens: ItemDaGrade[]; acoes: AcoesDaGrade }

/** Não arrasta a partir de campo, do botão "Mover para…" ou de menu aberto: o card só pega no corpo (o clique curto segue sendo clique). */
class SensorDoCard extends PointerSensor {
  static override activators = [{
    eventName: "onPointerDown" as const,
    handler: ({ nativeEvent: e }: { nativeEvent: PointerEvent }) =>
      e.isPrimary && e.button === 0 && !(e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable], .rx-qd-mover, .qd-menu")),
  }];
}

/** A coluna sob o ponteiro; fora de qualquer uma, a que o card cobre mais. */
const colisao: CollisionDetection = (a) => { const sob = pointerWithin(a); return sob.length ? sob : rectIntersection(a); };
const colunaDoAlvo = (over: DragOverEvent["over"]): string | null => (over?.data.current?.["coluna"] as string | undefined) ?? null;

export function GradeDoQuadro({ rotulo, classe, trilhas, itens, acoes }: PropsDaGrade) {
  const sensores = useSensors(useSensor(SensorDoCard, { activationConstraint: { distance: 6 } }));
  const [ativo, setAtivo] = useState<{ card: DadosDoCard; de: string } | null>(null);
  const [alvo, setAlvo] = useState<{ coluna: string; dica: string | null } | null>(null);
  const [menu] = useState<HandleDoMover>(() => Menu.createHandle<string>());
  const cardDe = useMemo(() => {
    const m = new Map<string, { card: DadosDoCard; de: string }>();
    for (const i of itens) if (i.tipo === "coluna") for (const c of i.coluna.cards) m.set(c.id, { card: c, de: i.coluna.partes.id });
    return m;
  }, [itens]);
  const fim = useCallback(() => { setAtivo(null); setAlvo(null); acoes.arrastando(false); }, [acoes]);
  const inicio = useCallback((e: DragStartEvent) => {
    const a = cardDe.get(String(e.active.id));
    if (!a) return;
    setAtivo(a);
    acoes.arrastando(true);
  }, [acoes, cardDe]);
  const sobre = useCallback((e: DragOverEvent) => {
    const coluna = colunaDoAlvo(e.over);
    const tarefa = String(e.active.id);
    setAlvo((x) => (x?.coluna === coluna ? x : coluna ? { coluna, dica: acoes.dica(tarefa, coluna) } : null));
  }, [acoes]);
  const soltou = useCallback((e: DragEndEvent) => {
    const tarefa = String(e.active.id);
    const coluna = colunaDoAlvo(e.over);
    fim();
    if (coluna) acoes.soltar(tarefa, coluna);
  }, [acoes, fim]);
  return (
    <div className={`qd-quadro ${classe}`} role="region" aria-label={rotulo}>
      <DndContext sensors={sensores} collisionDetection={colisao} onDragStart={inicio} onDragOver={sobre} onDragEnd={soltou} onDragCancel={fim}>
        <div className="qd-grade" style={{ gridTemplateColumns: trilhas }}>
          {itens.map((i) => i.tipo === "extra"
            ? <Extra key={i.chave} html={i.html} />
            : <ColunaRx key={i.coluna.partes.id} coluna={i.coluna} alvo={alvo?.coluna === i.coluna.partes.id && ativo?.de !== i.coluna.partes.id ? alvo : null} menu={menu} />)}
        </div>
        <DragOverlay dropAnimation={null}>{ativo ? <CardFlutuante card={ativo.card} /> : null}</DragOverlay>
      </DndContext>
      <MenuDoMover menu={menu} titulo={(t) => cardDe.get(t)?.card.titulo ?? ""} destinos={acoes.destinos} aoMover={acoes.soltar} />
    </div>
  );
}

/** O "Mover para…" da grade inteira (Base UI): aberto pelo trigger do card (handle), com a tarefa como payload. */
function MenuDoMover({ menu, titulo, destinos, aoMover }: { menu: HandleDoMover; titulo: (tarefa: string) => string; destinos: AcoesDaGrade["destinos"]; aoMover: AcoesDaGrade["soltar"] }) {
  return (
    <Menu.Root handle={menu}>
      {({ payload: tarefa }: { payload: string | undefined }) => (
      <Menu.Portal>
        <Menu.Positioner className="rx-qd-menu-pos" sideOffset={4} align="start">
          <Menu.Popup className="qd-menu qd-menu-mover rx-qd-menu" aria-label={tarefa ? `Mover ${titulo(tarefa)} para` : undefined}>
            {tarefa && destinos(tarefa).map((d) => (
              <Menu.Item key={d.id} className="qd-menu-it" onClick={() => aoMover(tarefa, d.id)}>
                <span className="rx-qd-ic" dangerouslySetInnerHTML={{ __html: d.icone }} />
                <span>{d.nome}</span>
                {d.nota && <small className="qd-menu-porque">{d.nota}</small>}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
      )}
    </Menu.Root>
  );
}

const Extra = memo(function Extra({ html }: { html: Html }) {
  return <div className="rx-qd-extra" dangerouslySetInnerHTML={{ __html: html }} />;
});

interface PropsDaColuna { coluna: ColunaDaGrade; alvo: { dica: string | null } | null; menu: HandleDoMover }

const mesmasPartes = (a: PartesDaColuna, b: PartesDaColuna): boolean =>
  a === b || (a.id === b.id && a.classe === b.classe && a.rotulo === b.rotulo && a.grupo === b.grupo && a.direita === b.direita && a.tira === b.tira && a.cab === b.cab && a.dica === b.dica && a.fim === b.fim);
const mesmaLista = <T,>(a: readonly T[], b: readonly T[], igual: (x: T, y: T) => boolean): boolean => a === b || (a.length === b.length && a.every((x, i) => igual(x, b[i] as T)));
/** A mesma coluna, por valor: o desenho por string recria os objetos a cada frame, mas o que se vê quase nunca muda. */
export const mesmaColuna = (a: ColunaDaGrade, b: ColunaDaGrade): boolean =>
  a === b || (mesmasPartes(a.partes, b.partes) && mesmaLista(a.antes, b.antes, (x, y) => x === y) && mesmaLista(a.cards, b.cards, mesmoCard));

const ColunaRx = memo(function ColunaRx({ coluna, alvo, menu }: PropsDaColuna) {
  const p = coluna.partes;
  const { setNodeRef } = useDroppable({ id: `coluna:${p.id}`, data: { coluna: p.id, tipo: "coluna" } });
  const estilo: CSSProperties | undefined = p.direita !== undefined ? { right: p.direita } : undefined;
  const dados = { "data-status": p.id, "data-coluna": p.id, "data-grupo": p.grupo };
  if (p.tira) return <section ref={setNodeRef} className={p.classe} aria-label={p.rotulo} {...dados} style={estilo} dangerouslySetInnerHTML={{ __html: p.tira }} />;
  return (
    <section ref={setNodeRef} className={`${p.classe}${alvo ? " qd-alvo" : ""}`} aria-label={p.rotulo} {...dados} style={estilo}>
      <h3 className="qd-col-cab" dangerouslySetInnerHTML={{ __html: p.cab }} />
      {alvo?.dica && <p className="qd-dica-soltar" aria-live="polite">{alvo.dica}</p>}
      {p.dica && <div className="rx-qd-extra" dangerouslySetInnerHTML={{ __html: p.dica }} />}
      <ul className="qd-col-lista">
        {coluna.antes.map((h, i) => <Extra key={`antes-${i}`} html={h} />)}
        {coluna.cards.map((c) => <CardDaGrade key={c.id} card={c} coluna={p.id} menu={menu} />)}
        {p.fim && <Extra html={p.fim} />}
      </ul>
    </section>
  );
}, (a, b) => a.alvo === b.alvo && a.menu === b.menu && mesmaColuna(a.coluna, b.coluna));
