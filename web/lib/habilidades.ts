import type { TarefaEnsinada } from "../../src/contracts/navegador-do-bot.ts";
import type { TelaHabilidades } from "./navegador-cartoes.ts";

/**
 * Ajustes do bot › Habilidades (ADR-190, T3): as tarefas que a pessoa ensinou no navegador. O estado mora fora do reducer,
 * como o do Cofre: o nível Ajustes (web/telas/detalhes.ts) é puro e lê `telaDasHabilidades`; a primeira leitura é pedida
 * por `pedirHabilidades` (o controlador registrado pelo main.ts busca e redesenha).
 *
 * Apagar tem Desfazer em vez de pergunta (D0: "desfazer > confirmar"): a linha some na hora e o DELETE só sai quando o
 * aviso acaba (`MS_DESFAZER_HABILIDADE`). Desfazer cancela o pedido e a linha volta.
 */
export const MS_DESFAZER_HABILIDADE = 5_500;

type Api = { tarefasEnsinadas(agenteId: string): Promise<{ tarefas: TarefaEnsinada[]; espacoBytes?: number | null }>; apagarTarefaEnsinada(agenteId: string, id: string): Promise<{ ok: true }> };
type Opcoes = {
  api: () => Api | null;
  render: () => void;
  /** O aviso com Desfazer (web/lib/aviso-desfazer.ts no app). */
  avisar: (texto: string, desfazer: () => void) => void;
  aoErro: (e: unknown) => void;
  /** Os testes passam o relógio. */
  esperar?: (fn: () => void, ms: number) => unknown;
  cancelar?: (t: unknown) => void;
};

const telas = new Map<string, TelaHabilidades>();
let versao = 0;
/** Muda a cada mudança da seção: entra nos extras da lembrança do painel do bot (web/lib/gaveta-render.ts). */
export function versaoDasHabilidades(): number {
  return versao;
}
let controlador: ReturnType<typeof criarControlador> | null = null;

/** O que o nível Ajustes lê (null = ainda não pediu). */
export function telaDasHabilidades(agenteId: string): TelaHabilidades | null {
  return telas.get(agenteId) ?? null;
}

/** O nível Ajustes chama ao desenhar: pede a lista uma vez por bot (sem controlador, não faz nada). */
export function pedirHabilidades(agenteId: string): void {
  controlador?.pedir(agenteId);
}

function criarControlador(o: Opcoes) {
  const pedidos = new Set<string>();
  const esperar = o.esperar ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const cancelar = o.cancelar ?? ((t: unknown) => globalThis.clearTimeout(t as ReturnType<typeof setTimeout>));
  const mudar = (id: string, p: Partial<TelaHabilidades>) => {
    const atual = telas.get(id) ?? { tarefas: null, erro: false, abertas: new Set<string>(), apagando: new Set<string>() };
    telas.set(id, { ...atual, ...p });
    versao++;
    o.render();
  };
  async function reler(id: string): Promise<void> {
    const api = o.api();
    if (!api) return;
    pedidos.add(id);
    try {
      const r = await api.tarefasEnsinadas(id);
      mudar(id, { tarefas: r.tarefas, erro: false, espacoBytes: r.espacoBytes ?? null });
    } catch {
      mudar(id, { erro: true });
    }
  }
  return {
    pedir(id: string): void {
      if (pedidos.has(id)) return;
      pedidos.add(id);
      // Fora do desenho: quem chama está no meio do render.
      queueMicrotask(() => void reler(id));
    },
    reler,
    alternar(id: string, tarefa: string): void {
      const t = telas.get(id);
      if (!t) return;
      const abertas = new Set(t.abertas);
      if (abertas.has(tarefa)) abertas.delete(tarefa);
      else abertas.add(tarefa);
      mudar(id, { abertas });
    },
    apagar(id: string, tarefa: string): void {
      const t = telas.get(id);
      const alvo = t?.tarefas?.find((x) => x.id === tarefa);
      if (!t || !alvo) return;
      mudar(id, { apagando: new Set([...t.apagando, tarefa]) });
      const devolver = () => {
        const agora = telas.get(id);
        if (!agora) return;
        const apagando = new Set(agora.apagando);
        apagando.delete(tarefa);
        mudar(id, { apagando });
      };
      const timer = esperar(() => {
        const api = o.api();
        if (!api) { devolver(); return; }
        api.apagarTarefaEnsinada(id, tarefa)
          .then(() => {
            const agora = telas.get(id);
            if (!agora) return;
            const apagando = new Set(agora.apagando);
            apagando.delete(tarefa);
            mudar(id, { tarefas: (agora.tarefas ?? []).filter((x) => x.id !== tarefa), apagando });
          })
          .catch((e: unknown) => { devolver(); o.aoErro(e); });
      }, MS_DESFAZER_HABILIDADE);
      o.avisar(`“${alvo.nome}” apagada`, () => { cancelar(timer); devolver(); });
    },
  };
}

/** O main.ts registra o controlador uma vez (os testes chamam de novo com outro). */
export function registrarHabilidades(o: Opcoes): NonNullable<typeof controlador> {
  telas.clear();
  controlador = criarControlador(o);
  return controlador;
}
