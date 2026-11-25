import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * A cifra em envelope do cofre (definido em 2026-11-24, ADR-195 §2). Três níveis, todos AES-256-GCM com dados associados
 * (AAD) que prendem a cifra ao lugar dela:
 *
 * 1. **chave do item** (32 bytes por versão do item) cifra o valor, AAD `nod-cofre-v2|tenant|item|versão`;
 * 2. **chave do tenant** (32 bytes, uma viva por tenant) embrulha a chave do item, AAD `nod-cofre-v2-item|tenant|item|versão`;
 * 3. **chave mestra** (KMS ou a local por HKDF, src/adapters/cofre/chave-mestra.ts) embrulha a chave do tenant, AAD
 *    `nod-cofre-v2-tenant|tenant|versão do tenant`.
 *
 * Copiar a cifra para outro item, outro tenant ou outra versão falha na hora (a tag não confere). Formato gravado:
 * `v2:<versão da chave do tenant>:<iv b64>:<tag b64>:<dados b64>`, o mesmo para o valor e para a chave do item. No valor,
 * a versão é a da chave do tenant quando ele foi guardado (informativa: quem decifra lê a versão da coluna
 * `chave_tenant_versao`, que o CHECK da 0185 amarra à da chave do item).
 *
 * Funções puras, sem log e sem estado. O valor nunca vai para log nem para a mensagem de erro; as chaves cruas são
 * Buffers que quem chama zera com `zerar` quando termina (string de JS não se zera: o valor em claro vive o mínimo).
 * O `v1` de src/db/cifra.ts continua lendo os quatro lugares de hoje até a migração deles (ADR-195, Entrega 4).
 */

const ALGO = "aes-256-gcm";
export const TAMANHO_CHAVE = 32;
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;
const FORMATO_V2 = /^v2:([0-9]{1,9}):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/;

/**
 * Por que o cofre falhou, em código fechado. Nunca leva o valor, a chave ou o corpo da resposta do KMS.
 * - `mestra_indisponivel`: o KMS (ou o metadata server) não respondeu, estourou o prazo ou respondeu 5xx/429.
 * - `mestra_recusou`: o KMS recusou (4xx: sem permissão, chave desligada, AAD ou cifra que não confere).
 * - `mestra_resposta_invalida`: a resposta veio fora do formato esperado.
 * - `cifra_invalida`: o texto gravado não está no formato, ou a tag não conferiu (AAD trocada, chave errada, adulteração).
 * - `chave_do_tenant_ausente`: o item aponta para uma versão da chave do tenant que não existe.
 * - `config_invalida`: o provedor da mestra está mal configurado (nome da chave, NOD_CREDENTIAL_KEY).
 */
export type MotivoFalhaDoCofre = "mestra_indisponivel" | "mestra_recusou" | "mestra_resposta_invalida" | "cifra_invalida" | "chave_do_tenant_ausente" | "config_invalida";

/** Falha fechada do cofre: `message` é só o motivo; o detalhe técnico (sem segredo) mora em `cause`. */
export class FalhaDoCofre extends Error {
  readonly motivo: MotivoFalhaDoCofre;
  /** Status HTTP do KMS/metadata, quando houve resposta. */
  readonly status: number | null;
  constructor(motivo: MotivoFalhaDoCofre, opcoes: { cause?: unknown; status?: number } = {}) {
    super(motivo, opcoes.cause === undefined ? undefined : { cause: opcoes.cause });
    this.name = "FalhaDoCofre";
    this.motivo = motivo;
    this.status = opcoes.status ?? null;
  }
}

/** Onde a cifra mora: o tenant, o id do item e a versão do item. Entra na AAD dos dois primeiros níveis. */
export type LugarDoItem = { tenantId: string; itemId: string; versao: number };

export const aadDoValor = (l: LugarDoItem): string => `nod-cofre-v2|${l.tenantId}|${l.itemId}|${l.versao}`;
export const aadDaChaveDoItem = (l: LugarDoItem): string => `nod-cofre-v2-item|${l.tenantId}|${l.itemId}|${l.versao}`;
export const aadDaChaveDoTenant = (tenantId: string, versao: number): string => `nod-cofre-v2-tenant|${tenantId}|${versao}`;

/** 32 bytes aleatórios: chave de item ou de tenant. */
export function gerarChave(): Buffer {
  return randomBytes(TAMANHO_CHAVE);
}

/** Zera as chaves em memória (best effort: cópias que o Node fez por dentro não são alcançadas). */
export function zerar(...chaves: (Buffer | null | undefined)[]): void {
  for (const c of chaves) c?.fill(0);
}

function exigirChave(chave: Buffer): void {
  if (chave.length !== TAMANHO_CHAVE) throw new FalhaDoCofre("cifra_invalida", { cause: new Error("chave com tamanho errado") });
}

function exigirVersao(versao: number): void {
  if (!Number.isInteger(versao) || versao < 1 || versao > 999_999_999) throw new FalhaDoCofre("cifra_invalida", { cause: new Error("versão fora da faixa") });
}

/** Cifra `dados` com a `chave` e a `aad`, no formato v2 com a `versao` no segundo campo. */
export function cifrarV2(dados: Buffer, chave: Buffer, aad: string, versao: number): string {
  exigirChave(chave);
  exigirVersao(versao);
  const iv = randomBytes(TAMANHO_IV);
  const c = createCipheriv(ALGO, chave, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const enc = Buffer.concat([c.update(dados), c.final()]);
  return `v2:${versao}:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

/** A versão do segundo campo, ou null quando o texto não está no formato v2. Não decifra nada. */
export function versaoDoV2(blob: string): number | null {
  const m = FORMATO_V2.exec(blob);
  return m ? Number(m[1]) : null;
}

/** Decifra o v2. Formato errado, tag que não confere ou versão diferente da esperada: `cifra_invalida`. */
export function decifrarV2(blob: string, chave: Buffer, aad: string, versaoEsperada?: number): Buffer {
  exigirChave(chave);
  const m = FORMATO_V2.exec(blob);
  if (!m) throw new FalhaDoCofre("cifra_invalida", { cause: new Error("fora do formato v2") });
  if (versaoEsperada !== undefined && Number(m[1]) !== versaoEsperada) throw new FalhaDoCofre("cifra_invalida", { cause: new Error("versão da chave não confere") });
  const iv = Buffer.from(m[2]!, "base64");
  const tag = Buffer.from(m[3]!, "base64");
  if (iv.length !== TAMANHO_IV || tag.length !== TAMANHO_TAG) throw new FalhaDoCofre("cifra_invalida", { cause: new Error("iv ou tag com tamanho errado") });
  try {
    const d = createDecipheriv(ALGO, chave, iv);
    d.setAAD(Buffer.from(aad, "utf8"));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(Buffer.from(m[4]!, "base64")), d.final()]);
  } catch (e) {
    // A mensagem do Node ("unable to authenticate data") não traz dado, mas a regra é não levar nada: só o nome.
    throw new FalhaDoCofre("cifra_invalida", { cause: new Error(e instanceof Error ? e.name : "decifra") });
  }
}

/** O valor do item cifrado pela chave do item. `versaoTenant` vai no segundo campo do formato. */
export function cifrarValor(valor: string, chaveItem: Buffer, lugar: LugarDoItem, versaoTenant: number): string {
  const claro = Buffer.from(valor, "utf8");
  try {
    return cifrarV2(claro, chaveItem, aadDoValor(lugar), versaoTenant);
  } finally {
    zerar(claro);
  }
}

export function decifrarValor(blob: string, chaveItem: Buffer, lugar: LugarDoItem): string {
  const claro = decifrarV2(blob, chaveItem, aadDoValor(lugar));
  try {
    return claro.toString("utf8");
  } finally {
    zerar(claro);
  }
}

/** A chave do item embrulhada pela chave do tenant na versão `versaoTenant`. */
export function embrulharChaveDoItem(chaveItem: Buffer, chaveTenant: Buffer, lugar: LugarDoItem, versaoTenant: number): string {
  exigirChave(chaveItem);
  return cifrarV2(chaveItem, chaveTenant, aadDaChaveDoItem(lugar), versaoTenant);
}

/** Desembrulha a chave do item; a versão do formato tem de ser a da chave do tenant usada. */
export function desembrulharChaveDoItem(blob: string, chaveTenant: Buffer, lugar: LugarDoItem, versaoTenant: number): Buffer {
  const chave = decifrarV2(blob, chaveTenant, aadDaChaveDoItem(lugar), versaoTenant);
  if (chave.length !== TAMANHO_CHAVE) {
    zerar(chave);
    throw new FalhaDoCofre("cifra_invalida", { cause: new Error("chave do item com tamanho errado") });
  }
  return chave;
}
