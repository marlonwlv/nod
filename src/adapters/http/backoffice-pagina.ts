import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { CAMINHO_BACKOFFICE, CAMINHO_BACKOFFICE_PADRAO, caminhoDeVolta, ehCaminhoDoBackoffice, PARAMETRO_VOLTA } from "../../shared/backoffice.ts";
import type { Escopo } from "../../shared/types.ts";

/**
 * A tela do backoffice interno (definido em 2026-11-24, ADR-194), decidida no SERVIDOR antes do estático:
 *  - `/admin.html` (o endereço do ADR-193) e `/backoffice.html` → 302 para `/backoffice`;
 *  - `/backoffice/*` sem sessão → 302 para o login (`/?volta=<caminho>`), que devolve a pessoa ao mesmo caminho;
 *  - com sessão e sem papel na equipe → 404, como página que não existe (não revela que o backoffice existe);
 *  - da equipe: `/backoffice` → 302 para `/backoffice/uso`; o resto recebe o app do backoffice (backoffice.html), que
 *    resolve a seção pelo caminho. Os dados vêm de `/api/backoffice/*`, que confere a guarda de novo a cada pedido.
 */
export type DepsPaginaBackoffice = {
  staticDir: string | undefined;
  resolverEscopo(req: IncomingMessage): Escopo | null | Promise<Escopo | null>;
  papel?: (escopo: Escopo) => Promise<string | null>;
};

const SEM_CACHE = { "cache-control": "no-store", "x-robots-tag": "noindex" } as const;

const PAGINA_404 =
  '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>nod</title></head><body><p>Página não encontrada.</p></body></html>';

function redirecionar(res: ServerResponse, para: string): true {
  res.writeHead(302, { location: para, ...SEM_CACHE });
  res.end();
  return true;
}

export function criarPaginaBackoffice(d: DepsPaginaBackoffice): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const caminho = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
    if (caminho === "/admin.html" || caminho === "/backoffice.html") return redirecionar(res, CAMINHO_BACKOFFICE);
    if (!ehCaminhoDoBackoffice(caminho)) return false;

    const escopo = await d.resolverEscopo(req);
    if (!escopo) {
      const volta = caminhoDeVolta(caminho === CAMINHO_BACKOFFICE ? CAMINHO_BACKOFFICE_PADRAO : `${caminho}${url.search}`) ?? CAMINHO_BACKOFFICE_PADRAO;
      return redirecionar(res, `/?${new URLSearchParams({ [PARAMETRO_VOLTA]: volta }).toString()}`);
    }
    const papel = d.papel ? await d.papel(escopo) : null;
    if (!papel) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", ...SEM_CACHE });
      res.end(req.method === "HEAD" ? undefined : PAGINA_404);
      return true;
    }
    if (caminho === CAMINHO_BACKOFFICE) return redirecionar(res, `${CAMINHO_BACKOFFICE_PADRAO}${url.search}`);
    if (!d.staticDir) return false;
    try {
      const html = await readFile(join(d.staticDir, "backoffice.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", ...SEM_CACHE });
      res.end(req.method === "HEAD" ? undefined : html);
      return true;
    } catch {
      return false;
    }
  };
}
