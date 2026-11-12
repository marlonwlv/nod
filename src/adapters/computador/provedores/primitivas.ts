import { createHash, randomBytes } from "node:crypto";
import { posix } from "node:path";
import type { AcaoComputador, ArquivoComputador, ResultadoComputador, TelaComputador } from "../../../contracts/computador.ts";
import type { BotaoMouse, PrimitivasDeComputador, RefComputador } from "../../../contracts/provedor-computador.ts";
import { FalhaComputador } from "../../../domain/computador.ts";
import { anotarQuadro, aspasShell, type EstadoQuadros, mudarRevisao, novoEstadoQuadros, quadroValido } from "../../../domain/provedor-computador.ts";

/**
 * ADR-168 (definido em 2026-11-12): a `AcaoComputador` do nod sobre as primitivas de um provedor de fora. Refaz o que o
 * runtime do nod (infra/computador/runtime.mjs) garante dentro do Docker, com os MESMOS limites, para o bot não notar a
 * troca de provedor:
 *   - quadro: cada observação ganha um; ação que muda a tela troca a revisão; quadro vale 2 min (`tela_alterada`);
 *   - arquivos só dentro da raiz (o /workspace do runtime), resolvidos pelo `realpath -m` na própria máquina;
 *   - ler/gravar arquivo até 512 KiB; texto paginado a 5500 caracteres escapados, com revisão sha256 dos bytes;
 *   - terminal com 20 s e os últimos 30 000 caracteres da saída.
 * O que a máquina de fora não tem (texto da página, URL e abas do navegador, diálogos JS, áudio, anexar num seletor de
 * arquivo) responde `acao_falhou` com o detalhe dizendo o que fazer em vez disso — nunca um sucesso de mentira.
 */

export const TETO_ARQUIVO_BYTES = 524_288;
export const TETO_TEXTO_BYTES = 2_097_152;
export const ORCAMENTO_PAGINA_TEXTO = 5500;
export const PRAZO_TERMINAL_MS = 20_000;
export const TETO_SAIDA_TERMINAL = 30_000;
const PRAZO_COMANDO_INTERNO_MS = 30_000;
/** definido em 2026-11-12: 64 KiB de base64 por comando, metade do MAX_ARG_STRLEN (128 KiB) do Linux. */
export const PEDACO_BASE64 = 65_536;

export type OpcoesPrimitivas = {
  /** A pasta de trabalho do bot na máquina (o /workspace do runtime). */
  raiz: string;
  agora?: () => number;
  novoId?: () => string;
};

const botaoDe = (b: number | undefined): BotaoMouse => (b === 2 ? "direito" : b === 1 ? "meio" : "esquerdo");

const naoTem = (o_que: string, em_vez: string) => new FalhaComputador("acao_falhou", { detalhe: `este provedor de computador não tem ${o_que}; ${em_vez}` });

/** Um executor por provedor: guarda o quadro de cada computador em memória (como o runtime guarda no processo dele). */
export function criarExecutorPorPrimitivas(p: PrimitivasDeComputador, o: OpcoesPrimitivas) {
  const agora = o.agora ?? Date.now;
  const novoId = o.novoId ?? (() => randomBytes(32).toString("hex"));
  const estados = new Map<string, EstadoQuadros>();
  const estado = (id: string) => {
    let e = estados.get(id);
    if (!e) { e = novoEstadoQuadros(novoId()); estados.set(id, e); }
    return e;
  };
  const raiz = posix.resolve(o.raiz);

  /** O caminho absoluto pedido, recusando sair da raiz antes de tocar a máquina (a 2ª checagem é o realpath lá). */
  function dentroDaRaiz(caminho: string): string {
    // eslint-disable-next-line no-control-regex
    if (typeof caminho !== "string" || caminho.length > 1024 || /[\x00-\x1f]/.test(caminho)) throw new FalhaComputador("acao_falhou", { detalhe: "caminho inválido" });
    const absoluto = posix.resolve(raiz, caminho);
    if (absoluto !== raiz && !absoluto.startsWith(`${raiz}/`)) throw new FalhaComputador("acao_falhou", { detalhe: "caminho fora da pasta de trabalho" });
    return absoluto;
  }
  /** Prefixo de shell que resolve links e confere de novo que o alvo ficou dentro da raiz (`$A` vira o caminho real). */
  const resolver = (absoluto: string, criarPasta = false) =>
    `${criarPasta ? `mkdir -p -- "$(dirname -- ${aspasShell(absoluto)})" && ` : ""}A="$(realpath -m -- ${aspasShell(absoluto)})" && case "$A" in ${aspasShell(raiz)}|${aspasShell(raiz)}/*) ;; *) echo nod:caminho >&2; exit 97;; esac && `;

  async function rodar(ref: RefComputador, comando: string): Promise<string> {
    const r = await p.comando(ref, comando, PRAZO_COMANDO_INTERNO_MS);
    if (r.codigoSaida === 97) throw new FalhaComputador("acao_falhou", { detalhe: "caminho fora da pasta de trabalho" });
    if (r.codigoSaida === 98) throw new FalhaComputador("acao_falhou", { detalhe: "arquivo grande demais" });
    if (r.codigoSaida === 99) throw new FalhaComputador("acao_falhou", { detalhe: "arquivo_alterado: leia de novo antes de gravar" });
    if (r.codigoSaida !== 0) throw new FalhaComputador("acao_falhou", { detalhe: r.saida.slice(-500) || `código ${r.codigoSaida}` });
    return r.saida;
  }

  async function tela(ref: RefComputador): Promise<TelaComputador> {
    const t = await p.capturarTela(ref);
    const quadro = novoId();
    anotarQuadro(estado(ref.id), quadro, agora());
    // Sem Playwright não há URL, título, texto nem abas: o bot lê a imagem (instrução no detalhe das ações de navegador).
    return { quadro, imagem: t.png, largura: t.largura, altura: t.altura, url: "", titulo: "", texto: "", abas: [] };
  }

  function exigirQuadro(ref: RefComputador, quadro: string) {
    if (!quadroValido(estado(ref.id), quadro, agora())) throw new FalhaComputador("tela_alterada");
  }
  const mudou = (ref: RefComputador) => mudarRevisao(estado(ref.id), novoId());

  async function lerBytes(ref: RefComputador, absoluto: string, teto: number): Promise<Buffer> {
    const saida = await rodar(ref, `${resolver(absoluto)}[ -f "$A" ] || { echo nao_e_arquivo >&2; exit 1; }; [ "$(stat -c %s -- "$A")" -le ${teto} ] || exit 98; base64 -w0 -- "$A"`);
    return Buffer.from(saida.trim(), "base64");
  }
  const revisao = (b: Buffer) => createHash("sha256").update(b).digest("hex");

  /**
   * Grava em pedaços: um argumento de `bash -c` passa de 128 KiB (MAX_ARG_STRLEN do Linux) com um arquivo de 512 KiB em
   * base64. Os pedaços vão para `<alvo>.nod-parcial` e só o último passo (com a guarda) troca o arquivo, por `mv`.
   */
  async function gravarEmPedacos(ref: RefComputador, absoluto: string, bytes: Buffer, guarda: string) {
    const b64 = bytes.toString("base64");
    const parcial = `${absoluto}.nod-parcial`;
    await rodar(ref, `${resolver(absoluto, true)}: > "$A.nod-parcial"`);
    for (let i = 0; i < b64.length; i += PEDACO_BASE64) {
      await rodar(ref, `${resolver(parcial)}printf %s ${aspasShell(b64.slice(i, i + PEDACO_BASE64))} | base64 -d >> "$A"`);
    }
    await rodar(ref, `${resolver(absoluto)}${guarda}mv -f -- "$A.nod-parcial" "$A"`);
  }

  async function executar(ref: RefComputador, acao: AcaoComputador): Promise<ResultadoComputador> {
    switch (acao.tipo) {
      case "observar":
        return { tela: await tela(ref) };
      case "navegar": {
        if (!/^https?:\/\//i.test(acao.url)) throw new FalhaComputador("acao_falhou", { detalhe: "só URLs http(s)" });
        await p.abrirUrl(ref, acao.url);
        mudou(ref);
        return { tela: await tela(ref) };
      }
      case "clicar":
        exigirQuadro(ref, acao.quadro);
        await p.clicar(ref, { x: acao.x, y: acao.y, botao: botaoDe(acao.botao), vezes: acao.vezes ?? 1 });
        mudou(ref);
        return { tela: await tela(ref) };
      case "arrastar":
        exigirQuadro(ref, acao.quadro);
        await p.arrastar(ref, { x: acao.x, y: acao.y, destinoX: acao.destinoX, destinoY: acao.destinoY });
        mudou(ref);
        return { tela: await tela(ref) };
      case "digitar":
        exigirQuadro(ref, acao.quadro);
        await p.digitar(ref, acao.texto);
        mudou(ref);
        return { tela: await tela(ref) };
      case "tecla":
        exigirQuadro(ref, acao.quadro);
        await p.tecla(ref, acao.tecla);
        mudou(ref);
        return { tela: await tela(ref) };
      case "rolar":
        exigirQuadro(ref, acao.quadro);
        await p.rolar(ref, { x: 640, y: 400, delta: acao.delta });
        mudou(ref);
        return { tela: await tela(ref) };
      case "abas":
        if (acao.aba !== undefined) throw naoTem("controle de abas", "troque de aba pela tela (clique na aba ou ctrl+Tab)");
        return { tela: await tela(ref) };
      case "dialogo":
        throw naoTem("diálogos do navegador por API", "responda o diálogo pela tela (clique no botão ou tecla Return/Escape)");
      case "audio":
        throw naoTem("captura de áudio", "descreva o que precisa ouvir à pessoa ou use outro provedor");
      case "anexar":
        throw naoTem("anexar no seletor de arquivo", "abra o seletor pela tela e digite o caminho completo do arquivo");
      case "terminal": {
        mudou(ref);
        const r = await p.comando(ref, `cd -- ${aspasShell(raiz)} 2>/dev/null || mkdir -p -- ${aspasShell(raiz)}; cd -- ${aspasShell(raiz)}; ${acao.comando}`, PRAZO_TERMINAL_MS);
        return { saida: r.saida.slice(-TETO_SAIDA_TERMINAL), codigoSaida: r.codigoSaida, tela: await tela(ref) };
      }
      case "arquivos": {
        const absoluto = dentroDaRaiz(acao.caminho);
        // Só bash + coreutils (sem find -printf, que nem toda imagem tem): até 200 entradas, ocultas incluídas.
        const saida = await rodar(ref, `${resolver(absoluto)}cd -- "$A" && for f in * .[!.]* ..?*; do { [ -e "$f" ] || [ -L "$f" ]; } || continue; if [ -d "$f" ]; then t=d; else t=f; fi; printf '%s\\t%s\\t%s\\n' "$t" "$(stat -c %s -- "$f")" "$f"; done | head -n 200`);
        const arquivos: ArquivoComputador[] = [];
        for (const linha of saida.split("\n")) {
          const [tipo, tamanho, nome] = linha.split("\t");
          if (!tipo || !nome) continue;
          arquivos.push({ nome, caminho: posix.relative(raiz, posix.join(absoluto, nome)), tamanho: Number(tamanho) || 0, diretorio: tipo === "d" });
        }
        return { arquivos };
      }
      case "ler_arquivo": {
        const absoluto = dentroDaRaiz(acao.caminho);
        const bytes = await lerBytes(ref, absoluto, TETO_ARQUIVO_BYTES);
        return { arquivo: { nome: posix.basename(absoluto), base64: bytes.toString("base64") } };
      }
      case "gravar_arquivo": {
        const absoluto = dentroDaRaiz(acao.caminho);
        if (Buffer.from(acao.base64, "base64").length > TETO_ARQUIVO_BYTES) throw new FalhaComputador("acao_falhou", { detalhe: "arquivo grande demais" });
        await gravarEmPedacos(ref, absoluto, Buffer.from(acao.base64, "base64"), "");
        return { saida: "Arquivo gravado." };
      }
      case "ler_texto": {
        if (!Number.isInteger(acao.inicio) || acao.inicio < 0 || (acao.inicio > 0 && !acao.revisao)) throw new FalhaComputador("acao_falhou", { detalhe: "inicio_invalido" });
        const bytes = await lerBytes(ref, dentroDaRaiz(acao.caminho), TETO_TEXTO_BYTES);
        const atual = revisao(bytes);
        if (acao.revisao !== undefined && acao.revisao !== atual) throw new FalhaComputador("acao_falhou", { detalhe: "arquivo_alterado: leia de novo do início" });
        const completo = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        return { texto: paginar(completo, acao.inicio, atual) };
      }
      case "gravar_texto": {
        const absoluto = dentroDaRaiz(acao.caminho);
        if (acao.texto.length > 131_072 || (acao.revisao !== "novo" && !/^[a-f0-9]{64}$/.test(acao.revisao))) throw new FalhaComputador("acao_falhou", { detalhe: "entrada_invalida" });
        const novos = Buffer.from(acao.texto, "utf8");
        // A conferência da revisão roda na MÁQUINA, no mesmo comando da escrita: entre ler e gravar pela rede, outro
        // processo de lá poderia mudar o arquivo.
        const guarda = acao.revisao === "novo"
          ? `[ ! -e "$A" ] || exit 99; `
          : `[ "$(sha256sum -- "$A" 2>/dev/null | cut -d' ' -f1)" = ${aspasShell(acao.revisao)} ] || exit 99; `;
        await gravarEmPedacos(ref, absoluto, novos, guarda);
        return { saida: "Arquivo gravado.", revisao: revisao(novos) };
      }
    }
  }

  return { executar, esquecer: (id: string) => { estados.delete(id); } };
}

/** O mesmo corte de página de infra/computador/texto.mjs: orçamento em caracteres escapados para JSON, Unicode inteiro. */
export function paginar(completo: string, inicio: number, revisaoAtual: string): NonNullable<ResultadoComputador["texto"]> {
  if (inicio > completo.length) throw new FalhaComputador("acao_falhou", { detalhe: "inicio_invalido" });
  let conteudo = "";
  let tamanho = 0;
  for (const caractere of completo.slice(inicio)) {
    const custo = JSON.stringify(caractere).length - 2;
    if (tamanho + custo > ORCAMENTO_PAGINA_TEXTO) break;
    tamanho += custo;
    conteudo += caractere;
  }
  const fim = inicio + conteudo.length;
  return { conteudo, inicio, proximo: fim < completo.length ? fim : null, total: completo.length, revisao: revisaoAtual };
}
