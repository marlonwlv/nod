import type { AmbienteComputador } from "../../../contracts/computador.ts";
import type { AcessoTelaAoVivo, BotaoMouse, CapacidadesProvedor, EstadoNoProvedor, PrimitivasDeComputador, ProvedorDeComputador, RefComputador, SaudeComputador } from "../../../contracts/provedor-computador.ts";
import { FalhaComputador } from "../../../domain/computador.ts";
import { aspasShell } from "../../../domain/provedor-computador.ts";
import { log } from "../../../obs/log.ts";

/**
 * ADR-168 (definido em 2026-11-12): driver de EXEMPLO de um provedor de fora, o Orgo (https://docs.orgo.ai, API REST em
 * https://www.orgo.ai/api, spec 2.0.0). Só existe com `NOD_COMPUTADOR_ORGO=1` e só é escolhido quando a configuração do
 * provedor aponta para "orgo" (global, pessoa ou bot). Escrito pela documentação, SEM conta: nenhum teste chama a rede.
 *
 * A chave (`sk_live_…`) é da pessoa e mora no COFRE do nod: o conector `orgo`, chave `ORGO_API_KEY`, guardada pelo cartão do
 * `pedir_credencial` (alvo `conector`). Ela nunca vem do env do servidor, do código, de log nem de mensagem; este arquivo a
 * recebe por `chaveDe(escopo)` a cada chamada e não a guarda (a chave revogada para de funcionar na hora).
 *
 * Mapeamento (tabela completa na ADR-168):
 *   criar     POST /computers (workspace + nome `nod-<id>`, Idempotency-Key)      iniciar  POST /computers/{id}/start|resume
 *   parar     POST /computers/{id}/stop (arquiva o disco: fica `frozen`)          retomar  POST /computers/{id}/resume
 *   suspender POST /computers/{id}/suspend (memória e disco)                      saúde    GET /computers/{id}/health
 *   snapshot  POST /computers/{id}/clone (a foto é um computador novo; não há restaurar no lugar)
 *   tela      GET /computers/{id}/screenshot?response_format=base64 · ao vivo: wss {connection_url}/ws/websockify?token=
 *   mouse/teclado  POST click | drag | type | key | scroll                           terminal POST /computers/{id}/bash
 *   arquivos  pelo bash (base64 em pedaços); o /files do Orgo é a loja do workspace, não o disco da máquina
 *   navegador pela tela (sem CDP/Playwright exposto): abrir URL é um comando no Chrome da máquina
 */

export const BASE_ORGO = "https://www.orgo.ai/api";
const PRAZO_HTTP_MS = 60_000;
const PRAZO_PRONTO_MS = 180_000;
const RESOLUCAO = "1280x800x24";

export const CAPACIDADES_ORGO: CapacidadesProvedor = {
  retomarComMemoria: true,
  snapshot: "so_copia",
  telaAoVivo: "vnc_websocket",
  terminal: "pty",
  navegador: "tela",
  audio: false,
  onde: "nuvem_de_terceiro",
};

type Escopo = { tenantId: string; pessoaId: string };
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown>; text(): Promise<string> }>;

export type OpcoesOrgo = {
  env: Readonly<Record<string, string | undefined>>;
  /** A chave da pessoa, do cofre (conector `orgo`, `ORGO_API_KEY`); null = ainda não guardou. */
  chaveDe: (escopo: Escopo) => Promise<string | null>;
  fetchImpl?: Fetch;
  agora?: () => number;
  pausa?: (ms: number) => Promise<void>;
};

type ComputadorOrgo = { id: string; name: string; status: string; connection_url?: string | null; vnc_password?: string | null };

/** O status do Orgo no vocabulário do nod. `frozen` é o parado normal (o stop arquiva o disco). */
export function estadoDoOrgo(status: string | undefined): EstadoNoProvedor {
  switch (status) {
    case "running": return "ligado";
    case "creating": case "restarting": case "updating": case "resuming": return "criando";
    case "suspending": case "suspended": return "suspenso";
    case "frozen": case "stopped": return "parado";
    case "deleted": return "inexistente";
    default: return "erro";
  }
}

/** Mesmos nomes que o runtime do nod traduz para o xdotool (infra/computador/runtime.mjs): o Orgo usa keysyms do X. */
export function teclaParaOrgo(k: string): string {
  const nomes: Record<string, string> = { Control: "ctrl", Meta: "super", Enter: "Return", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Space: "space", Backspace: "BackSpace", PageUp: "Prior", PageDown: "Next" };
  return k.split("+").map((x) => nomes[x] ?? x).join("+");
}

const BOTAO: Record<BotaoMouse, string> = { esquerdo: "left", direito: "right", meio: "middle" };

export const nomeNoOrgo = (id: string) => `nod-${id}`;

export function criarProvedorOrgo(o: OpcoesOrgo): ProvedorDeComputador {
  const habilitado = o.env.NOD_COMPUTADOR_ORGO === "1";
  const base = (o.env.NOD_ORGO_URL || BASE_ORGO).replace(/\/$/, "");
  const nomeWorkspace = o.env.NOD_ORGO_WORKSPACE_NOME || "nod";
  const ram = Number(o.env.NOD_ORGO_RAM_GB) || 4;
  const agora = o.agora ?? Date.now;
  const pausa = o.pausa ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fetchImpl: Fetch = o.fetchImpl ?? ((url, init) => fetch(url, init));
  /** O UUID do Orgo de cada computador nosso; cache só de id (nunca da chave nem da senha do VNC, que gira). */
  const idNoOrgo = new Map<string, string>();
  const workspaceDe = new Map<string, string>();

  const escopoDe = (ref: RefComputador | Pick<RefComputador, "escopo"> | undefined): Escopo => {
    if (!ref?.escopo) throw new FalhaComputador("nao_iniciou", { detalhe: "o computador no Orgo precisa do escopo de quem chama" });
    return ref.escopo;
  };

  async function chamar<T>(escopo: Escopo, metodo: string, caminho: string, corpo?: unknown, extra: Record<string, string> = {}): Promise<T> {
    if (!habilitado) throw new FalhaComputador("nao_iniciou", { detalhe: "NOD_COMPUTADOR_ORGO desligado" });
    const chave = await o.chaveDe(escopo);
    if (!chave) throw new FalhaComputador("nao_iniciou", { detalhe: "falta a chave do Orgo no cofre (conector orgo, ORGO_API_KEY): peça com pedir_credencial" });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), PRAZO_HTTP_MS);
    let r: Awaited<ReturnType<Fetch>>;
    try {
      r = await fetchImpl(`${base}${caminho}`, {
        method: metodo,
        headers: { authorization: `Bearer ${chave}`, accept: "application/json", ...(corpo !== undefined ? { "content-type": "application/json" } : {}), ...extra },
        ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
        signal: ctl.signal,
      });
    } catch {
      throw new FalhaComputador("sem_resposta", { detalhe: `Orgo ${metodo} ${caminho.split("?")[0]} sem resposta` });
    } finally {
      clearTimeout(timer);
    }
    if (r.ok) return (await r.json().catch(() => ({}))) as T;
    // O corpo de erro do Orgo é {"error": "..."}; pode citar o pedido, nunca a chave (ela vai só no header).
    const corpoErro = (await r.text().catch(() => "")).slice(0, 300);
    const detalhe = `Orgo ${metodo} ${caminho.split("?")[0]} → ${r.status} ${corpoErro}`;
    if (r.status === 401 || r.status === 403) throw new FalhaComputador("nao_iniciou", { detalhe: `${detalhe} (chave recusada ou sem permissão)` });
    if (r.status === 404) throw new FalhaComputador("sem_resposta", { detalhe });
    if (r.status === 409) throw new FalhaComputador("ocupado", { detalhe });
    if (r.status === 429) throw new FalhaComputador("ocupado", { detalhe: `${detalhe} (limite de requisições)` });
    throw new FalhaComputador(r.status >= 500 ? "sem_resposta" : "acao_falhou", { detalhe });
  }

  type Workspace = { id: string; name: string; desktops?: ComputadorOrgo[] };
  async function workspace(escopo: Escopo): Promise<Workspace | null> {
    const lista = await chamar<{ workspaces?: Workspace[]; projects?: Workspace[] }>(escopo, "GET", "/workspaces");
    const ws = (lista.workspaces ?? lista.projects ?? []).find((w) => w.name === nomeWorkspace) ?? null;
    if (ws) workspaceDe.set(escopo.pessoaId, ws.id);
    return ws;
  }
  async function idDoWorkspace(escopo: Escopo): Promise<string> {
    const em = workspaceDe.get(escopo.pessoaId);
    if (em) return em;
    const ws = await workspace(escopo);
    if (ws) return ws.id;
    const novo = await chamar<{ id: string }>(escopo, "POST", "/workspaces", { name: nomeWorkspace }, { "idempotency-key": `nod-workspace-${escopo.pessoaId}` });
    workspaceDe.set(escopo.pessoaId, novo.id);
    return novo.id;
  }

  /** O computador no Orgo pelo nome `nod-<id>` (não há listagem de computadores: vem do workspace). */
  async function achar(ref: RefComputador): Promise<ComputadorOrgo | null> {
    const escopo = escopoDe(ref);
    const conhecido = idNoOrgo.get(ref.id);
    if (conhecido) {
      const c = await chamar<ComputadorOrgo>(escopo, "GET", `/computers/${conhecido}`).catch((e: unknown) => {
        if (e instanceof FalhaComputador && e.motivo === "sem_resposta" && e.detalhe?.includes("→ 404")) return null;
        throw e;
      });
      if (c && c.status !== "deleted") return c;
      idNoOrgo.delete(ref.id);
    }
    const ws = await workspace(escopo);
    const c = ws?.desktops?.find((d) => d.name === nomeNoOrgo(ref.id) && d.status !== "deleted") ?? null;
    if (c) idNoOrgo.set(ref.id, c.id);
    return c;
  }
  async function exigir(ref: RefComputador): Promise<ComputadorOrgo> {
    const c = await achar(ref);
    if (!c) throw new FalhaComputador("sem_resposta", { detalhe: "o computador não existe no Orgo" });
    return c;
  }

  async function criar(ref: RefComputador): Promise<void> {
    if (await achar(ref)) return;
    const escopo = escopoDe(ref);
    const c = await chamar<ComputadorOrgo>(escopo, "POST", "/computers", { workspace_id: await idDoWorkspace(escopo), name: nomeNoOrgo(ref.id), os: "linux", ram, resolution: RESOLUCAO }, { "idempotency-key": `nod-criar-${ref.id}` });
    idNoOrgo.set(ref.id, c.id);
    log("info", "computador_orgo_criado", { computador_id: ref.id });
  }

  async function esperarLigado(ref: RefComputador): Promise<void> {
    const prazo = agora() + PRAZO_PRONTO_MS;
    while (agora() < prazo) {
      const s = await saude(ref);
      if (s.pronto) return;
      if (s.estado === "erro" || s.estado === "inexistente") throw new FalhaComputador("nao_iniciou", { detalhe: s.detalhe });
      await pausa(2000);
    }
    throw new FalhaComputador("sem_resposta", { detalhe: "o computador no Orgo não ficou pronto em 3 min" });
  }

  async function iniciar(ref: RefComputador): Promise<void> {
    await criar(ref);
    const c = await exigir(ref);
    const escopo = escopoDe(ref);
    const estado = estadoDoOrgo(c.status);
    if (estado === "parado") await chamar(escopo, "POST", `/computers/${c.id}/start`, {});
    else if (estado === "suspenso") await chamar(escopo, "POST", `/computers/${c.id}/resume`, {});
    await esperarLigado(ref);
  }

  async function saude(ref: RefComputador): Promise<SaudeComputador> {
    const c = await achar(ref);
    if (!c) return { estado: "inexistente", pronto: false, motivo: null, detalhe: null, reinicios: null };
    const estado = estadoDoOrgo(c.status);
    if (estado !== "ligado") return { estado, pronto: false, motivo: estado === "erro" ? "nao_iniciou" : null, detalhe: estado === "erro" ? `status ${c.status}` : null, reinicios: null };
    const h = await chamar<{ overall?: string; checks?: { name?: string; ok?: boolean; status?: string }[] }>(escopoDe(ref), "GET", `/computers/${c.id}/health`).catch(() => null);
    const pronto = h?.overall === "healthy" || h?.overall === "ok";
    const falhou = (h?.checks ?? []).filter((x) => x.ok === false || x.status === "fail").map((x) => x.name).filter(Boolean).join(", ");
    return { estado, pronto, motivo: pronto ? null : "sem_resposta", detalhe: pronto ? null : `saúde ${h?.overall ?? "sem resposta"}${falhou ? `: ${falhou}` : ""}`, reinicios: null };
  }

  const primitivas: PrimitivasDeComputador = {
    async capturarTela(ref) {
      const c = await exigir(ref);
      const r = await chamar<{ image?: string; width?: number; height?: number }>(escopoDe(ref), "GET", `/computers/${c.id}/screenshot?response_format=base64&format=png`);
      if (!r.image) throw new FalhaComputador("sem_resposta", { detalhe: "captura vazia do Orgo" });
      return { png: r.image.replace(/^data:image\/\w+;base64,/, ""), largura: r.width ?? 1280, altura: r.height ?? 800 };
    },
    async clicar(ref, p) {
      const c = await exigir(ref);
      await chamar(escopoDe(ref), "POST", `/computers/${c.id}/click`, { x: Math.round(p.x), y: Math.round(p.y), button: BOTAO[p.botao], ...(p.vezes === 2 ? { double: true } : p.vezes > 2 ? { repeat: p.vezes } : {}) });
    },
    async arrastar(ref, p) {
      const c = await exigir(ref);
      await chamar(escopoDe(ref), "POST", `/computers/${c.id}/drag`, { start_x: Math.round(p.x), start_y: Math.round(p.y), end_x: Math.round(p.destinoX), end_y: Math.round(p.destinoY) });
    },
    async digitar(ref, texto) {
      const c = await exigir(ref);
      await chamar(escopoDe(ref), "POST", `/computers/${c.id}/type`, { text: texto });
    },
    async tecla(ref, tecla) {
      const c = await exigir(ref);
      await chamar(escopoDe(ref), "POST", `/computers/${c.id}/key`, { key: teclaParaOrgo(tecla) });
    },
    async rolar(ref, p) {
      const c = await exigir(ref);
      await chamar(escopoDe(ref), "POST", `/computers/${c.id}/scroll`, { x: Math.round(p.x), y: Math.round(p.y), direction: p.delta < 0 ? "up" : "down", amount: Math.max(1, Math.min(20, Math.round(Math.abs(p.delta) / 100) || 1)) });
    },
    async comando(ref, comando, prazoMs) {
      const c = await exigir(ref);
      const r = await chamar<{ output?: string; exit_code?: number; success?: boolean }>(escopoDe(ref), "POST", `/computers/${c.id}/bash`, { command: comando, timeout: Math.max(1, Math.ceil(prazoMs / 1000)) });
      return { saida: r.output ?? "", codigoSaida: typeof r.exit_code === "number" ? r.exit_code : r.success === false ? 1 : 0 };
    },
    async abrirUrl(ref, url) {
      // definido em 2026-11-12: o Orgo não expõe CDP; o Chrome da máquina abre a URL numa aba nova, com o DISPLAY da tela 0.
      const u = aspasShell(url);
      await primitivas.comando(ref, `(command -v google-chrome >/dev/null && nohup google-chrome --new-tab ${u} || nohup xdg-open ${u}) >/dev/null 2>&1 &`, 15_000);
      await pausa(1500);
    },
  };

  async function ambiente(ref?: Pick<RefComputador, "escopo">): Promise<AmbienteComputador> {
    if (!habilitado) return { disponivel: false, motivo: "Configure NOD_COMPUTADOR_ORGO=1 no servidor para usar o Orgo." };
    if (ref?.escopo && !(await o.chaveDe(ref.escopo))) return { disponivel: false, motivo: "Guarde a chave do Orgo (conector orgo, ORGO_API_KEY) para ligar o computador." };
    return { disponivel: true, motivo: null };
  }

  return {
    id: "orgo",
    capacidades: CAPACIDADES_ORGO,
    ambiente,
    criar,
    iniciar,
    async parar(ref) {
      const c = await achar(ref);
      if (!c || estadoDoOrgo(c.status) !== "ligado") return;
      await chamar(escopoDe(ref), "POST", `/computers/${c.id}/stop`, {});
    },
    async retomar(ref) {
      const c = await achar(ref);
      if (c && estadoDoOrgo(c.status) === "suspenso") {
        await chamar(escopoDe(ref), "POST", `/computers/${c.id}/resume`, {});
        await esperarLigado(ref);
        return;
      }
      await iniciar(ref);
    },
    async suspender(ref) {
      const c = await exigir(ref);
      await chamar(escopoDe(ref), "POST", `/computers/${c.id}/suspend`, {});
    },
    async snapshot(ref, rotulo) {
      const c = await exigir(ref);
      const nome = `${nomeNoOrgo(ref.id)}-foto-${rotulo.replace(/[^a-z0-9-]/gi, "").slice(0, 24) || "sem-rotulo"}`;
      const copia = await chamar<{ id: string }>(escopoDe(ref), "POST", `/computers/${c.id}/clone`, { name: nome });
      return { snapshotId: copia.id };
    },
    async excluir(ref) {
      const c = await achar(ref);
      if (!c) return;
      await chamar(escopoDe(ref), "DELETE", `/computers/${c.id}`);
      idNoOrgo.delete(ref.id);
    },
    saude,
    async ligados() {
      // Sem escopo não há chave: o Orgo não entra no teto de computadores do HOST (ele não ocupa o host do nod).
      return new Set<string>();
    },
    primitivas,
    raizDeTrabalho: "/root/workspace",
    async acessoTela(ref): Promise<AcessoTelaAoVivo> {
      const c = await chamar<ComputadorOrgo>(escopoDe(ref), "GET", `/computers/${(await exigir(ref)).id}`);
      if (!c.connection_url || !c.vnc_password) throw new FalhaComputador("sem_resposta", { detalhe: "o Orgo não deu a tela ao vivo (computador desligado?)" });
      return { tipo: "vnc_websocket", url: `${c.connection_url.replace(/^http/, "ws")}/ws/websockify`, token: c.vnc_password, validoAte: null };
    },
  };
}
