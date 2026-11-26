// ADR-197: a fumaça do computador da pessoa com o cua-driver DE VERDADE, no Mac (macos-15) e no Windows (windows-latest)
// da CI. Baixa o pacote fixo (sha256 conferido), sobe o daemon em `bounded` só com o app de teste e roda o caminho que o
// bot usa: abrir o app com um arquivo, ler a janela, digitar, ler de novo e achar o texto. Depois confere que um app
// fora do manifesto volta `precisa_liberar` e que um bloqueado volta `bloqueado`.
//
// No Mac a CI pode não ter Acessibilidade para o processo do runner: aí o passo avisa (::warning::) e sai 0, porque a
// permissão é da pessoa, não do código. Com `--exigir`, falta de permissão é erro.
//
// Uso: npx tsx scripts/seu-computador/fumaca.ts [--exigir] [--saida <pasta>]
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listarAppsLocais } from "../../src/adapters/seu-computador/apps-locais.ts";
import { baixadorDoDriver } from "../../src/adapters/seu-computador/binario.ts";
import { criarSeuComputadorLocal } from "../../src/adapters/seu-computador/driver.ts";
import { criarPessoaWindows } from "../../src/adapters/seu-computador/pessoa-windows.ts";
import type { AppDoComputador, PedidoSeuComputador, RespostaSeuComputador } from "../../src/contracts/seu-computador.ts";

const args = process.argv.slice(2);
const exigir = args.includes("--exigir");
const iSaida = args.indexOf("--saida");
const saida = iSaida >= 0 ? args[iSaida + 1]! : mkdtempSync(join(tmpdir(), "nod-fumaca-"));
mkdirSync(saida, { recursive: true });
const dizer = (m: string) => { process.stdout.write(`${m}\n`); };
const plataforma = process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : null;
if (!plataforma) { dizer("fumaça do computador da pessoa: só Mac e Windows"); process.exit(0); }

const pasta = mkdtempSync(join(tmpdir(), "nod-sc-"));
const MARCA = `nod-fumaca-${Date.now().toString(36)}`;
const arquivo = join(pasta, "fumaca.txt");
writeFileSync(arquivo, "linha do nod\n");

const app: AppDoComputador = plataforma === "darwin"
  ? { id: "com.apple.TextEdit", nome: "Editor de Texto" }
  : { id: "C:\\Windows\\System32\\notepad.exe", nome: "Bloco de Notas" };
const nomeDoApp = plataforma === "darwin" ? "TextEdit" : "notepad";
const relatorio: { passo: string; ms: number; tipo: string; texto?: string }[] = [];

const sc = criarSeuComputadorLocal({
  plataforma,
  pasta,
  binario: baixadorDoDriver({ plataforma, pasta: join(pasta, "bin") }),
  listarApps: async () => {
    const lista = await listarAppsLocais(plataforma);
    // No Windows Server o Bloco de Notas clássico nem sempre tem atalho no Menu Iniciar: entra pelo caminho do sistema.
    if (plataforma === "win32" && !lista.some((a) => a.id.toLowerCase() === app.id.toLowerCase())) lista.push({ ...app, aberto: false, pid: null, apelido: "notepad" });
    for (const a of lista) if (a.id.toLowerCase() === app.id.toLowerCase()) a.id = app.id;
    return lista;
  },
});

async function passo(nome: string, p: PedidoSeuComputador): Promise<RespostaSeuComputador> {
  const t0 = Date.now();
  const r = await sc.executar("00000000-0000-4000-8000-0000000000f1", p);
  const texto = r.tipo === "feito" ? r.texto : r.tipo === "falhou" || r.tipo === "indisponivel" ? r.texto : undefined;
  relatorio.push({ passo: nome, ms: Date.now() - t0, tipo: r.tipo, ...(texto ? { texto: texto.slice(0, 600) } : {}) });
  dizer(`${nome}: ${r.tipo} em ${Date.now() - t0} ms${texto ? ` — ${texto.slice(0, 160).replace(/\n/g, " ")}` : ""}`);
  if (r.tipo === "feito" && r.imagem) writeFileSync(join(saida, `${nome}.${r.imagem.mimeType === "image/png" ? "png" : "jpg"}`), Buffer.from(r.imagem.data, "base64"));
  return r;
}

let falhou = false;
const falharCedo: string[] = [];
// No PC, o vigia da pessoa (a pausa quando ela mexe no app): o PowerShell de verdade tem de responder.
if (plataforma === "win32") {
  const pessoa = criarPessoaWindows({ env: process.env });
  const t0 = Date.now();
  await pessoa.naFrente("C:\\nada.exe");
  const ocioso = pessoa.ociosoS();
  dizer(`pessoa no PC: ocioso ${ocioso} s, em ${Date.now() - t0} ms`);
  if (!Number.isFinite(ocioso)) falharCedo.push("o vigia da pessoa no PC não respondeu");
  pessoa.parar();
}
const falhar = (m: string) => { dizer(`::error::${m}`); falhou = true; };
for (const m of falharCedo) falhar(m);
try {
  const base = { apps: [app], bot: "Fumaça" };
  const fora = await passo("fora-do-manifesto", { ...base, apps: [], acao: "ver", args: { app: nomeDoApp } });
  if (fora.tipo !== "precisa_liberar") falhar(`app fora do manifesto devia pedir liberação, veio ${fora.tipo}`);
  const bloqueado = await passo("bloqueado", { ...base, acao: "ver", args: { app: plataforma === "darwin" ? "Terminal" : "PowerShell" } });
  if (bloqueado.tipo !== "bloqueado" && bloqueado.tipo !== "nao_achei") falhar(`terminal devia ser bloqueado, veio ${bloqueado.tipo}`);
  const abrir = await passo("abrir", { ...base, acao: "abrir_app", args: { app: nomeDoApp, arquivo } });
  if (abrir.tipo === "sem_permissao") {
    const msg = `o runner não tem ${abrir.falta.join(" e ")} para o processo de teste; o caminho do driver subiu e respondeu`;
    if (exigir) falhar(msg); else dizer(`::warning::${msg}`);
  } else {
    if (abrir.tipo !== "feito") falhar(`abrir: ${abrir.tipo}`);
    await new Promise((r) => setTimeout(r, 2500));
    const ver = await passo("ver", { ...base, acao: "ver", args: { app: nomeDoApp } });
    if (ver.tipo !== "feito") falhar(`ver: ${ver.tipo}`);
    else if (!/linha do nod/.test(ver.texto)) dizer("::warning::a árvore não trouxe o texto do arquivo (segue para digitar)");
    // Como o bot: o campo de texto pela referência da leitura (<snapshot>:<linha>), não "o que estiver em foco".
    const snap = ver.tipo === "feito" ? /snapshot_id=(s[0-9a-z]+)/.exec(ver.texto)?.[1] : undefined;
    const linha = ver.tipo === "feito" ? /\[(\d+)\][^\n]*\b(AXTextArea|Edit|Document|RichEdit|Text Editor|TextArea)\b/i.exec(ver.texto)?.[1] : undefined;
    const elemento = snap && linha ? { elemento: `${snap}:${linha}` } : {};
    dizer(`campo de texto: ${elemento.elemento ?? "(sem referência, vai pelo foco)"}`);
    const digitar = await passo("digitar", { ...base, acao: "digitar", args: { app: nomeDoApp, texto: ` ${MARCA}`, ...elemento } });
    if (digitar.tipo !== "feito") falhar(`digitar: ${digitar.tipo}`);
    // O texto tem de estar no valor de um elemento: numa linha da árvore ou na busca do driver (que olha papel, rótulo,
    // valor e id) com ao menos um elemento achado — "0 of N elements match" ecoa a palavra e não conta.
    const depois = await passo("ver-depois", { ...base, acao: "ver", args: { app: nomeDoApp, busca: MARCA } });
    // O valor pode ter quebra de linha (a marca cai na linha seguinte da árvore): vale qualquer linha com a marca, menos o
    // eco da busca ("0 of N elements match query ...").
    const noValor = depois.tipo === "feito" && depois.texto.split("\n").some((l) => l.includes(MARCA) && !/elements? match query/.test(l));
    if (!noValor) falhar("o texto digitado não apareceu no campo da janela");
  }
} catch (e) {
  falhar(e instanceof Error ? e.message : String(e));
} finally {
  await sc.desligar();
  writeFileSync(join(saida, "relatorio.json"), JSON.stringify({ plataforma, relatorio }, null, 2));
  dizer(`relatório em ${join(saida, "relatorio.json")}`);
}
process.exit(falhou ? 1 : 0);
