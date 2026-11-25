import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  aadDaChaveDoItem,
  aadDaChaveDoTenant,
  aadDoValor,
  cifrarV2,
  cifrarValor,
  decifrarV2,
  decifrarValor,
  desembrulharChaveDoItem,
  embrulharChaveDoItem,
  FalhaDoCofre,
  gerarChave,
  versaoDoV2,
  zerar,
} from "../../../src/db/cifra-envelope.ts";

/** ADR-195 §2: os dois primeiros níveis do envelope (valor pela chave do item; chave do item pela chave do tenant). */
const TENANT = randomUUID();
const OUTRO_TENANT = randomUUID();
const ITEM = randomUUID();
const lugar = { tenantId: TENANT, itemId: ITEM, versao: 1 };
const FORMATO = /^v2:3:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

function falhaCom(fn: () => unknown): FalhaDoCofre {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(FalhaDoCofre);
    return e as FalhaDoCofre;
  }
  throw new Error("não falhou");
}

describe("cifra em envelope (v2)", () => {
  it("ida e volta: valor pela chave do item e chave do item pela chave do tenant, no formato v2:<versão do tenant>", () => {
    const chaveTenant = gerarChave();
    const chaveItem = gerarChave();
    const valor = "sk-exemplo-çã-🔑";
    const cifrado = cifrarValor(valor, chaveItem, lugar, 3);
    const embrulhada = embrulharChaveDoItem(chaveItem, chaveTenant, lugar, 3);
    expect(cifrado).toMatch(FORMATO);
    expect(embrulhada).toMatch(FORMATO);
    expect(cifrado).not.toContain(Buffer.from(valor).toString("base64"));
    expect(versaoDoV2(embrulhada)).toBe(3);

    const aberta = desembrulharChaveDoItem(embrulhada, chaveTenant, lugar, 3);
    expect(aberta.equals(chaveItem)).toBe(true);
    expect(decifrarValor(cifrado, aberta, lugar)).toBe(valor);
  });

  it("cada cifra tem iv próprio: o mesmo valor cifrado duas vezes dá textos diferentes", () => {
    const chave = gerarChave();
    expect(cifrarValor("igual", chave, lugar, 1)).not.toBe(cifrarValor("igual", chave, lugar, 1));
  });

  it("AAD trocada falha: outro item, outra versão, outro tenant, ou a cifra do valor lida como chave", () => {
    const chaveTenant = gerarChave();
    const chaveItem = gerarChave();
    const cifrado = cifrarValor("segredo", chaveItem, lugar, 1);
    const embrulhada = embrulharChaveDoItem(chaveItem, chaveTenant, lugar, 1);

    expect(falhaCom(() => decifrarValor(cifrado, chaveItem, { ...lugar, itemId: randomUUID() })).motivo).toBe("cifra_invalida");
    expect(falhaCom(() => decifrarValor(cifrado, chaveItem, { ...lugar, versao: 2 })).motivo).toBe("cifra_invalida");
    // O item copiado para outro tenant (mesmo id, mesma chave do tenant por hipótese) não abre.
    expect(falhaCom(() => desembrulharChaveDoItem(embrulhada, chaveTenant, { ...lugar, tenantId: OUTRO_TENANT }, 1)).motivo).toBe("cifra_invalida");
    expect(falhaCom(() => decifrarValor(cifrado, chaveItem, { ...lugar, tenantId: OUTRO_TENANT })).motivo).toBe("cifra_invalida");
    // As AADs dos níveis são diferentes: a chave embrulhada não abre como valor, nem o valor como chave.
    expect(falhaCom(() => decifrarV2(embrulhada, chaveTenant, aadDoValor(lugar))).motivo).toBe("cifra_invalida");
    expect(falhaCom(() => decifrarV2(cifrado, chaveItem, aadDaChaveDoItem(lugar))).motivo).toBe("cifra_invalida");
    expect(aadDoValor(lugar)).toBe(`nod-cofre-v2|${TENANT}|${ITEM}|1`);
    expect(aadDaChaveDoItem(lugar)).toBe(`nod-cofre-v2-item|${TENANT}|${ITEM}|1`);
    expect(aadDaChaveDoTenant(TENANT, 4)).toBe(`nod-cofre-v2-tenant|${TENANT}|4`);
  });

  it("chave errada, versão do tenant que não confere, adulteração e formato torto falham fechado, sem o valor na mensagem", () => {
    const chaveTenant = gerarChave();
    const chaveItem = gerarChave();
    const cifrado = cifrarValor("segredo-que-nao-pode-vazar", chaveItem, lugar, 1);
    const embrulhada = embrulharChaveDoItem(chaveItem, chaveTenant, lugar, 1);

    expect(falhaCom(() => decifrarValor(cifrado, gerarChave(), lugar)).motivo).toBe("cifra_invalida");
    expect(falhaCom(() => desembrulharChaveDoItem(embrulhada, chaveTenant, lugar, 2)).motivo).toBe("cifra_invalida");
    const partes = cifrado.split(":");
    const dados = Buffer.from(partes[4]!, "base64");
    dados[0] = dados[0]! ^ 1;
    const adulterado = [...partes.slice(0, 4), dados.toString("base64")].join(":");
    const f = falhaCom(() => decifrarValor(adulterado, chaveItem, lugar));
    expect(f.message).toBe("cifra_invalida");
    expect(JSON.stringify({ m: f.message, c: String(f.cause) })).not.toContain("segredo-que-nao-pode-vazar");
    for (const torto of ["", "v1:a:b:c", "v2:x:a:b:c", "v2:1:a:b", `v2:1:${partes[2]}:${partes[3]}:%%`]) {
      expect(falhaCom(() => decifrarValor(torto, chaveItem, lugar)).motivo).toBe("cifra_invalida");
      expect(versaoDoV2(torto)).toBeNull();
    }
    expect(falhaCom(() => cifrarV2(Buffer.from("x"), Buffer.alloc(16), "aad", 1)).motivo).toBe("cifra_invalida");
    expect(falhaCom(() => cifrarV2(Buffer.from("x"), gerarChave(), "aad", 0)).motivo).toBe("cifra_invalida");
  });

  it("zerar apaga as chaves em memória", () => {
    const a = gerarChave();
    const b = gerarChave();
    zerar(a, null, b, undefined);
    expect(a.every((x) => x === 0) && b.every((x) => x === 0)).toBe(true);
  });
});
