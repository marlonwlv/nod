/**
 * Card D, F3 (definido em 2026-11-12): a tela ao vivo também quando a pessoa só assiste. O noVNC com `viewOnly` não manda
 * teclado nem mouse, mas quem decide é o servidor: neste filtro o fluxo do navegador ao VNC (RFB, RFC 6143) é lido
 * mensagem a mensagem e, sem `entrada`, as que mexem na tela (tecla, ponteiro, área de transferência, tamanho da tela,
 * xvp, gii, tecla estendida do QEMU) não passam. O que o cliente precisa para ver (formato, codificações, pedido de
 * quadro, atualização contínua, fence) passa sempre. Mensagem desconhecida perderia o compasso do fluxo: o filtro
 * falha fechado e a sessão cai (a web reconecta).
 *
 * O aperto de mão é o do x11vnc da tela (`-nopw`, infra/computador/tela.mjs): versão (12 bytes), na 3.7+ o tipo de
 * segurança escolhido (1 byte; o 2, senha VNC, traz mais 16), e o ClientInit (1 byte). Tudo do aperto passa.
 */

/** Maior mensagem que o filtro segura inteira (a área de transferência colada); acima disso a sessão cai. */
export const RFB_MENSAGEM_MAX_BYTES = 4 * 1024 * 1024;

export type ResultadoFiltroRfb = { passa: Uint8Array } | { erro: string };

type Fase = "versao" | "seguranca" | "senha" | "init" | "mensagens";

/** O tamanho da mensagem que começa em `b[0]`, se já der para saber; null = faltam bytes; "desconhecida" = falha. */
function tamanhoDaMensagem(b: Uint8Array): number | null | "desconhecida" {
  const tipo = b[0]!;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const precisa = (n: number) => b.length >= n;
  switch (tipo) {
    case 0: return 20; // SetPixelFormat
    case 2: return precisa(4) ? 4 + 4 * dv.getUint16(2) : null; // SetEncodings
    case 3: return 10; // FramebufferUpdateRequest
    case 4: return 8; // KeyEvent
    case 5: return 6; // PointerEvent
    case 6: return precisa(8) ? 8 + Math.abs(dv.getInt32(4)) : null; // ClientCutText (negativo = área estendida)
    case 150: return 10; // EnableContinuousUpdates
    case 248: return precisa(9) ? 9 + (dv.getUint8(8) & 0xff) : null; // ClientFence
    case 250: return 4; // xvp
    case 251: return precisa(8) ? 8 + 16 * dv.getUint8(6) : null; // SetDesktopSize
    case 253: return precisa(4) ? 4 + dv.getUint16(2, (dv.getUint8(1) & 0x80) === 0) : null; // gii
    case 255: { // QEMU
      if (!precisa(2)) return null;
      const sub = dv.getUint8(1);
      if (sub === 0) return 12; // tecla estendida
      if (sub === 1) { if (!precisa(4)) return null; const op = dv.getUint16(2); return op === 2 ? 10 : op <= 1 ? 4 : "desconhecida"; }
      return "desconhecida";
    }
    default: return "desconhecida";
  }
}

/** As mensagens que mexem na tela; o resto é só para ver. */
const MEXEM = new Set([4, 5, 6, 250, 251, 253]);
function mexe(b: Uint8Array): boolean {
  return MEXEM.has(b[0]!) || (b[0] === 255 && b[1] === 0);
}

/** Um filtro por sessão (guarda o compasso entre os pedaços do WebSocket). `entrada` é lido a cada pedaço. */
export function criarFiltroRfb(): (bytes: Uint8Array, entrada: boolean) => ResultadoFiltroRfb {
  let fase: Fase = "versao";
  let resto = new Uint8Array(0);
  let quebrado = false;
  return (bytes, entrada) => {
    if (quebrado) return { erro: "fluxo quebrado" };
    const buf = new Uint8Array(resto.length + bytes.length);
    buf.set(resto);
    buf.set(bytes, resto.length);
    const saida: Uint8Array[] = [];
    let i = 0;
    const falhar = (erro: string): ResultadoFiltroRfb => { quebrado = true; return { erro }; };
    while (i < buf.length) {
      const b = buf.subarray(i);
      if (fase === "versao") {
        if (b.length < 12) break;
        const v = /^RFB 003\.(\d{3})\n$/.exec(new TextDecoder().decode(b.subarray(0, 12)));
        if (!v) return falhar("versão desconhecida");
        saida.push(b.subarray(0, 12));
        i += 12;
        fase = Number(v[1]) >= 7 ? "seguranca" : "init";
        continue;
      }
      if (fase === "seguranca") {
        const tipo = b[0]!;
        if (tipo !== 1 && tipo !== 2) return falhar("segurança desconhecida");
        saida.push(b.subarray(0, 1));
        i += 1;
        fase = tipo === 2 ? "senha" : "init";
        continue;
      }
      if (fase === "senha") {
        if (b.length < 16) break;
        saida.push(b.subarray(0, 16));
        i += 16;
        fase = "init";
        continue;
      }
      if (fase === "init") {
        saida.push(b.subarray(0, 1));
        i += 1;
        fase = "mensagens";
        continue;
      }
      const n = tamanhoDaMensagem(b);
      if (n === "desconhecida") return falhar(`mensagem desconhecida ${b[0]}`);
      if (n !== null && n > RFB_MENSAGEM_MAX_BYTES) return falhar("mensagem grande demais");
      if (n === null || b.length < n) break;
      if (entrada || !mexe(b)) saida.push(b.subarray(0, n));
      i += n;
    }
    resto = buf.slice(i);
    const total = saida.reduce((s, p) => s + p.length, 0);
    const passa = new Uint8Array(total);
    let at = 0;
    for (const p of saida) { passa.set(p, at); at += p.length; }
    return { passa };
  };
}
