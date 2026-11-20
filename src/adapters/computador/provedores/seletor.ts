import type { AmbienteComputador, DriverComputador } from "../../../contracts/computador.ts";
import type { ConfigProvedores, IdProvedorComputador, ProvedorDeComputador, RefComputador } from "../../../contracts/provedor-computador.ts";
import { FalhaComputador } from "../../../domain/computador.ts";
import { escolherProvedor } from "../../../domain/provedor-computador.ts";
import { log } from "../../../obs/log.ts";
import { criarExecutorPorPrimitivas } from "./primitivas.ts";
import { abrirOrigemRfb } from "../relay-vnc.ts";
import type { LadoVivo } from "../vivo.ts";
import type { SessaoVivo } from "../../../contracts/computador-vivo.ts";

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
  /** Resolve o id que o portão usa (display) para a alocação compartilhada e o bot. */
  localizar?: (id: string, escopo: Escopo) => Promise<{ computadorId: string; telaId: string | null; agenteId: string | null } | null>;
  /** Compatibilidade do contrato antigo; só para testes/adaptadores ainda não migrados. */
  agenteDe?: (id: string, escopo: Escopo) => Promise<string | null>;
  /** Pareia uma origem já autenticada com a sessão pública; URL e segredo nunca saem dos adapters. */
  anexarVivo?: (sessao: string, token: string, origem: LadoVivo) => boolean;
  /** Injetável para o teste do seletor; em produção abre e autentica o relay RFB. */
  abrirVivo?: typeof abrirOrigemRfb;
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
  /** O que este processo ligou: o provedor e, fora das telas (que já contam em `telasLigadas`), o id nosso para o varredor. */
  const ligadoEm = new Map<string, { id: string | null; provedor: IdProvedorComputador }>();
  /** Liga/desliga em série por computador: uma resposta antiga nunca sobrescreve a escolha mais recente. */
  const operacoes = new Map<string, Promise<void>>();
  async function emSerie(chave: string, executar: () => Promise<void>): Promise<void> {
    const anterior = operacoes.get(chave) ?? Promise.resolve();
    const atual = anterior.catch(() => undefined).then(executar);
    operacoes.set(chave, atual);
    try {
      await atual;
    } finally {
      if (operacoes.get(chave) === atual) operacoes.delete(chave);
    }
  }
  const telasLigadas = new Set<string>();
  const chaveDe = (id: string, escopo?: Escopo) => escopo ? `${escopo.tenantId}:${escopo.pessoaId}:${id}` : `sem-escopo:${id}`;

  async function refDe(id: string, escopo?: Escopo): Promise<RefComputador> {
    if (!escopo) return { id };
    if (o.localizar) {
      const l = await o.localizar(id, escopo);
      if (!l) throw new FalhaComputador("nao_iniciou", { detalhe: "computador ou display não encontrado" });
      return { id: l.computadorId, escopo, ...(l.telaId ? { telaId: l.telaId } : {}), ...(l.agenteId ? { agenteId: l.agenteId } : {}) };
    }
    return { id, escopo, ...(o.agenteDe ? { agenteId: await o.agenteDe(id, escopo) ?? undefined } : {}) };
  }
  async function escolher(ref: RefComputador): Promise<IdProvedorComputador | null> {
    // Falha fechada: erro ao ler o vínculo não pode cair no provedor global e abrir o perfil em outra conta.
    // Uma máquina compartilhada não pode ser repartida por overrides de bot: isso criaria uma máquina Docker e outra
    // Orgo para a mesma pessoa. Overrides por bot continuam valendo apenas no contrato legado sem computador_tela.
    return escolherProvedor(o.config, { pessoaId: ref.escopo?.pessoaId ?? null, agenteId: ref.telaId ? null : ref.agenteId ?? null });
  }
  async function provedorDe(id: string, escopo?: Escopo): Promise<{ p: ProvedorDeComputador; ref: RefComputador; qual: IdProvedorComputador }> {
    const ref = await refDe(id, escopo);
    const qual = await escolher(ref);
    if (!qual) throw new FalhaComputador("nao_iniciou", { detalhe: SEM_PROVEDOR.motivo });
    const p = o.provedores[qual];
    if (!p) throw new FalhaComputador("nao_iniciou", { detalhe: `o provedor ${qual} não está montado neste servidor` });
    return { p, ref, qual };
  }

  return {
    async provedorDe(id, escopo) { return escolher(await refDe(id, escopo)); },
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
      const resolvido = await provedorDe(id, escopo).catch(() => null);
      if (!resolvido) return { ...SEM_PROVEDOR, ativo: false };
      const { p, ref } = resolvido;
      const a = await p.ambiente(ref);
      if (!a.disponivel) return { ...a, ativo: false };
      const s = await p.saude(ref).catch(() => null);
      return { disponivel: true, ativo: s?.estado === "ligado", motivo: a.motivo, reinicios: s?.reinicios ?? null, ...(a.limite ? { limite: a.limite } : {}) };
    },
    async iniciar(id, escopo) {
      // QA (rodada 28): dois "ligar" juntos liam o mapa vazio, ligavam Docker e Orgo para o mesmo bot e a resposta
      // antiga ficava como estado final. Em série, o segundo vê o primeiro e desliga o provedor anterior antes.
      await emSerie(chaveDe(id, escopo), async () => {
        const { p, ref, qual } = await provedorDe(id, escopo);
        const chave = chaveDe(ref.id, escopo);
        const antes = ligadoEm.get(chave);
        if (antes && antes.provedor !== p.id) {
          log("info", "computador_provedor_trocado", { computador_id: ref.id, de: antes.provedor, para: p.id });
          await o.provedores[antes.provedor]?.parar({ id: ref.id, ...(escopo ? { escopo } : {}) }).catch(() => undefined);
          ligadoEm.delete(chave);
        }
        await p.iniciar(ref);
        ligadoEm.set(chave, { id: ref.telaId ? null : ref.id, provedor: qual });
        if (ref.telaId) telasLigadas.add(chaveDe(ref.telaId, escopo));
      });
    },
    async parar(id, escopo) {
      await emSerie(chaveDe(id, escopo), async () => {
        const { p, ref } = await provedorDe(id, escopo);
        await p.parar(ref);
        if (ref.telaId) {
          telasLigadas.delete(chaveDe(ref.telaId, escopo));
          return;
        }
        const chave = chaveDe(ref.id, escopo);
        const antes = ligadoEm.get(chave);
        if (antes && antes.provedor !== p.id) await o.provedores[antes.provedor]?.parar(ref).catch(() => undefined);
        ligadoEm.delete(chave);
        executores.get(p.id)?.esquecer(ref);
      });
    },
    async executar(id, acao, escopo, autor) {
      const { p, ref } = await provedorDe(id, escopo);
      if (p.executar) return p.executar(ref, acao, autor);
      const ex = executores.get(p.id);
      if (!ex) throw new FalhaComputador("acao_falhou", { detalhe: `o provedor ${p.id} não tem plano de dados` });
      return ex.executar(ref, acao);
    },
    async vivo(id: string, sessao: SessaoVivo, escopo?: Escopo) {
      const { p, ref } = await provedorDe(id, escopo);
      if (!escopo || p.capacidades.telaAoVivo !== "vnc_websocket" || (!p.acessoTela && !p.abrirTelaAoVivo) || !o.anexarVivo) throw new FalhaComputador("nao_iniciou", { detalhe: "o provedor usa capturas para esta tela" });
      const origem = p.abrirTelaAoVivo
        ? await p.abrirTelaAoVivo(ref)
        : await (o.abrirVivo ?? abrirOrigemRfb)(await p.acessoTela!(ref));
      if (o.anexarVivo(sessao.sessao, sessao.token, origem)) return;
      origem.fechar(1008, "sessao encerrada");
      throw new FalhaComputador("acao_falhou", { detalhe: "a sessão ao vivo expirou" });
    },
    async ligados() {
      const todos = new Set<string>();
      for (const p of Object.values(o.provedores)) for (const id of await p.ligados().catch(() => new Set<string>())) todos.add(id);
      for (const id of telasLigadas) todos.add(id.slice(id.lastIndexOf(":") + 1));
      // QA (rodada 28): um provedor externo (Orgo) não lista as máquinas sem o escopo e a chave da pessoa, e o varredor
      // de ociosidade usa esta foto global antes de percorrer os escopos: sem isto o display do Orgo ficava ligado (e
      // cobrando) para sempre. Entra também o que este processo ligou; `parar` é idempotente e tira a marca.
      for (const ligado of ligadoEm.values()) if (ligado.id) todos.add(ligado.id);
      return todos;
    },
  };
}
