import { memo, useCallback, useMemo, useState, type CSSProperties } from "react";
import { DndContext, DragOverlay, PointerSensor, pointerWithin, rectIntersection, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, type SortingStrategy } from "@dnd-kit/sortable";
import type { Html, PartesDaColuna } from "../../telas/quadro.ts";
import { CardDaGrade, CardFlutuante, type DadosDoCard, type DestinoDoMover } from "./card-da-grade.tsx";
import "./grade-do-quadro.css";

/**
 * ADR-180 (fase 2 do React): a grade do quadro no computador. As colunas e os cards vêm prontos do quadro-real.ts (as
 * mesmas partes do desenho por string); aqui ficam o arrasto (dnd-kit) e o "Mover para…" (Base UI). Quem decide o que
 * soltar faz — a trava, o diálogo de handoff da coluna com responsável, o mudar_tarefa otimista, a ordem — é o
 * quadro-na-tela, pelas `acoes`: a regra é uma só para o arrasto, o menu e o teclado.
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
  /** Reordenar dentro da coluna (ordem manual). Sem isto, os cards não abrem espaço e soltar na própria coluna é `soltar`. */
  reordenar?: (tarefa: string, antesDe: string | null) => void;
}

export interface PropsDaGrade { rotulo: string; classe: string; trilhas: string; itens: ItemDaGrade[]; acoes: AcoesDaGrade }

/** Não arrasta a partir de campo, botão de menu aberto ou link: o card só pega no corpo (o clique curto segue sendo clique). */
class SensorDoCard extends PointerSensor {
  static override activators = [{
    eventName: "onPointerDown" as const,
    handler: ({ nativeEvent: e }: { nativeEvent: PointerEvent }) =>
      e.isPrimary && e.button === 0 && !(e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable], .rx-qd-mover, .qd-menu")),
  }];
}

/** Sem reordenar, os outros cards ficam parados (nada de abrir espaço que não vai ser gravado). */
const parado: SortingStrategy = () => null;
/** A coluna sob o ponteiro; fora de qualquer uma, a que o card cobre mais. */
const colisao: CollisionDetection = (a) => { const sob = pointerWithin(a); return sob.length ? sob : rectIntersection(a); };
const colunaDoAlvo = (over: DragOverEvent["over"]): string | null => (over?.data.current?.["coluna"] as string | undefined) ?? null;

export function GradeDoQuadro({ rotulo, classe, trilhas, itens, acoes }: PropsDaGrade) {
  const sensores = useSensors(useSensor(SensorDoCard, { activationConstraint: { distance: 6 } }));
  const [ativo, setAtivo] = useState<{ card: DadosDoCard; de: string } | null>(null);
  const [alvo, setAlvo] = useState<{ coluna: string; dica: string | null } | null>(null);
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
    const de = cardDe.get(tarefa)?.de;
    fim();
    if (!coluna) return;
    if (coluna === de && acoes.reordenar && e.over && e.over.id !== tarefa) {
      acoes.reordenar(tarefa, e.over.data.current?.["tipo"] === "card" ? String(e.over.id) : null);
      return;
    }
    acoes.soltar(tarefa, coluna);
  }, [acoes, cardDe, fim]);
  const estrategia = acoes.reordenar ? verticalListSortingStrategy : parado;
  return (
    <div className={`qd-quadro ${classe}`} role="region" aria-label={rotulo}>
      <DndContext sensors={sensores} collisionDetection={colisao} onDragStart={inicio} onDragOver={sobre} onDragEnd={soltou} onDragCancel={fim}>
        <div className="qd-grade" style={{ gridTemplateColumns: trilhas }}>
          {itens.map((i) => i.tipo === "extra"
            ? <Extra key={i.chave} html={i.html} />
            : <ColunaRx key={i.coluna.partes.id} coluna={i.coluna} alvo={alvo?.coluna === i.coluna.partes.id && ativo?.de !== i.coluna.partes.id ? alvo : null} estrategia={estrategia} acoes={acoes} />)}
        </div>
        <DragOverlay dropAnimation={null}>{ativo ? <CardFlutuante card={ativo.card} /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

const Extra = memo(function Extra({ html }: { html: Html }) {
  return <div className="rx-qd-extra" dangerouslySetInnerHTML={{ __html: html }} />;
});

interface PropsDaColuna { coluna: ColunaDaGrade; alvo: { dica: string | null } | null; estrategia: SortingStrategy; acoes: AcoesDaGrade }

const ColunaRx = memo(function ColunaRx({ coluna, alvo, estrategia, acoes }: PropsDaColuna) {
  const p = coluna.partes;
  const { setNodeRef } = useDroppable({ id: `coluna:${p.id}`, data: { coluna: p.id, tipo: "coluna" } });
  const ids = useMemo(() => coluna.cards.map((c) => c.id), [coluna.cards]);
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
        <SortableContext items={ids} strategy={estrategia}>
          {coluna.cards.map((c) => <CardDaGrade key={c.id} card={c} coluna={p.id} destinos={acoes.destinos} aoMover={acoes.soltar} />)}
        </SortableContext>
        {p.fim && <Extra html={p.fim} />}
      </ul>
    </section>
  );
});
