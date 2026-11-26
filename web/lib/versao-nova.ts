/**
 * XUM-9 (2026-11-26): a tela carregada antes de um deploy pede o pedaço do bundle que só baixa quando abre (o modal do
 * Marketplace, o onboarding) pelo nome com hash do build dela. O deploy troca os nomes e o servidor não guarda os de
 * antes (src/adapters/http/estatico.ts): o `import()` falha com 404 e a falha caía no "Algo deu errado nesta tela". O
 * app do Mac fica aberto por dias, então bastava um deploy da web para o botão de apps parar de abrir.
 *
 * Aqui: quando o `import()` falha e o index.html do servidor aponta para outro script principal, a página recarrega UMA
 * vez (a versão nova vem junto) e guarda o que a pessoa ia abrir, para a tela nova abrir sozinha. Sem servidor (rede
 * caiu), com o mesmo script (não é deploy) ou com uma recarga destas há menos de um minuto, devolve `false` e quem
 * chama mostra o erro de sempre: nunca vira laço de recargas.
 */

/** O que abrir depois da recarga (sessionStorage, JSON). Hoje só o Marketplace. */
export type DepoisDaRecarga = { tipo: "marketplace"; inicial: Record<string, unknown> };

type Guardado = { em: number; depois?: DepoisDaRecarga };

export const CHAVE_RECARGA = "nod.recarga-por-versao";
/** Uma recarga destas por minuto: se a falha volta logo depois, é outro problema e o erro aparece. */
export const INTERVALO_RECARGA_MS = 60_000;

/**
 * As frases do `import()` dinâmico que não achou o arquivo: Chrome/Electron ("Failed to fetch dynamically imported
 * module"), Safari ("Importing a module script failed."), Firefox ("error loading dynamically imported module") e a do
 * Vite quando o CSS do pedaço não carrega ("Unable to preload CSS for …").
 */
const FALHA_DE_IMPORT = /dynamically imported module|importing a module script failed|unable to preload css/i;

export function ehFalhaDeImport(e: unknown): boolean {
  return e instanceof Error && FALHA_DE_IMPORT.test(e.message);
}

/** O caminho do script principal (o `<script type="module" src>`) de um index.html. */
export function scriptPrincipal(html: string): string | null {
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\btype=["']module["']/i.test(tag)) continue;
    const src = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1];
    if (src) return caminhoDoScript(src);
  }
  return null;
}

/** O caminho de um `src` de script (sem origem nem query), para comparar o da página com o do servidor. */
export function caminhoDoScript(src: string): string {
  try {
    return new URL(src, "http://nod.local/").pathname;
  } catch {
    return src;
  }
}

type Armazenamento = Pick<Storage, "getItem" | "setItem">;

function ler(storage: Armazenamento | null): Guardado | null {
  try {
    const v: unknown = JSON.parse(storage?.getItem(CHAVE_RECARGA) ?? "null");
    if (!v || typeof v !== "object" || typeof (v as Guardado).em !== "number") return null;
    return v as Guardado;
  } catch {
    return null;
  }
}

export type DepsRecarga = {
  /** O index.html de agora no servidor (sem cache). Rejeita sem servidor. */
  buscarIndex: () => Promise<string>;
  /** O script principal desta página (`scriptPrincipal` do documento carregado). */
  scriptAtual: () => string | null;
  /** sessionStorage (null sem ele: sem como evitar o laço, não recarrega). */
  storage: Armazenamento | null;
  recarregar: () => void;
  agora: () => number;
};

/**
 * Devolve a função que quem fez o `import()` chama na falha: `true` = a página vai recarregar (não mostre nada);
 * `false` = mostre o erro.
 */
export function criarRecargaPorVersaoNova(d: DepsRecarga): (e: unknown, depois?: DepoisDaRecarga) => Promise<boolean> {
  return async (e, depois) => {
    if (!ehFalhaDeImport(e) || !d.storage) return false;
    const antes = ler(d.storage);
    if (antes && d.agora() - antes.em < INTERVALO_RECARGA_MS) return false;
    let html: string;
    try {
      html = await d.buscarIndex();
    } catch {
      return false;
    }
    const novo = scriptPrincipal(html);
    const atual = d.scriptAtual();
    if (!novo || !atual || novo === atual) return false;
    try {
      d.storage.setItem(CHAVE_RECARGA, JSON.stringify({ em: d.agora(), ...(depois ? { depois } : {}) } satisfies Guardado));
    } catch {
      return false;
    }
    d.recarregar();
    return true;
  };
}

/**
 * Na carga da página: o que a recarga guardou para abrir (só se ela foi há menos de um minuto). Tira o pedido do
 * storage e deixa a hora, que segura uma segunda recarga logo em seguida.
 */
export function lerDepoisDaRecarga(storage: Armazenamento | null, agora: number): DepoisDaRecarga | null {
  const g = ler(storage);
  if (!g?.depois) return null;
  try {
    storage?.setItem(CHAVE_RECARGA, JSON.stringify({ em: g.em } satisfies Guardado));
  } catch {
    // Sem gravar, o pedido fica: abre de novo só se a pessoa recarregar no mesmo minuto.
  }
  if (agora - g.em >= INTERVALO_RECARGA_MS || g.depois.tipo !== "marketplace" || !g.depois.inicial || typeof g.depois.inicial !== "object") return null;
  return g.depois;
}
