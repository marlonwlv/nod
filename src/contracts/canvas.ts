/**
 * definido em 2026-11-04 (ADA-13, ADR-150): o que as rotas do app Canvas devolvem para a tela (a gaveta do Marketplace e
 * a página Canvas da área de Trabalho). A estrutura vai como o domínio a grava (o conteúdo das telas por hash; a página
 * busca os blobs à parte, em GET /canvas/:id/blobs).
 */
export type NivelCanvasDto = "ver_comentar" | "criar_publicar";

export type AppCanvasDto = { instalado: boolean; acessos: { agenteId: string; nivel: NivelCanvasDto }[] };

/** O estado na lista "Todos os canvas" (J7-3, ADA-228); `etapa` é a linha de baixo ("montando a J2-3 · 5 de 9 telas"). */
export type EstadoCanvasDto = "esperando_voce" | "em_producao" | "aprovado";
export type CanvasItemDto = { id: string; issue: string | null; titulo: string; versao: number; origemUrl: string | null; atualizadoEm: number; abertos: number; estado: EstadoCanvasDto; etapa: string | null; aprovadoEm: number | null; telas: number; jornadas: number };

export type ComentarioCanvasDto = {
  id: string; telaId: string | null; jornada: string | null; tipo: "pino" | "nota"; x: number | null; y: number | null; texto: string;
  autorTipo: "pessoa" | "bot" | "importado"; autorNome: string | null;
  /** O bot que escreveu (o mascote da fala, J4-2); null para a pessoa e o importado. */
  autorAgenteId?: string | null; paiId: string | null; versao: number; rodada: number | null; confiavel: boolean;
  resolvido: boolean; arquivado: boolean; criadoEm: number;
};

export type TelaCanvasDto = { id: string; jornada: string; titulo: string; legenda: string; tamanho: "desk" | "cel"; hoje: boolean; novo: string[]; html: string; miniatura: string | null; pendente?: true };
export type EstruturaCanvasDto = {
  issue: string | null; titulo: string; versaoTexto: string | null; links: { rotulo: string; href: string }[]; css: string[]; js: string[];
  jornadas: { id: string; titulo: string; resumo: string; telas: TelaCanvasDto[] }[];
  notas: { titulo: string | null; texto: string; jornada: string | null }[];
};

export type VistaCanvasDto = { canvas: CanvasItemDto; estrutura: EstruturaCanvasDto; confiavel: boolean; versoes: number; comentarios: ComentarioCanvasDto[]; proximaRodada: number };

/** Uma linha do histórico do ▾ da versão (J5-6): quando, o que mudou e o que resolveu. */
export type VersaoCanvasDto = { versao: number; criadoEm: number; resumo: string | null; mudaram: string[]; sairam: string[]; telas: number; jornadas: number; resolvidos: string[]; arquivados: number };

/** O corpo do POST /canvas/:id/comentarios (o endereço é #Jx-y ou #Jx; pai_id responde). */
export type NovoComentarioDto = { texto: string; endereco?: string; tipo?: "pino" | "nota"; x?: number; y?: number; pai_id?: string; rodada?: number; versao?: number };
