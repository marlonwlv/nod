import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { APP_LOGADO, cookieDeSessao } from "../../src/adapters/http/rotas/tela.ts";

/**
 * Lote B das Jornadas da IA (2026-11-22): a conversa de um bot aberta no app de verdade (a web montada que o servidor
 * serve), num Chrome headless com a sessão da pessoa, e o print em três jeitos — computador claro, computador escuro e
 * celular — para a pasta de auditoria. Cada print só sai quando o DOM mostra o que o cenário espera (`pronto`): sem isso
 * a tela não bate e o teste falha com o que viu.
 */
export type Variacao = { nome: "claro" | "escuro" | "celular"; largura: number; altura: number; escuro: boolean; celular: boolean };
export const VARIACOES: readonly Variacao[] = [
  { nome: "claro", largura: 1280, altura: 800, escuro: false, celular: false },
  { nome: "escuro", largura: 1280, altura: 800, escuro: true, celular: false },
  { nome: "celular", largura: 390, altura: 844, escuro: false, celular: true },
];

export type TelaDaConversa = {
  /** Abre a conversa e espera `pronto` (expressão JS que dá true); devolve o texto visível da conversa. */
  abrir(o: { conversaId: string; variacao: Variacao; pronto: string; prazoMs?: number }): Promise<string>;
  /** O print da aba como está. */
  print(arquivo: string): Promise<void>;
  /** Avalia uma expressão na página (clique de botão do cartão, leitura do DOM). */
  avaliar<T>(expressao: string): Promise<T>;
  fechar(): Promise<void>;
};

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function telaDaConversa(o: { url: string; cookie: string }): Promise<TelaDaConversa> {
  const perfil = mkdtempSync(join(tmpdir(), "nod-lote-b-"));
  const { cdp } = await abrirChrome(0, perfil);
  const valor = cookieDeSessao(o.cookie);
  if (!valor) throw new Error("telaDaConversa: sem cookie de sessão");
  const host = new URL(o.url).hostname;
  await cdp.enviar("Page.enable");
  await cdp.enviar("Network.enable");
  await cdp.enviar("Network.setCookie", { name: "nod_sessao", value: valor, domain: host, path: "/", httpOnly: true });
  const esperarAte = async (expressao: string, prazoMs: number): Promise<boolean> => {
    const fim = Date.now() + prazoMs;
    while (Date.now() < fim) {
      if (await avaliar<boolean>(cdp, `(() => { try { return !!(${expressao}); } catch { return false; } })()`).catch(() => false)) return true;
      await espera(100);
    }
    return false;
  };
  const tela: TelaDaConversa = {
    async abrir(p) {
      await emular(cdp, p.variacao);
      await cdp.enviar("Page.navigate", { url: `${o.url}/` });
      if (!(await esperarAte(APP_LOGADO, p.prazoMs ?? 20_000))) throw new Error("telaDaConversa: o app não abriu logado");
      const abriu = await esperarAte(`(() => { const b = document.querySelector('[data-act="abrir-conversa"][data-conversa="${p.conversaId}"]'); if (b) b.click(); return !!b; })()`, 10_000);
      if (!abriu) throw new Error(`telaDaConversa: a conversa ${p.conversaId} não aparece no app`);
      const ok = await esperarAte(p.pronto, p.prazoMs ?? 20_000);
      const texto = await avaliar<string>(cdp, `(document.querySelector('.conversa, main, #conversa') ?? document.body).innerText`);
      if (!ok) throw new Error(`telaDaConversa (${p.variacao.nome}): a tela não mostrou o esperado (${p.pronto}). Viu:\n${texto.slice(-1500)}`);
      // As animações de entrada (linhas novas, o mascote) assentam antes do print.
      await espera(400);
      return texto;
    },
    async print(arquivo) {
      const { data } = await cdp.enviar<{ data: string }>("Page.captureScreenshot", { format: "png" });
      mkdirSync(dirname(arquivo), { recursive: true });
      writeFileSync(arquivo, Buffer.from(data, "base64"));
    },
    avaliar: (e) => avaliar(cdp, e),
    async fechar() {
      cdp.fechar();
      await espera(100);
      rmSync(perfil, { recursive: true, force: true });
    },
  };
  return tela;
}

async function emular(cdp: Cdp, v: Variacao): Promise<void> {
  await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: v.largura, height: v.altura, deviceScaleFactor: 2, mobile: v.celular });
  await cdp.enviar("Emulation.setTouchEmulationEnabled", v.celular ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  // O layout de celular do app pede (hover:none) e (pointer:coarse) além da largura (como o capturador da NOD-398).
  await cdp.enviar("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-color-scheme", value: v.escuro ? "dark" : "light" },
      { name: "hover", value: v.celular ? "none" : "hover" },
      { name: "pointer", value: v.celular ? "coarse" : "fine" },
      { name: "prefers-reduced-motion", value: "reduce" },
    ],
  });
}
