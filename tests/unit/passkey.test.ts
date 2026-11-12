import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verificarAssercao } from "../../src/adapters/passkey/verificar-assercao.ts";
import { base64url, textoDoDesafio } from "../../src/domain/passkey.ts";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const chavePublica = publicKey.export({ format: "jwk" });
const RP = "nod.exemplo.com";
const ORIGEM = "https://nod.exemplo.com";
const desafio = base64url(createHash("sha256").update(textoDoDesafio({ compraId: "c1", centavos: 17980, moeda: "BRL", nonce: "n1" })).digest());

function assercao(p: { flags?: number; contador?: number; origem?: string; desafio?: string; tipo?: string; rp?: string; chave?: typeof privateKey } = {}) {
  const ad = Buffer.alloc(37);
  createHash("sha256").update(p.rp ?? RP).digest().copy(ad, 0);
  ad[32] = p.flags ?? 0x05;
  ad.writeUInt32BE(p.contador ?? 0, 33);
  const cd = Buffer.from(JSON.stringify({ type: p.tipo ?? "webauthn.get", challenge: p.desafio ?? desafio, origin: p.origem ?? ORIGEM, crossOrigin: false }));
  const assinatura = sign("sha256", Buffer.concat([ad, createHash("sha256").update(cd).digest()]), p.chave ?? privateKey);
  return { clientDataJSON: cd, authenticatorData: ad, assinatura };
}
const conf = { chavePublica, rpId: RP, desafio, origens: [ORIGEM], contadorGuardado: 0 };

describe("passkey do gasto (ADR-177)", () => {
  it("aceita a asserção certa (P-256, UP e UV, desafio do valor)", () => {
    expect(verificarAssercao(assercao(), conf)).toEqual({ ok: true, contador: 0 });
  });
  it("o desafio muda com o valor: a passkey de R$ 179,80 não paga R$ 179,81", () => {
    const outro = base64url(createHash("sha256").update(textoDoDesafio({ compraId: "c1", centavos: 17981, moeda: "BRL", nonce: "n1" })).digest());
    expect(verificarAssercao(assercao(), { ...conf, desafio: outro })).toEqual({ ok: false, motivo: "desafio_errado" });
  });
  it("recusa: outra chave, origem http, outro rpId, sem UV, tipo create, contador que volta", () => {
    const { privateKey: outra } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    expect(verificarAssercao(assercao({ chave: outra }), conf)).toEqual({ ok: false, motivo: "assinatura_invalida" });
    expect(verificarAssercao(assercao({ origem: "http://nod.exemplo.com" }), { ...conf, origens: ["http://nod.exemplo.com"] })).toEqual({ ok: false, motivo: "origem_nao_permitida" });
    expect(verificarAssercao(assercao({ rp: "mau.exemplo.com" }), conf)).toEqual({ ok: false, motivo: "rp_id_errado" });
    expect(verificarAssercao(assercao({ flags: 0x01 }), conf)).toEqual({ ok: false, motivo: "sem_verificacao" });
    expect(verificarAssercao(assercao({ tipo: "webauthn.create" }), conf)).toEqual({ ok: false, motivo: "tipo_errado" });
    expect(verificarAssercao(assercao({ contador: 5 }), { ...conf, contadorGuardado: 5 })).toEqual({ ok: false, motivo: "contador_voltou" });
    expect(verificarAssercao(assercao({ contador: 6 }), { ...conf, contadorGuardado: 5 })).toEqual({ ok: true, contador: 6 });
  });
  it("base64url sem preenchimento", () => {
    expect(base64url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
    expect(base64url(new TextEncoder().encode("nod"))).toBe("bm9k");
  });
});
