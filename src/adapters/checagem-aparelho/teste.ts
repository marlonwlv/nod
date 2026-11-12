import type { BitsDoAparelho, ChecagemDeAparelho } from "../../contracts/checagem-aparelho.ts";

/**
 * O driver de teste do DeviceCheck (ADR-176): os bits por token num mapa em memória. Token que começa com "invalido" é
 * recusado, como a Apple faz com token vencido. O real (atrás de `NOD_DEVICECHECK=1`) precisa da chave .p8 do DeviceCheck
 * e do Team ID; sem eles o servidor não liga a checagem.
 */
export function criarChecagemTeste(): ChecagemDeAparelho {
  const bits = new Map<string, BitsDoAparelho>();
  return {
    async consultar(token) {
      if (token.startsWith("invalido")) return null;
      return bits.get(token) ?? { bit0: false, bit1: false };
    },
    async marcar(token, b) {
      bits.set(token, { ...b });
    },
  };
}
