import type { ChamadaCdp } from "../../domain/navegador-entrada-cdp.ts";

/**
 * 2026-11-28 (o painel como um navegador normal): a entrada da pessoa pela conexão DIRETA ao Chrome do bot (o CDP que o
 * agent-browser já abre em 127.0.0.1, `get cdp-url`), na máquina dela. Uma conexão por vista, aberta enquanto ela assiste;
 * uma sessão `flatten` por aba ativa. Cada chamada espera a resposta do Chrome: `executar` devolve true só quando todas
 * voltaram sem erro (é o "confirmado" da vista). Do jeito do OpenMausBot (comportamento, não código): a tecla que não
 * volta não fica em silêncio.
 *
 * medido em 2026-11-28 (Mac, Chrome 143 sem janela): cada chamada volta em ~2 ms; da tecla até o quadro novo do stream,
 * 20 ms na mediana (39 ms no pior de 10).
 */

/** A conexão com o CDP (o WebSocket global da máquina; o teste passa uma falsa). */
export type ConexaoCdp = {
  enviar(texto: string): void;
  aoMensagem(fn: (texto: string) => void): void;
  aoFechar(fn: () => void): void;
  fechar(): void;
};

export type EntradaCdp = {
  /** A aba ativa agora (o `targetId` das abas do stream): a próxima chamada vai para ela. */
  alvo(targetId: string): void;
  /** Roda as chamadas em ordem; true = o Chrome respondeu a todas sem erro. */
  executar(chamadas: readonly ChamadaCdp[]): Promise<boolean>;
  fechar(): void;
};

/** definido em 2026-11-28: uma chamada de entrada sem resposta em 2 s conta como não confirmada. */
export const PRAZO_CHAMADA_CDP_MS = 2_000;
const TARGET_ID = /^[0-9A-F]{8,64}$/i;

type Resposta = { ok: boolean; resultado?: unknown; erro?: string };
type Pendente = { resolver: (r: Resposta) => void; relogio: ReturnType<typeof setTimeout> };

export function criarEntradaCdp(o: { conectar: () => Promise<ConexaoCdp>; prazoMs?: number }): EntradaCdp {
  const prazo = o.prazoMs ?? PRAZO_CHAMADA_CDP_MS;
  let conexao: Promise<ConexaoCdp | null> | null = null;
  let proximo = 1;
  const pendentes = new Map<number, Pendente>();
  /** targetId → sessionId (a sessão some quando a aba fecha ou navega para outro processo). */
  const sessoes = new Map<string, string>();
  let ativo: string | null = null;
  let fechada = false;

  function soltarTudo(): void {
    for (const p of pendentes.values()) { clearTimeout(p.relogio); p.resolver({ ok: false }); }
    pendentes.clear();
    sessoes.clear();
  }

  function conectar(): Promise<ConexaoCdp | null> {
    if (fechada) return Promise.resolve(null);
    conexao ??= o.conectar().then((c) => {
      c.aoMensagem((texto) => {
        let m: { id?: unknown; error?: unknown; result?: unknown; method?: unknown; params?: { sessionId?: unknown; targetId?: unknown } };
        try { m = JSON.parse(texto) as typeof m; } catch { return; }
        if (typeof m.id === "number") {
          const p = pendentes.get(m.id);
          if (!p) return;
          pendentes.delete(m.id);
          clearTimeout(p.relogio);
          p.resolver(m.error ? { ok: false, erro: String((m.error as { message?: unknown }).message ?? "erro").slice(0, 200) } : { ok: true, resultado: m.result });
          return;
        }
        // A aba fechou ou trocou de processo: a sessão dela não vale mais (a próxima chamada se prende de novo).
        if (m.method === "Target.detachedFromTarget") {
          for (const [alvo, sessao] of sessoes) if (sessao === m.params?.sessionId) sessoes.delete(alvo);
        }
      });
      c.aoFechar(() => { conexao = null; soltarTudo(); });
      return c;
    }).catch(() => { conexao = null; return null; });
    return conexao;
  }

  async function chamar(metodo: string, params: Readonly<Record<string, unknown>>, sessionId?: string): Promise<Resposta> {
    const c = await conectar();
    if (!c) return { ok: false };
    const id = proximo++;
    return new Promise((resolver) => {
      const relogio = setTimeout(() => { pendentes.delete(id); resolver({ ok: false }); }, prazo);
      relogio.unref?.();
      pendentes.set(id, { resolver, relogio });
      try { c.enviar(JSON.stringify({ id, method: metodo, params, ...(sessionId ? { sessionId } : {}) })); } catch { pendentes.delete(id); clearTimeout(relogio); resolver({ ok: false }); }
    });
  }

  /** Sem a aba ativa do stream ainda: a única página aberta do Chrome do bot (com mais de uma, não adivinha). */
  async function unicaPagina(): Promise<string | null> {
    const r = await chamar("Target.getTargets", {});
    const alvos = ((r.resultado as { targetInfos?: { type?: unknown; url?: unknown; targetId?: unknown }[] } | undefined)?.targetInfos ?? [])
      .filter((t) => t.type === "page" && typeof t.url === "string" && !t.url.startsWith("chrome") && typeof t.targetId === "string" && TARGET_ID.test(t.targetId));
    return alvos.length === 1 ? String(alvos[0]!.targetId) : null;
  }

  async function sessaoDoAtivo(): Promise<string | null> {
    ativo ??= await unicaPagina();
    const alvo = ativo;
    if (!alvo) return null;
    const ja = sessoes.get(alvo);
    if (ja) return ja;
    const r = await chamar("Target.attachToTarget", { targetId: alvo, flatten: true });
    const sessionId = (r.resultado as { sessionId?: unknown } | undefined)?.sessionId;
    if (!r.ok || typeof sessionId !== "string") return null;
    sessoes.set(alvo, sessionId);
    return sessionId;
  }

  async function umaVez(chamadas: readonly ChamadaCdp[]): Promise<"ok" | "sessao" | "falhou"> {
    const sessao = await sessaoDoAtivo();
    if (!sessao) return "sessao";
    for (const ch of chamadas) {
      const r = await chamar(ch.metodo, ch.params, sessao);
      // A sessão da aba não existe mais (navegou para outro processo, fechou): nada foi feito, dá para repetir.
      if (!r.ok) return r.erro && /session/i.test(r.erro) ? "sessao" : "falhou";
    }
    return "ok";
  }

  return {
    alvo(targetId) {
      if (TARGET_ID.test(targetId)) ativo = targetId;
    },
    async executar(chamadas) {
      if (!chamadas.length) return true;
      const r = await umaVez(chamadas);
      if (r === "ok") return true;
      // A sessão caiu (a aba navegou para outro processo, a conexão reabriu): prende de novo e tenta uma vez. Uma tecla que
      // o Chrome RECUSOU (erro na resposta) não repete aqui: repetir poderia digitar duas vezes.
      if (r === "falhou" && conexao) return false;
      if (ativo) sessoes.delete(ativo);
      return (await umaVez(chamadas)) === "ok";
    },
    fechar() {
      fechada = true;
      const c = conexao;
      conexao = null;
      soltarTudo();
      void c?.then((x) => x?.fechar());
    },
  };
}

/** A conexão pelo WebSocket global (Node 22+ e o processo principal do Electron). */
export function conectarCdpGlobal(url: string, WS: (new (url: string) => WebSocket) | undefined = (globalThis as { WebSocket?: new (url: string) => WebSocket }).WebSocket): Promise<ConexaoCdp> {
  return new Promise((resolve, reject) => {
    if (!WS) { reject(new Error("sem_websocket")); return; }
    let u: URL;
    try { u = new URL(url); } catch { reject(new Error("cdp_url_invalida")); return; }
    // Só o Chrome do bot desta máquina: o CDP mora em 127.0.0.1 (o agent-browser abre assim).
    if (u.protocol !== "ws:" || (u.hostname !== "127.0.0.1" && u.hostname !== "localhost")) { reject(new Error("cdp_fora_da_maquina")); return; }
    const ws = new WS(url);
    const prazo = setTimeout(() => { ws.close(); reject(new Error("cdp_sem_resposta")); }, 5_000);
    const leitores: ((t: string) => void)[] = [];
    const fechados: (() => void)[] = [];
    let aberto = false;
    ws.onerror = () => { if (!aberto) { clearTimeout(prazo); reject(new Error("cdp_falhou")); } };
    ws.onclose = () => { clearTimeout(prazo); if (!aberto) { reject(new Error("cdp_fechou")); return; } for (const f of fechados) f(); };
    ws.onmessage = (e: MessageEvent) => { if (typeof e.data === "string") for (const f of leitores) f(e.data); };
    ws.onopen = () => {
      aberto = true;
      clearTimeout(prazo);
      resolve({
        enviar: (t) => { if (ws.readyState === ws.OPEN) ws.send(t); else throw new Error("cdp_fechado"); },
        aoMensagem: (fn) => { leitores.push(fn); },
        aoFechar: (fn) => { fechados.push(fn); },
        fechar: () => { if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(1000); },
      });
    };
  });
}
