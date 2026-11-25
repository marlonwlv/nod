import { hkdfSync } from "node:crypto";
import { chaveDe } from "../../db/cifra.ts";
import { cifrarV2, decifrarV2, FalhaDoCofre, TAMANHO_CHAVE, zerar } from "../../db/cifra-envelope.ts";
import { log } from "../../obs/log.ts";

/**
 * A chave mestra do cofre (definido em 2026-11-24, ADR-195 §2): embrulha só as chaves de tenant, nunca um item. Dois
 * provedores com a mesma forma:
 *
 * - **kms**: Cloud KMS pela API REST (sem biblioteca), com o token da conta de serviço da VM (metadata server). A chave
 *   nunca sai do KMS; `mestraRef` é o nome da versão que embrulhou (`…/cryptoKeyVersions/N`), e o decrypt acha a versão
 *   sozinho pela cifra — por isso trocar a mestra é só reembrulhar as chaves de tenant.
 * - **local** (dev, testes, servidor no Mac): KEK = HKDF-SHA256(NOD_CREDENTIAL_KEY, info `nod-cofre-v2-mestra-local`),
 *   AES-256-GCM com a mesma AAD; `mestraRef` = `local:v1`.
 *
 * Escolha por `NOD_COFRE_KMS` (nome completo da chave): presente → kms; ausente → local. Falha é sempre fechada e
 * tipada (`FalhaDoCofre`), sem o corpo da resposta e sem o valor; nunca cai para texto em claro.
 */
export interface ChaveMestra {
  readonly tipo: "local" | "kms";
  embrulhar(chaveTenant: Buffer, aad: string): Promise<{ embrulhada: string; mestraRef: string }>;
  desembrulhar(embrulhada: string, aad: string): Promise<Buffer>;
}

export const INFO_MESTRA_LOCAL = "nod-cofre-v2-mestra-local";
export const REF_MESTRA_LOCAL = "local:v1";

/**
 * A mestra local. `credencial` é a NOD_CREDENTIAL_KEY (hex de 64; frase vira sha256, como em `chaveDe`). `ref` só muda
 * nos testes (uma segunda mestra local para provar o reembrulho).
 */
export function chaveMestraLocal(credencial: string, opcoes: { ref?: string } = {}): ChaveMestra {
  if (!credencial) throw new FalhaDoCofre("config_invalida", { cause: new Error("NOD_CREDENTIAL_KEY ausente") });
  const ikm = chaveDe(credencial);
  const kek = Buffer.from(hkdfSync("sha256", ikm, Buffer.alloc(0), INFO_MESTRA_LOCAL, TAMANHO_CHAVE));
  zerar(ikm);
  const mestraRef = opcoes.ref ?? REF_MESTRA_LOCAL;
  return {
    tipo: "local",
    async embrulhar(chaveTenant, aad) {
      return { embrulhada: cifrarV2(chaveTenant, kek, aad, 1), mestraRef };
    },
    async desembrulhar(embrulhada, aad) {
      const chave = decifrarV2(embrulhada, kek, aad);
      if (chave.length !== TAMANHO_CHAVE) {
        zerar(chave);
        throw new FalhaDoCofre("cifra_invalida");
      }
      return chave;
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------ kms

export const URL_METADATA_TOKEN = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
export const URL_KMS = "https://cloudkms.googleapis.com/v1";
/** definido em 2026-11-24: prazo de cada chamada ao KMS e ao metadata. O turno espera no máximo isso no primeiro uso do tenant. */
export const PRAZO_KMS_MS = 5_000;
/** definido em 2026-11-24 (o mesmo da voz, src/adapters/voz/token-google.ts): renova o token 60 s antes de vencer. */
export const MARGEM_TOKEN_MS = 60_000;
const NOME_DA_CHAVE = /^projects\/[a-z0-9-]{1,63}\/locations\/[a-z0-9-]{1,63}\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}$/;

export type OpcoesKms = {
  /** O nome completo da chave (`projects/…/locations/…/keyRings/…/cryptoKeys/…`), de NOD_COFRE_KMS. */
  nome: string;
  fetchImpl?: typeof fetch;
  /** Token de acesso; padrão: metadata server da VM, com cache até perto de vencer. */
  token?: () => Promise<string>;
  prazoMs?: number;
  agora?: () => number;
};

/** O token da conta de serviço da VM, com cache e um pedido em voo por vez. */
export function tokenDoMetadata(o: { fetchImpl?: typeof fetch; prazoMs?: number; agora?: () => number } = {}): () => Promise<string> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const agora = o.agora ?? Date.now;
  const prazoMs = o.prazoMs ?? PRAZO_KMS_MS;
  let cache: { token: string; expiraEm: number } | null = null;
  let emVoo: Promise<string> | null = null;

  async function pedir(): Promise<string> {
    let r: Response;
    try {
      r = await fetchImpl(URL_METADATA_TOKEN, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(prazoMs) });
    } catch (e) {
      throw new FalhaDoCofre("mestra_indisponivel", { cause: nomeDoErro(e) });
    }
    if (!r.ok) throw new FalhaDoCofre(r.status >= 500 || r.status === 429 ? "mestra_indisponivel" : "mestra_recusou", { status: r.status });
    const corpo = await lerJson(r);
    const token = typeof corpo.access_token === "string" ? corpo.access_token : "";
    const expiraS = typeof corpo.expires_in === "number" ? corpo.expires_in : 0;
    if (!token || expiraS <= 0) throw new FalhaDoCofre("mestra_resposta_invalida");
    cache = { token, expiraEm: agora() + expiraS * 1000 };
    return token;
  }

  return async () => {
    if (cache && agora() < cache.expiraEm - MARGEM_TOKEN_MS) return cache.token;
    if (emVoo) return emVoo;
    emVoo = pedir().finally(() => {
      emVoo = null;
    });
    return emVoo;
  };
}

/** A mestra no Cloud KMS. `nome` fora do formato: `config_invalida` na hora (o boot acusa, não o primeiro turno). */
export function chaveMestraKms(o: OpcoesKms): ChaveMestra {
  if (!NOME_DA_CHAVE.test(o.nome)) throw new FalhaDoCofre("config_invalida", { cause: new Error("NOD_COFRE_KMS fora do formato projects/…/cryptoKeys/…") });
  const fetchImpl = o.fetchImpl ?? fetch;
  const prazoMs = o.prazoMs ?? PRAZO_KMS_MS;
  const token = o.token ?? tokenDoMetadata({ fetchImpl, prazoMs, ...(o.agora ? { agora: o.agora } : {}) });
  const nome = o.nome;

  async function chamar(operacao: "encrypt" | "decrypt", corpo: Record<string, string>): Promise<Record<string, unknown>> {
    let t: string;
    try {
      t = await token();
    } catch (e) {
      throw falhou(operacao, e instanceof FalhaDoCofre ? e : new FalhaDoCofre("mestra_indisponivel", { cause: nomeDoErro(e) }));
    }
    let r: Response;
    try {
      r = await fetchImpl(`${URL_KMS}/${nome}:${operacao}`, {
        method: "POST",
        headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(prazoMs),
      });
    } catch (e) {
      throw falhou(operacao, new FalhaDoCofre("mestra_indisponivel", { cause: nomeDoErro(e) }));
    }
    if (!r.ok) {
      // O corpo do erro do Google pode citar o recurso e a conta: não é lido nem logado, só o status.
      await r.body?.cancel().catch(() => undefined);
      throw falhou(operacao, new FalhaDoCofre(r.status >= 500 || r.status === 429 ? "mestra_indisponivel" : "mestra_recusou", { status: r.status }));
    }
    try {
      return await lerJson(r);
    } catch (e) {
      throw falhou(operacao, e instanceof FalhaDoCofre ? e : new FalhaDoCofre("mestra_resposta_invalida"));
    }
  }

  return {
    tipo: "kms",
    async embrulhar(chaveTenant, aad) {
      const corpo = await chamar("encrypt", { plaintext: chaveTenant.toString("base64"), additionalAuthenticatedData: b64(aad) });
      const embrulhada = typeof corpo.ciphertext === "string" ? corpo.ciphertext : "";
      const versao = typeof corpo.name === "string" ? corpo.name : "";
      if (!embrulhada || !versao.startsWith(`${nome}/cryptoKeyVersions/`)) throw falhou("encrypt", new FalhaDoCofre("mestra_resposta_invalida"));
      return { embrulhada, mestraRef: versao };
    },
    async desembrulhar(embrulhada, aad) {
      const corpo = await chamar("decrypt", { ciphertext: embrulhada, additionalAuthenticatedData: b64(aad) });
      const claro = typeof corpo.plaintext === "string" ? Buffer.from(corpo.plaintext, "base64") : Buffer.alloc(0);
      if (claro.length !== TAMANHO_CHAVE) {
        zerar(claro);
        throw falhou("decrypt", new FalhaDoCofre("mestra_resposta_invalida"));
      }
      return claro;
    },
  };
}

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");

/** Só o nome do erro de rede (TimeoutError, TypeError): a mensagem pode trazer a URL com o recurso. */
const nomeDoErro = (e: unknown): Error => new Error(e instanceof Error ? e.name : "desconhecido");

async function lerJson(r: Response): Promise<Record<string, unknown>> {
  let corpo: unknown;
  try {
    corpo = await r.json();
  } catch {
    throw new FalhaDoCofre("mestra_resposta_invalida");
  }
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) throw new FalhaDoCofre("mestra_resposta_invalida");
  return corpo as Record<string, unknown>;
}

/** ADR-195 §2: "alerta em qualquer falha de decifrar". Decrypt que falha é erro; encrypt, aviso. Sem corpo, sem valor. */
function falhou(operacao: "encrypt" | "decrypt", f: FalhaDoCofre): FalhaDoCofre {
  log(operacao === "decrypt" ? "erro" : "aviso", "cofre_mestra_falhou", { operacao, motivo: f.motivo, status: f.status });
  return f;
}

// ------------------------------------------------------------------------------------------------------------ escolha

type EnvDoCofre = { NOD_COFRE_KMS?: string | undefined; NOD_CREDENTIAL_KEY?: string | undefined; NODE_ENV?: string | undefined };

/** `NOD_COFRE_KMS` presente → kms; senão a local pela NOD_CREDENTIAL_KEY. */
export function escolherChaveMestra(env: EnvDoCofre, opcoes: Omit<OpcoesKms, "nome"> = {}): ChaveMestra {
  const kms = env.NOD_COFRE_KMS?.trim();
  if (kms) return chaveMestraKms({ ...opcoes, nome: kms });
  return chaveMestraLocal(env.NOD_CREDENTIAL_KEY ?? "");
}

/**
 * ADR-195 §2: "em produção o boot recusa subir sem NOD_COFRE_KMS". Produção é `NODE_ENV=production`, o critério do
 * resto do servidor (Dockerfile; compor.ts, registry.ts, voz/fabrica.ts). Devolve as recusas (vazia = pode subir), no
 * molde de `recusasDasFlagsDeConta`. Ligada no boot.ts; o deploy.sh grava o NOD_COFRE_KMS no env da cor nova (a chave
 * `nod/cofre` já existe no KMS, com a conta da VM só cifrando e decifrando).
 */
export function recusasDoCofre(env: EnvDoCofre): string[] {
  const r: string[] = [];
  const kms = env.NOD_COFRE_KMS?.trim();
  if (env.NODE_ENV === "production" && !kms) r.push("NODE_ENV=production exige NOD_COFRE_KMS (a chave mestra do cofre no Cloud KMS, ADR-195)");
  if (kms && !NOME_DA_CHAVE.test(kms)) r.push("NOD_COFRE_KMS precisa ser projects/<projeto>/locations/<local>/keyRings/<anel>/cryptoKeys/<chave>");
  return r;
}
