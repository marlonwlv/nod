import { createHash, createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { conferirAssercao, type MotivoPasskeyRecusada } from "../../domain/passkey.ts";

/**
 * A assinatura da asserção WebAuthn (ADR-177), em volta das regras puras de src/domain/passkey.ts: ES256 (P-256, a que o
 * iCloud Keychain e o 1Password usam) sobre `authenticatorData || sha256(clientDataJSON)` (WebAuthn §7.2 passo 20). A
 * chave pública é a guardada no registro da passkey (JWK), nunca a que vem com a asserção.
 */
export type Assercao = { clientDataJSON: Uint8Array; authenticatorData: Uint8Array; assinatura: Uint8Array };

export function verificarAssercao(a: Assercao, o: { chavePublica: JsonWebKey; rpId: string; desafio: string; origens: readonly string[]; contadorGuardado: number }): { ok: true; contador: number } | { ok: false; motivo: MotivoPasskeyRecusada | "assinatura_invalida" } {
  const regras = conferirAssercao({
    clientDataJSON: Buffer.from(a.clientDataJSON).toString("utf8"),
    desafioEsperado: o.desafio,
    origens: o.origens,
    authenticatorData: a.authenticatorData,
    rpIdHash: createHash("sha256").update(o.rpId).digest(),
    contadorGuardado: o.contadorGuardado,
  });
  if (!regras.ok) return regras;
  const assinado = Buffer.concat([Buffer.from(a.authenticatorData), createHash("sha256").update(a.clientDataJSON).digest()]);
  let valida = false;
  try {
    valida = verify("sha256", assinado, createPublicKey({ key: o.chavePublica, format: "jwk" }), Buffer.from(a.assinatura));
  } catch {
    valida = false;
  }
  return valida ? regras : { ok: false, motivo: "assinatura_invalida" };
}
