/**
 * A confirmação de gasto por passkey (ADR-175; Grok Bot: `BeginGrokBotSpendApproval` → asserção WebAuthn). O bot nunca vê
 * nem produz a asserção: o servidor do nod gera o desafio para (compra, total), o navegador ou o app do Mac pede a passkey
 * da pessoa (Touch ID), e o servidor confere a asserção aqui (as regras) e em src/adapters/passkey/ (a assinatura, que
 * precisa de criptografia do Node). Só então o verificador do conector `assistente` responde "confirmado".
 *
 * Puro: hashes e bytes chegam prontos de quem chama.
 */

/** O texto que o desafio carrega: compra, valor e moeda, e um nonce de uso único. Mudar o valor muda o desafio. */
export function textoDoDesafio(a: { compraId: string; centavos: number; moeda: string; nonce: string }): string {
  return `nod-gasto:v1:${a.compraId}:${a.centavos}:${a.moeda}:${a.nonce}`;
}

/** base64url sem preenchimento (o `challenge` do clientDataJSON vem assim, WebAuthn §5.8.1). */
export function base64url(bytes: Uint8Array): string {
  const tabela = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    s += tabela[(n >> 18) & 63]! + tabela[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) s += tabela[(n >> 6) & 63]!;
    if (i + 2 < bytes.length) s += tabela[n & 63]!;
  }
  return s;
}

export type MotivoPasskeyRecusada =
  | "client_data_invalido"
  | "tipo_errado"
  | "desafio_errado"
  | "origem_nao_permitida"
  | "cross_origin"
  | "auth_data_curto"
  | "rp_id_errado"
  | "sem_presenca"
  | "sem_verificacao"
  | "contador_voltou";

export type EntradaAssercao = {
  /** clientDataJSON já decodificado como texto UTF-8. */
  clientDataJSON: string;
  /** O desafio que o servidor gerou (bytes em base64url). */
  desafioEsperado: string;
  /** As origens permitidas (só https; definido em 2026-11-12: a web do nod e o app do Mac, que usa a mesma origem). */
  origens: readonly string[];
  authenticatorData: Uint8Array;
  /** sha256 do rpId esperado, calculado por quem chama. */
  rpIdHash: Uint8Array;
  /** O contador guardado da credencial (0 = o autenticador não conta, como as passkeys sincronizadas). */
  contadorGuardado: number;
};

/**
 * As regras da asserção, sem a assinatura (WebAuthn §7.2, passos 11–17): tipo `webauthn.get`, o desafio exato, a origem
 * https permitida, nada de cross-origin, o rpIdHash, a presença (UP) e a verificação do usuário (UV, Touch ID ou senha do
 * aparelho: gastar sem UV seria só "alguém tocou"). Devolve o contador novo ou o motivo da recusa.
 */
export function conferirAssercao(e: EntradaAssercao): { ok: true; contador: number } | { ok: false; motivo: MotivoPasskeyRecusada } {
  let cd: unknown;
  try {
    cd = JSON.parse(e.clientDataJSON);
  } catch {
    return { ok: false, motivo: "client_data_invalido" };
  }
  if (typeof cd !== "object" || cd === null) return { ok: false, motivo: "client_data_invalido" };
  const c = cd as { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  if (c.type !== "webauthn.get") return { ok: false, motivo: "tipo_errado" };
  if (typeof c.challenge !== "string" || c.challenge !== e.desafioEsperado) return { ok: false, motivo: "desafio_errado" };
  if (typeof c.origin !== "string" || !c.origin.startsWith("https://") || !e.origens.includes(c.origin)) return { ok: false, motivo: "origem_nao_permitida" };
  if (c.crossOrigin === true) return { ok: false, motivo: "cross_origin" };
  const ad = e.authenticatorData;
  if (ad.length < 37) return { ok: false, motivo: "auth_data_curto" };
  for (let i = 0; i < 32; i++) if (ad[i] !== e.rpIdHash[i]) return { ok: false, motivo: "rp_id_errado" };
  const flags = ad[32] ?? 0;
  if ((flags & 0x01) === 0) return { ok: false, motivo: "sem_presenca" };
  if ((flags & 0x04) === 0) return { ok: false, motivo: "sem_verificacao" };
  const contador = (((ad[33] ?? 0) << 24) >>> 0) + ((ad[34] ?? 0) << 16) + ((ad[35] ?? 0) << 8) + (ad[36] ?? 0);
  if ((contador !== 0 || e.contadorGuardado !== 0) && contador <= e.contadorGuardado) return { ok: false, motivo: "contador_voltou" };
  return { ok: true, contador };
}
