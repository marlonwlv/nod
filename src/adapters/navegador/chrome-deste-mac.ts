import type { CookieNavegador } from "../../contracts/navegador-maquina.ts";
import type { MacDaPessoa } from "./mac-da-pessoa.ts";
import { FalhaNavegador } from "./motor-agent-browser.ts";

/**
 * Só no desenvolvimento (2026-11-23, o dono preso no "Entrar com o Google" do LinkedIn no servidor local): o servidor de
 * login stub roda no Mac da própria pessoa, sem o app do nod conectado. Este "Mac da pessoa" lê o Chrome DESTE Mac direto,
 * como o app faria (desktop/cookies-do-chrome.ts; o macOS pede o Keychain, e essa é a confirmação).
 *
 * Nunca em produção: o compor só liga com NOD_LOGIN=stub, fora do modo compartilhado, no macOS e com
 * NOD_NAVEGADOR_CHROME_DESTE_MAC=1. Só o Chrome: sem 1Password, Bitwarden nem Touch ID (o cartão segue com o cofre do nod e
 * a confirmação comum).
 */
export const ESTE_MAC = "este-mac";

const SEM_COFRE = "os cofres do Mac só vêm pelo app do nod; neste servidor de desenvolvimento, use o cofre do nod";

type LerCookies = (host: string) => Promise<CookieNavegador[]>;

/** O leitor de verdade: o mesmo código do app (importado só aqui, só no desenvolvimento). */
async function lerDoChromeDesteMac(home: string, host: string): Promise<CookieNavegador[]> {
  // O caminho em variável: o servidor não leva o desktop/ para o tipo nem para a imagem; só o desenvolvimento chega aqui.
  const cookies = "../../../desktop/cookies-do-chrome.ts";
  const cofres = "../../../desktop/cofres-do-mac.ts";
  const { cookiesDoChrome } = (await import(cookies)) as { cookiesDoChrome: (o: { host: string; home: string; executar: unknown }) => Promise<CookieNavegador[]> };
  const { executarDoCofre } = (await import(cofres)) as { executarDoCofre: unknown };
  return cookiesDoChrome({ host, home, executar: executarDoCofre });
}

export function criarChromeDesteMac(o: { home: string; ler?: LerCookies }): MacDaPessoa {
  const ler: LerCookies = o.ler ?? ((host) => lerDoChromeDesteMac(o.home, host));
  return {
    maquina: () => ESTE_MAC,
    aparelho: () => "mac",
    listar: async () => [],
    preencher: async () => { throw new FalhaNavegador("indisponivel", SEM_COFRE); },
    ler: async () => { throw new FalhaNavegador("indisponivel", SEM_COFRE); },
    guardar: async () => { throw new FalhaNavegador("indisponivel", SEM_COFRE); },
    // O navegador do bot roda neste servidor (nunca "no Mac" pelo app): os cookies sempre voltam para o portão aplicar.
    async cookies(_escopo, _agenteId, host, aplicar) {
      if (aplicar) return 0;
      return ler(host);
    },
    touchId: async () => "sem_mac",
  };
}
