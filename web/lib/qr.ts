/**
 * #84: um QR code mínimo para o link do pareamento (ADR-124), sem dependência nova (ADR-020). Só o que o link pede:
 * modo byte, correção de erro M (15%), versões 1 a 10 (até 213 bytes), máscara escolhida pela penalidade da norma
 * (ISO/IEC 18004). O desenho segue o gerador de referência de Nayuki (MIT): padrões fixos, dados em zigue-zague, blocos
 * intercalados e Reed-Solomon em GF(256) com o polinômio 0x11D.
 */

/** Por versão (índice 1 a 10), correção M: bytes de correção por bloco e número de blocos. */
const ECC_POR_BLOCO = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCOS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const VERSAO_MAX = 10;
/** Os bits do nível M no formato (L=01, M=00, Q=11, H=10). */
const NIVEL_M = 0;

/** A matriz do QR: `true` = módulo escuro. Linha a linha (y), depois coluna (x). */
export type MatrizQr = boolean[][];

/** Módulos que guardam dados: o total menos os padrões fixos (localizador, alinhamento, tempo, formato, versão). */
function modulosDeDados(v: number): number {
  let n = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const a = Math.floor(v / 7) + 2;
    n -= (25 * a - 10) * a - 55;
    if (v >= 7) n -= 36;
  }
  return n;
}
function bytesDeDados(v: number): number {
  return Math.floor(modulosDeDados(v) / 8) - ECC_POR_BLOCO[v]! * BLOCOS[v]!;
}
/** Os centros dos padrões de alinhamento numa linha (e numa coluna). */
function posicoesDeAlinhamento(v: number): number[] {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2;
  const passo = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const r = [6];
  for (let p = v * 4 + 17 - 7; r.length < n; p -= passo) r.splice(1, 0, p);
  return r;
}

// ---------------------------------------------------------------------------------------------- Reed-Solomon
function multiplicar(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}
function divisor(grau: number): number[] {
  const r = new Array<number>(grau).fill(0);
  r[grau - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < grau; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = multiplicar(r[j]!, raiz);
      if (j + 1 < r.length) r[j] = r[j]! ^ r[j + 1]!;
    }
    raiz = multiplicar(raiz, 0x02);
  }
  return r;
}
/** Os bytes de correção de um bloco (o resto da divisão pelo polinômio gerador). Exportado para o teste com o exemplo da norma. */
export function correcaoReedSolomon(dados: readonly number[], grau: number): number[] {
  const d = divisor(grau);
  const r = new Array<number>(grau).fill(0);
  for (const b of dados) {
    const fator = b ^ r.shift()!;
    r.push(0);
    d.forEach((c, i) => { r[i] = r[i]! ^ multiplicar(c, fator); });
  }
  return r;
}

// ---------------------------------------------------------------------------------------------- dados
/** Os bytes de dados da versão: modo byte, contagem, texto, terminador e enchimento (0xEC, 0x11). */
function codificar(bytes: readonly number[], v: number): number[] {
  const bits: number[] = [];
  const por = (valor: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((valor >>> i) & 1); };
  por(0b0100, 4);
  por(bytes.length, v <= 9 ? 8 : 16);
  for (const b of bytes) por(b, 8);
  const capacidade = bytesDeDados(v) * 8;
  por(0, Math.min(4, capacidade - bits.length));
  por(0, (8 - (bits.length % 8)) % 8);
  for (let enche = 0xec; bits.length < capacidade; enche ^= 0xec ^ 0x11) por(enche, 8);
  const r: number[] = [];
  for (let i = 0; i < bits.length; i += 8) r.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return r;
}
/** Divide em blocos, junta a correção de cada um e intercala (byte i de cada bloco, em ordem). */
function intercalar(dados: readonly number[], v: number): number[] {
  const nBlocos = BLOCOS[v]!;
  const ecc = ECC_POR_BLOCO[v]!;
  const total = Math.floor(modulosDeDados(v) / 8);
  const curtos = nBlocos - (total % nBlocos);
  const tamCurto = Math.floor(total / nBlocos);
  const blocos: number[][] = [];
  for (let i = 0, k = 0; i < nBlocos; i++) {
    const d = dados.slice(k, k + tamCurto - ecc + (i < curtos ? 0 : 1));
    k += d.length;
    const c = correcaoReedSolomon(d, ecc);
    if (i < curtos) d.push(0);
    blocos.push([...d, ...c]);
  }
  const r: number[] = [];
  for (let i = 0; i < blocos[0]!.length; i++) {
    blocos.forEach((b, j) => { if (i !== tamCurto - ecc || j >= curtos) r.push(b[i]!); });
  }
  return r;
}

// ---------------------------------------------------------------------------------------------- matriz
type Desenho = { lado: number; m: boolean[][]; fixo: boolean[][] };
function por(d: Desenho, x: number, y: number, escuro: boolean) { d.m[y]![x] = escuro; d.fixo[y]![x] = true; }

/** Os 15 bits do formato (nível + máscara, BCH e a máscara 0x5412), nas duas cópias, e o módulo escuro fixo. */
function desenharFormato(d: Desenho, mascara: number) {
  const dado = (NIVEL_M << 3) | mascara;
  let resto = dado;
  for (let i = 0; i < 10; i++) resto = (resto << 1) ^ ((resto >>> 9) * 0x537);
  const bits = ((dado << 10) | resto) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) por(d, 8, i, bit(i));
  por(d, 8, 7, bit(6));
  por(d, 8, 8, bit(7));
  por(d, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) por(d, 14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) por(d, d.lado - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) por(d, 8, d.lado - 15 + i, bit(i));
  por(d, 8, d.lado - 8, true);
}
/** Versão 7 em diante: os 18 bits da versão (BCH 0x1F25), nos dois cantos. */
function desenharVersao(d: Desenho, v: number) {
  if (v < 7) return;
  let resto = v;
  for (let i = 0; i < 12; i++) resto = (resto << 1) ^ ((resto >>> 11) * 0x1f25);
  const bits = (v << 12) | resto;
  for (let i = 0; i < 18; i++) {
    const escuro = ((bits >>> i) & 1) !== 0;
    const a = d.lado - 11 + (i % 3);
    const b = Math.floor(i / 3);
    por(d, a, b, escuro);
    por(d, b, a, escuro);
  }
}
function desenharFixos(d: Desenho, v: number) {
  for (let i = 0; i < d.lado; i++) { por(d, 6, i, i % 2 === 0); por(d, i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [d.lado - 4, 3], [3, d.lado - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < d.lado && y >= 0 && y < d.lado) por(d, x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  const al = posicoesDeAlinhamento(v);
  const ult = al.length - 1;
  al.forEach((cx, i) => al.forEach((cy, j) => {
    // Os três cantos dos localizadores não levam alinhamento.
    if ((i === 0 && j === 0) || (i === 0 && j === ult) || (i === ult && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) por(d, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  desenharFormato(d, 0); // reserva as posições; a máscara certa entra no fim
  desenharVersao(d, v);
}
/** Os bits em zigue-zague, de baixo para cima e de cima para baixo, em pares de colunas da direita para a esquerda. */
function desenharDados(d: Desenho, dados: readonly number[]) {
  let i = 0;
  for (let dir = d.lado - 1; dir >= 1; dir -= 2) {
    if (dir === 6) dir = 5;
    for (let vert = 0; vert < d.lado; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = dir - j;
        const subindo = ((dir + 1) & 2) === 0;
        const y = subindo ? d.lado - 1 - vert : vert;
        if (!d.fixo[y]![x] && i < dados.length * 8) {
          d.m[y]![x] = ((dados[i >>> 3]! >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }
}
const MASCARAS: ReadonlyArray<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];
function aplicarMascara(d: Desenho, k: number) {
  const f = MASCARAS[k]!;
  for (let y = 0; y < d.lado; y++) for (let x = 0; x < d.lado; x++) if (!d.fixo[y]![x] && f(x, y)) d.m[y]![x] = !d.m[y]![x];
}

/**
 * A penalidade da norma (quanto menor, mais fácil de ler): sequências de 5+ módulos iguais, blocos 2×2 iguais, padrões
 * parecidos com o localizador (1:1:3:1:1 com 4 claros de um lado) e o desequilíbrio entre escuros e claros.
 */
export function penalidade(m: MatrizQr): number {
  const lado = m.length;
  let p = 0;
  const linhas: boolean[][] = [];
  for (let y = 0; y < lado; y++) linhas.push(m[y]!);
  for (let x = 0; x < lado; x++) linhas.push(m.map((l) => l[x]!));
  const localizador = [true, false, true, true, true, false, true];
  for (const l of linhas) {
    let corrida = 1;
    for (let i = 1; i <= lado; i++) {
      if (i < lado && l[i] === l[i - 1]) corrida++;
      else { if (corrida >= 5) p += corrida - 2; corrida = 1; }
    }
    for (let i = 0; i + 7 <= lado; i++) {
      if (!localizador.every((v, k) => l[i + k] === v)) continue;
      const claros = (de: number, ate: number) => { for (let k = de; k < ate; k++) if (k >= 0 && k < lado && l[k]) return false; return true; };
      if (claros(i - 4, i) || claros(i + 7, i + 11)) p += 40;
    }
  }
  for (let y = 0; y + 1 < lado; y++) {
    for (let x = 0; x + 1 < lado; x++) {
      const c = m[y]![x];
      if (m[y]![x + 1] === c && m[y + 1]![x] === c && m[y + 1]![x + 1] === c) p += 3;
    }
  }
  const escuros = m.reduce((a, l) => a + l.filter(Boolean).length, 0);
  const total = lado * lado;
  p += Math.floor(Math.abs(escuros * 20 - total * 10) / total) * 10;
  return p;
}

/** A matriz do QR do texto (UTF-8), na menor versão que cabe; null = maior do que a versão 10 aguenta. */
export function matrizQr(texto: string): MatrizQr | null {
  const bytes = [...new TextEncoder().encode(texto)];
  let v = 1;
  while (v <= VERSAO_MAX && bytes.length + (v <= 9 ? 2 : 3) > bytesDeDados(v)) v++;
  if (v > VERSAO_MAX) return null;
  const lado = v * 4 + 17;
  const novo = (): Desenho => ({ lado, m: Array.from({ length: lado }, () => new Array<boolean>(lado).fill(false)), fixo: Array.from({ length: lado }, () => new Array<boolean>(lado).fill(false)) });
  const base = novo();
  desenharFixos(base, v);
  desenharDados(base, intercalar(codificar(bytes, v), v));
  let melhor: MatrizQr | null = null;
  let menor = Infinity;
  for (let k = 0; k < 8; k++) {
    const d: Desenho = { lado, m: base.m.map((l) => [...l]), fixo: base.fixo };
    aplicarMascara(d, k);
    desenharFormato(d, k);
    const p = penalidade(d.m);
    if (p < menor) { menor = p; melhor = d.m; }
  }
  return melhor;
}

/**
 * O QR em SVG: módulos escuros num fundo branco com a margem de 4 módulos que a norma pede. As cores são fixas (preto no
 * branco) de propósito: no tema escuro, um QR invertido não é lido por muitas câmeras.
 */
export function svgQr(texto: string, rotulo: string): string | null {
  const m = matrizQr(texto);
  if (!m) return null;
  const margem = 4;
  const n = m.length + margem * 2;
  let caminho = "";
  m.forEach((l, y) => l.forEach((escuro, x) => { if (escuro) caminho += `M${x + margem} ${y + margem}h1v1h-1z`; }));
  const r = rotulo.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return `<svg class="qr" viewBox="0 0 ${n} ${n}" role="img" aria-label="${r}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${n}" height="${n}" fill="#fff"/><path d="${caminho}" fill="#000"/></svg>`;
}
