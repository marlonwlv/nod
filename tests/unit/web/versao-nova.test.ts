import { describe, expect, it, vi } from "vitest";
import { CHAVE_RECARGA, INTERVALO_RECARGA_MS, caminhoDoScript, criarRecargaPorVersaoNova, ehFalhaDeImport, lerDepoisDaRecarga, scriptPrincipal } from "../../../web/lib/versao-nova.ts";

// XUM-9: o botão de apps dava "Algo deu errado nesta tela" quando a página era de antes de um deploy (o pedaço do modal
// do Marketplace já não existia no servidor).

const INDEX_NOVO = `<!doctype html><html><head><script>window.x=1</script><script type="module" crossorigin src="/assets/index-NOVO.js"></script></head></html>`;
const FALHA_CHROME = new TypeError("Failed to fetch dynamically imported module: https://app.nodbot.ai/assets/regiao-QmaJ-DjL.js");

function armazenamento(inicial: Record<string, string> = {}) {
  const m = new Map(Object.entries(inicial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: vi.fn((k: string, v: string) => { m.set(k, v); }), mapa: m };
}

function montar(o: { html?: string | Error; atual?: string | null; storage?: ReturnType<typeof armazenamento> | null; agora?: number } = {}) {
  const recarregar = vi.fn();
  const storage = o.storage === undefined ? armazenamento() : o.storage;
  const recarga = criarRecargaPorVersaoNova({
    buscarIndex: () => (o.html instanceof Error ? Promise.reject(o.html) : Promise.resolve(o.html ?? INDEX_NOVO)),
    scriptAtual: () => (o.atual === undefined ? "/assets/index-VELHO.js" : o.atual),
    storage,
    recarregar,
    agora: () => o.agora ?? 1_000_000,
  });
  return { recarga, recarregar, storage };
}

describe("ehFalhaDeImport", () => {
  it("reconhece o import() que não achou o arquivo no Chrome/Electron, no Safari, no Firefox e o CSS do Vite", () => {
    expect(ehFalhaDeImport(FALHA_CHROME)).toBe(true);
    expect(ehFalhaDeImport(new TypeError("Importing a module script failed."))).toBe(true);
    expect(ehFalhaDeImport(new TypeError("error loading dynamically imported module: https://x/assets/a.js"))).toBe(true);
    expect(ehFalhaDeImport(new Error("Unable to preload CSS for /assets/regiao-Dq2vVzIc.css"))).toBe(true);
  });
  it("não confunde com bug da tela nem com o que não é erro", () => {
    expect(ehFalhaDeImport(new TypeError("Cannot read properties of undefined (reading 'slug')"))).toBe(false);
    expect(ehFalhaDeImport("Failed to fetch dynamically imported module")).toBe(false);
    expect(ehFalhaDeImport(null)).toBe(false);
  });
});

describe("scriptPrincipal", () => {
  it("acha o script de módulo do build, pulando os scripts inline", () => {
    expect(scriptPrincipal(INDEX_NOVO)).toBe("/assets/index-NOVO.js");
    expect(scriptPrincipal(`<script type='module' src="https://app.nodbot.ai/assets/index-A.js?x=1"></script>`)).toBe("/assets/index-A.js");
    expect(scriptPrincipal(`<script type="module" src="/main.ts"></script>`)).toBe("/main.ts");
  });
  it("sem script de módulo, null", () => {
    expect(scriptPrincipal("<html><script>1</script></html>")).toBeNull();
    expect(scriptPrincipal("")).toBeNull();
  });
  it("caminhoDoScript tira origem e query", () => {
    expect(caminhoDoScript("/assets/index-A.js")).toBe("/assets/index-A.js");
    expect(caminhoDoScript("https://x.y/assets/index-A.js?v=2#z")).toBe("/assets/index-A.js");
  });
});

describe("criarRecargaPorVersaoNova", () => {
  it("o modal de um deploy anterior: recarrega uma vez e guarda o Marketplace para abrir depois", async () => {
    const { recarga, recarregar, storage } = montar();
    expect(await recarga(FALHA_CHROME, { tipo: "marketplace", inicial: { busca: "Gmail" } })).toBe(true);
    expect(recarregar).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage!.mapa.get(CHAVE_RECARGA)!)).toEqual({ em: 1_000_000, depois: { tipo: "marketplace", inicial: { busca: "Gmail" } } });
  });

  it("o mesmo script no servidor (não é deploy): não recarrega e o erro aparece", async () => {
    const { recarga, recarregar } = montar({ atual: "/assets/index-NOVO.js" });
    expect(await recarga(FALHA_CHROME)).toBe(false);
    expect(recarregar).not.toHaveBeenCalled();
  });

  it("sem servidor (a rede caiu): não recarrega, para não trocar a tela por uma página em branco", async () => {
    const { recarga, recarregar } = montar({ html: new TypeError("Failed to fetch") });
    expect(await recarga(FALHA_CHROME)).toBe(false);
    expect(recarregar).not.toHaveBeenCalled();
  });

  it("erro que não é de import (bug da tela) não recarrega", async () => {
    const { recarga, recarregar } = montar();
    expect(await recarga(new TypeError("x is not a function"))).toBe(false);
    expect(recarregar).not.toHaveBeenCalled();
  });

  it("nunca vira laço: com uma recarga destas há menos de um minuto, devolve false", async () => {
    const storage = armazenamento({ [CHAVE_RECARGA]: JSON.stringify({ em: 1_000_000 - INTERVALO_RECARGA_MS + 1 }) });
    const { recarga, recarregar } = montar({ storage });
    expect(await recarga(FALHA_CHROME)).toBe(false);
    expect(recarregar).not.toHaveBeenCalled();
    // Passado o minuto, outro deploy pode recarregar de novo.
    const depois = montar({ storage, agora: 1_000_000 + 1 });
    expect(await depois.recarga(FALHA_CHROME)).toBe(true);
  });

  it("sem sessionStorage (sem como segurar o laço) ou index sem script: não recarrega", async () => {
    expect(await montar({ storage: null }).recarga(FALHA_CHROME)).toBe(false);
    expect(await montar({ html: "<html></html>" }).recarga(FALHA_CHROME)).toBe(false);
    expect(await montar({ atual: null }).recarga(FALHA_CHROME)).toBe(false);
  });
});

describe("lerDepoisDaRecarga", () => {
  it("devolve o Marketplace guardado uma vez só e mantém a hora (que segura outra recarga)", () => {
    const storage = armazenamento({ [CHAVE_RECARGA]: JSON.stringify({ em: 1000, depois: { tipo: "marketplace", inicial: {} } }) });
    expect(lerDepoisDaRecarga(storage, 2000)).toEqual({ tipo: "marketplace", inicial: {} });
    expect(JSON.parse(storage.mapa.get(CHAVE_RECARGA)!)).toEqual({ em: 1000 });
    expect(lerDepoisDaRecarga(storage, 2000)).toBeNull();
  });
  it("traz a conversa que estava aberta; conversa torta fica de fora", () => {
    const com = armazenamento({ [CHAVE_RECARGA]: JSON.stringify({ em: 1000, depois: { tipo: "marketplace", inicial: { busca: "Gmail" }, conversa: { conversaId: "c1", agenteId: "a1" } } }) });
    expect(lerDepoisDaRecarga(com, 2000)).toEqual({ tipo: "marketplace", inicial: { busca: "Gmail" }, conversa: { conversaId: "c1", agenteId: "a1" } });
    const torta = armazenamento({ [CHAVE_RECARGA]: JSON.stringify({ em: 1000, depois: { tipo: "marketplace", inicial: {}, conversa: { conversaId: 5 } } }) });
    expect(lerDepoisDaRecarga(torta, 2000)).toEqual({ tipo: "marketplace", inicial: {} });
  });
  it("pedido velho (mais de um minuto), torto ou ausente: nada abre", () => {
    expect(lerDepoisDaRecarga(armazenamento({ [CHAVE_RECARGA]: JSON.stringify({ em: 0, depois: { tipo: "marketplace", inicial: {} } }) }), INTERVALO_RECARGA_MS)).toBeNull();
    expect(lerDepoisDaRecarga(armazenamento({ [CHAVE_RECARGA]: "{nao json" }), 0)).toBeNull();
    expect(lerDepoisDaRecarga(armazenamento({ [CHAVE_RECARGA]: JSON.stringify({ em: 0, depois: { tipo: "outra", inicial: {} } }) }), 0)).toBeNull();
    expect(lerDepoisDaRecarga(armazenamento(), 0)).toBeNull();
    expect(lerDepoisDaRecarga(null, 0)).toBeNull();
  });
});
