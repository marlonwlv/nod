import type { AmbienteComputador, DriverComputador } from "../../../contracts/computador.ts";
import type { ConfigProvedores, IdProvedorComputador, ProvedorDeComputador, RefComputador } from "../../../contracts/provedor-computador.ts";
import { FalhaComputador } from "../../../domain/computador.ts";
import { escolherProvedor } from "../../../domain/provedor-computador.ts";
import { log } from "../../../obs/log.ts";
import { criarExecutorPorPrimitivas } from "./primitivas.ts";

type Escopo = { tenantId: string; pessoaId: string };

/**
 * ADR-168 (definido em 2026-11-12): o `DriverComputador` que o portão (fundo/computadores.ts) sempre usou, agora montado
 * por cima de N provedores. Cada chamada escolhe o provedor do computador pela configuração (bot > pessoa > global >
 * padrão) e delega. O portão, as ferramentas `computador_*`, o plano de turno e o agente NÃO mudam.
 *
 * Troca de provedor com o computador ligado: o seletor lembra quem ligou cada computador neste processo; se a escolha
 * mudou, desliga no provedor antigo antes de ligar no novo (os arquivos e logins NÃO migram entre provedores: cada um tem
 * o seu disco; ver a ADR).
 */
export type OpcoesSeletor = {
  config: ConfigProvedores;
  provedores: Partial<Record<IdProvedorComputador, ProvedorDeComputador>>;
  /** O bot do computador (repos.computadores.agenteDoComputador), para a regra por bot. Sem escopo, null. */
  agenteDe: (id: string, escopo: Escopo) => Promise<string | null>;
};

export type DriverPorProvedor = DriverComputador & {
  /** Quem dá (ou daria) o computador agora — para a tela de máquinas e o log. */
  provedorDe(id: string, escopo?: Escopo): Promise<IdProvedorComputador | null>;
  /** O provedor montado, para as operações que só alguns têm (snapshot, suspender, tela ao vivo por VNC). */
  provedor(id: IdProvedorComputador): ProvedorDeComputador | null;
};

const SEM_PROVEDOR: AmbienteComputador = { disponivel: false, motivo: "Nenhum provedor de computador configurado no servidor (NOD_COMPUTADORES ou NOD_COMPUTADOR_PROVEDOR)." };

export function criarDriverPorProvedor(o: OpcoesSeletor): DriverPorProvedor {
  const executores = new Map<IdProvedorComputador, ReturnType<typeof criarExecutorPorPrimitivas>>();
  for (const [id, p] of Object.entries(o.provedores) as [IdProvedorComputador, ProvedorDeComputador][]) {
    if (!p.executar && p.primitivas) executores.set(id, criarExecutorPorPrimitivas(p.primitivas, { raiz: p.raizDeTrabalho ?? "/workspace" }));
    if (!p.executar && !p.primitivas) throw new Error(`provedor ${id} sem plano de dados (executar ou primitivas)`);
  }
  /** Quem ligou cada computador neste processo (para desligar no antigo quando a escolha muda). */
  const ligadoEm = new Map<string, IdProvedorComputador>();

  async function escolher(id: string, escopo?: Escopo): Promise<IdProvedorComputador | null> {
    const agenteId = escopo ? await o.agenteDe(id, escopo).catch(() => null) : null;
    return escolherProvedor(o.config, { pessoaId: escopo?.pessoaId ?? null, agenteId });
  }
  async function provedorDe(id: string, escopo?: Escopo): Promise<ProvedorDeComputador> {
    const qual = await escolher(id, escopo);
    const p = qual ? o.provedores[qual] : undefined;
    if (!p) throw new FalhaComputador("nao_iniciou", { detalhe: qual ? `o provedor ${qual} não está montado neste servidor` : SEM_PROVEDOR.motivo });
    return p;
  }
  const ref = (id: string, escopo?: Escopo): RefComputador => (escopo ? { id, escopo } : { id });

  return {
    async provedorDe(id, escopo) { return escolher(id, escopo); },
    provedor: (id) => o.provedores[id] ?? null,
    async ambiente() {
      const qual = o.config.global ?? o.config.padrao;
      const p = qual ? o.provedores[qual] : undefined;
      if (p) return p.ambiente();
      // Sem global, mas com regra por pessoa/bot: o ambiente é o do primeiro montado (o painel mostra o do bot ao ligar).
      const algum = Object.values(o.provedores)[0];
      return algum ? algum.ambiente() : SEM_PROVEDOR;
    },
    async estado(id, escopo) {
      const p = await provedorDe(id, escopo).catch(() => null);
      if (!p) return { ...SEM_PROVEDOR, ativo: false };
      const a = await p.ambiente(escopo ? { escopo } : undefined);
      if (!a.disponivel) return { ...a, ativo: false };
      const s = await p.saude(ref(id, escopo)).catch(() => null);
      return { disponivel: true, ativo: s?.estado === "ligado", motivo: a.motivo, reinicios: s?.reinicios ?? null, ...(a.limite ? { limite: a.limite } : {}) };
    },
    async iniciar(id, escopo) {
      const p = await provedorDe(id, escopo);
      const antes = ligadoEm.get(id);
      if (antes && antes !== p.id) {
        log("info", "computador_provedor_trocado", { computador_id: id, de: antes, para: p.id });
        await o.provedores[antes]?.parar(ref(id, escopo)).catch(() => undefined);
      }
      await p.iniciar(ref(id, escopo));
      ligadoEm.set(id, p.id);
    },
    async parar(id, escopo) {
      const p = await provedorDe(id, escopo);
      await p.parar(ref(id, escopo));
      const antes = ligadoEm.get(id);
      if (antes && antes !== p.id) await o.provedores[antes]?.parar(ref(id, escopo)).catch(() => undefined);
      ligadoEm.delete(id);
      executores.get(p.id)?.esquecer(id);
    },
    async executar(id, acao, escopo, autor) {
      const p = await provedorDe(id, escopo);
      if (p.executar) return p.executar(ref(id, escopo), acao, autor);
      const ex = executores.get(p.id);
      if (!ex) throw new FalhaComputador("acao_falhou", { detalhe: `o provedor ${p.id} não tem plano de dados` });
      return ex.executar(ref(id, escopo), acao);
    },
    async ligados() {
      const todos = new Set<string>();
      for (const p of Object.values(o.provedores)) for (const id of await p.ligados().catch(() => new Set<string>())) todos.add(id);
      return todos;
    },
  };
}
