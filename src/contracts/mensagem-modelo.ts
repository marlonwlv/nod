import type { AnexoDaConversa, RecusasMidia } from "./anexo.ts";
import type { CheckpointDaFala } from "./checkpoint.ts";
import type { Destino, TarefaDaMensagem } from "./destino-no-chat.ts";
import type { Autoria } from "./evento.ts";
import type { EpochMs, TenantId } from "./ids.ts";
import type { Confianca, KindMensagem, PayloadMensagem } from "./mensagem.ts";
import type { MotivoRecomeco, OrigemTurno } from "./turno.ts";

export type Mensagem = {
  tenantId: TenantId;
  id: string;
  conversaId: string;
  turnoId: string | null;
  autoria: Autoria;
  kind: KindMensagem;
  texto: string;
  payload: PayloadMensagem | null;
  confianca: Confianca;
  /** Turno interrompido no meio do streaming deixa a fala parcial marcada (ADR-010). */
  parcial: boolean;
  criadoEm: EpochMs;
  anexos?: AnexoDaConversa[];
  midiaRecusas?: RecusasMidia;
  /** Metadados que permitem à web agrupar as falas sem inferir estado pelo texto. */
  origemTurno?: OrigemTurno | null;
  raiz?: { turnoId: string; origem: OrigemTurno };
  trabalhoId?: string | null;
  fimDoTurno?: boolean;
  bastidores?: boolean;
  turnoDesde?: number;
  motivoRecomeco?: MotivoRecomeco;
  destino?: Destino;
  tarefa?: TarefaDaMensagem;
  checkpoint?: CheckpointDaFala;
};
