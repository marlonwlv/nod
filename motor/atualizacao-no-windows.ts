import { spawn, type SpawnOptions } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ARQUIVOS_DO_MOTOR, manifestoComparavel, motorDiferente } from "../src/domain/atualizacao-do-motor.ts";

/**
 * Definido em 2026-11-25: o motor do Windows se atualiza sozinho. Até aqui ele só mudava quando a pessoa rodava de novo
 * `irm https://nodbot.ai/windows | iex` (ADA-11, ADR-147: a troca do root + systemd não existe no Windows). Medido em
 * 25/11: a Micherlaine (Windows, motor de 09/11) pediu o navegador três vezes em 24/11 e o bot respondeu que não havia
 * navegador — o navegador do Windows entrou no motor em 23/11 (#243) e o motor dela nunca recebeu.
 *
 * No Windows o motor mora na pasta do usuário (%LOCALAPPDATA%\nod), sem admin: o próprio script da instalação
 * (ADR-151) troca os arquivos, conferindo o sha256 do manifesto, e religa a tarefa; a conexão fica. Quem pede:
 *
 *   - o motor (`iniciarAtualizacao` com `pedir`): espera os turnos da pessoa como no Linux (ADR-100, ADR-131) e dispara
 *     o script num PowerShell solto (fora da árvore do motor, que o script derruba com `taskkill /T`);
 *   - o app do Windows: para o motor antigo, que não sabe se atualizar (a Micherlaine), na abertura do app e, depois,
 *     se o motor seguir diferente além de `CARENCIA_DO_APP_MS` (o motor novo cuida antes).
 *
 * A marca `atualizando-motor` diz que uma troca está em curso: o vigia do app não religa o motor no meio dela, e nenhum
 * dos dois dispara outra enquanto ela vale. O script a apaga no fim, dê certo ou não.
 */

export type Comando = { arquivo: string; args: string[] };
type Env = Readonly<Record<string, string | undefined>>;

export const MARCA_ATUALIZANDO = "atualizando-motor";
/** A troca leva de segundos a poucos minutos (o npm das IAs é o mais lento); passou disso, a marca é de uma troca que caiu. */
export const VALIDADE_DA_MARCA_MS = 20 * 60_000;
/** O motor novo pede em até ~35 min (JANELA_OCIOSA_MS + o intervalo); o app só entra depois disso. */
export const CARENCIA_DO_APP_MS = 60 * 60_000;
/**
 * QA-234 (2026-11-25): o motor que sabe se atualizar renova este sinal enquanto vive. Com ele, o app não troca o motor:
 * o motor espera os turnos da pessoa (ADR-100, ADR-131) e pode adiar de propósito por horas com um turno longo; o app
 * passava por cima depois de 1 h (e logo ao abrir, como depois da própria atualização do app) e o `taskkill /T` do
 * script cortava o turno no meio. O app segue cobrindo o motor antigo (sem sinal) e o motor que parou de sinalizar.
 */
export const SINAL_DO_MOTOR = "motor-se-atualiza";
/**
 * Aceite da rc.14 no Windows (2026-11-26): o sinal leva os turnos da pessoa (`turnos_da_pessoa`) e é renovado a cada
 * minuto e no começo de cada turno, para o app saber se tem alguém esperando antes de passar por cima. A validade fica
 * em 15 min: o motor até a rc.15 renova a cada 5 min, só com a hora, e não pode parecer morto para o app novo.
 */
export const INTERVALO_DO_SINAL_MS = 60_000;
export const VALIDADE_DO_SINAL_MS = 15 * 60_000;
/**
 * Aceite da rc.14 no Windows (2026-11-26): o motor rc.13 renova o sinal mas a troca dele nunca roda (o `detached` do
 * #358), e o app que respeitava o sinal sem prazo deixava a pessoa presa no rc.13. O app passa por cima do sinal quando
 * a troca que o motor pediu para ESTE manifesto (o `atualizacao-pedida.json`) não pegou em PRAZO_DA_TROCA_PEDIDA_MS
 * (a troca leva poucos minutos; é a validade da marca), ou quando o motor segue diferente além de PRAZO_COM_SINAL_MS
 * (folga sobre a espera mais longa do motor: janela ociosa, drenagem e a hora depois de desistir). Nos dois casos, só
 * sem turno da pessoa no sinal (QA-234, #365): o motor até a rc.15 não conta os turnos, e o app segue em frente.
 */
export const PRAZO_DA_TROCA_PEDIDA_MS = VALIDADE_DA_MARCA_MS;
export const PRAZO_COM_SINAL_MS = 3 * CARENCIA_DO_APP_MS;
/** O motor grava aqui o manifesto do último pedido de troca (assinatura + quando), na pasta do motor. */
export const ARQUIVO_DO_ULTIMO_PEDIDO = "atualizacao-pedida.json";
/** A assinatura do manifesto que o motor compara (a mesma do `atualizacao-pedida.json`). */
export const assinaturaDoManifesto = (m: Readonly<Record<string, string>>): string => createHash("sha256").update(JSON.stringify(Object.entries(m).sort())).digest("hex");
/** De quanto em quanto tempo o app confere o motor com o manifesto. */
export const INTERVALO_DO_APP_MS = 30 * 60_000;

/** A pasta do nod no Windows, como o script da instalação a calcula (`$Pasta`). */
export const pastaDoNodNoWindows = (env: Env): string => env.NOD_PASTA || join(env.LOCALAPPDATA ?? "", "nod");
export const arquivoDaMarca = (env: Env): string => join(pastaDoNodNoWindows(env), MARCA_ATUALIZANDO);
export const arquivoDoSinal = (env: Env): string => join(pastaDoNodNoWindows(env), SINAL_DO_MOTOR);
export const pastaDosArquivosDoMotor = (env: Env): string => join(pastaDoNodNoWindows(env), "motor", "app");

/** Só https://host (ou http em loopback, na CI): o endereço entra entre aspas simples no PowerShell. */
export function servidorValido(servidor: string): boolean {
  return /^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?$/.test(servidor) || /^http:\/\/(127\.0\.0\.1|localhost)(:[0-9]{1,5})?$/.test(servidor);
}

/**
 * O script que roda solto: grava a marca, roda a instalação (que para o motor, troca, e o religa) com a saída no log
 * `atualizacao-motor.log` e apaga a marca no fim. Os caminhos saem do ambiente dentro do PowerShell: o nome do usuário
 * pode ter aspas e nunca entra no texto.
 */
export function scriptDaAtualizacao(servidor: string): string {
  if (!servidorValido(servidor)) throw new Error("servidor_invalido");
  return [
    "$ProgressPreference = 'SilentlyContinue'",
    "$pasta = if ($env:NOD_PASTA) { $env:NOD_PASTA } else { Join-Path $env:LOCALAPPDATA 'nod' }",
    "New-Item -ItemType Directory -Path $pasta -Force | Out-Null",
    `$marca = Join-Path $pasta '${MARCA_ATUALIZANDO}'`,
    "Set-Content -LiteralPath $marca -Value ([DateTime]::UtcNow.ToString('o'))",
    `try { & { irm '${servidor}/windows' | iex } *> (Join-Path $pasta 'atualizacao-motor.log') } finally { Remove-Item -LiteralPath $marca -Force -ErrorAction SilentlyContinue }`,
  ].join("; ");
}

/** `-EncodedCommand`: UTF-16LE em base64, sem aspas nem `|` para outro shell interpretar. */
export const codificar = (script: string): string => Buffer.from(script, "utf16le").toString("base64");

const POWERSHELL = (systemRoot: string) => `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const OCULTO = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden"];

/**
 * Um PowerShell curto que abre outro com `Start-Process` e sai na hora: o de verdade fica órfão, fora da árvore de quem
 * chamou. Do motor isso é obrigatório (o `PararMotor` do script mata a árvore do node.exe com `taskkill /T`).
 */
export function comandoDeAtualizarSolto(servidor: string, systemRoot = "C:\\Windows"): Comando {
  return comandoSolto(scriptDaAtualizacao(servidor), systemRoot);
}

/** O mesmo PowerShell solto com qualquer script (o teste no Windows de verdade dispara um script que só grava um arquivo). */
export function comandoSolto(script: string, systemRoot = "C:\\Windows"): Comando {
  const interno = [...OCULTO, "-EncodedCommand", codificar(script)].map((a) => `'${a}'`).join(",");
  return { arquivo: POWERSHELL(systemRoot), args: [...OCULTO, "-Command", `Start-Process -FilePath '${POWERSHELL(systemRoot)}' -WindowStyle Hidden -ArgumentList ${interno}`] };
}

/**
 * QA da rc.13 no Windows (#358, 2026-11-25): as opções do PowerShell externo. SEM `detached`: no Windows ele vira
 * DETACHED_PROCESS, o PowerShell externo nasce sem console e o `Start-Process` dele não sobe o interno (medido no
 * Windows Server 2022, sessões 0 e 1: a marca e o log nunca apareciam, e o motor seguia velho). Sem `detached` o
 * interno nasce e sobrevive ao `taskkill /T` do motor e à saída do app: o `Start-Process` o tira da árvore, e o job
 * do libuv (SILENT_BREAKAWAY_OK) não leva os netos junto.
 */
export const OPCOES_DO_DISPARO: SpawnOptions = { windowsHide: true, stdio: "ignore" };
/** O PowerShell externo só roda o `Start-Process` e sai; passou disso, desiste de esperar (o interno já pode ter subido). */
export const PRAZO_DO_DISPARO_MS = 30_000;

export type Disparo = { ok: true } | { ok: false; motivo: "erro" | "prazo" | "saida"; codigo?: number | null; erro?: string };
type Gerar = (arquivo: string, args: string[], opcoes: SpawnOptions) => Pick<import("node:child_process").ChildProcess, "once" | "unref">;

/**
 * Dispara o comando de `comandoDeAtualizarSolto` e espera o PowerShell externo sair (ele sai logo depois do
 * `Start-Process`). Esperar importa para o motor que sai em seguida (`sairPorVersao`): sem `detached`, o processo que
 * morre antes do externo terminar levaria o externo junto (o job do libuv mata os filhos diretos ao fechar).
 */
export function dispararSolto(c: Comando, gerar: Gerar = spawn, prazoMs = PRAZO_DO_DISPARO_MS): Promise<Disparo> {
  return new Promise((resolver) => {
    let feito = false;
    const fim = (d: Disparo) => { if (!feito) { feito = true; clearTimeout(t); resolver(d); } };
    const t = setTimeout(() => fim({ ok: false, motivo: "prazo" }), prazoMs);
    let p: ReturnType<Gerar>;
    try { p = gerar(c.arquivo, c.args, OPCOES_DO_DISPARO); } catch (e) { fim({ ok: false, motivo: "erro", erro: e instanceof Error ? e.name : "desconhecido" }); return; }
    p.once("error", (e: Error) => fim({ ok: false, motivo: "erro", erro: e.name }));
    p.once("exit", (codigo: number | null) => fim(codigo === 0 ? { ok: true } : { ok: false, motivo: "saida", codigo }));
    p.unref();
  });
}

/** A marca vale (troca em curso) se existe e é mais nova que VALIDADE_DA_MARCA_MS. */
export const marcaValida = (modificadaEm: number | null, agora: number): boolean => modificadaEm !== null && agora - modificadaEm < VALIDADE_DA_MARCA_MS;

export async function atualizandoAgora(env: Env, agora = Date.now()): Promise<boolean> {
  const m = await stat(arquivoDaMarca(env)).then((s) => s.mtimeMs, () => null);
  return marcaValida(m, agora);
}

/** O motor (que sabe se atualizar) diz que está vivo e cuidando da própria troca, e quantos turnos da pessoa rodam. */
export async function sinalizarQueSeAtualiza(env: Env, agora = Date.now(), turnosDaPessoa?: number): Promise<void> {
  await mkdir(pastaDoNodNoWindows(env), { recursive: true });
  const conteudo = turnosDaPessoa === undefined ? new Date(agora).toISOString() : JSON.stringify({ em: new Date(agora).toISOString(), turnos_da_pessoa: turnosDaPessoa });
  await writeFile(arquivoDoSinal(env), `${conteudo}\n`);
}

/** O sinal lido pelo app. `turnosDaPessoa` null: o motor não conta (até a rc.15 o sinal é só a hora). */
export type SinalDoMotor = { vivo: boolean; turnosDaPessoa: number | null };

export async function lerSinalDoMotor(env: Env, agora = Date.now()): Promise<SinalDoMotor> {
  const m = await stat(arquivoDoSinal(env)).then((s) => s.mtimeMs, () => null);
  if (m === null || agora - m >= VALIDADE_DO_SINAL_MS) return { vivo: false, turnosDaPessoa: null };
  const texto = await readFile(arquivoDoSinal(env), "utf8").catch(() => "");
  let turnos: unknown = null;
  try { turnos = (JSON.parse(texto) as { turnos_da_pessoa?: unknown } | null)?.turnos_da_pessoa ?? null; } catch { turnos = null; }
  return { vivo: true, turnosDaPessoa: typeof turnos === "number" && Number.isFinite(turnos) && turnos >= 0 ? turnos : null };
}

/** O app: o motor instalado sinalizou há pouco que cuida da própria troca? */
export async function motorSeAtualiza(env: Env, agora = Date.now()): Promise<boolean> {
  return (await lerSinalDoMotor(env, agora)).vivo;
}

/**
 * Quando o motor pediu a troca para o manifesto desta assinatura (o `atualizacao-pedida.json` na pasta do motor).
 * null: sem pedido, pedido ilegível ou de outro manifesto.
 */
export async function trocaPedidaPeloMotor(pastaDoMotor: string, assinatura: string): Promise<number | null> {
  const texto = await readFile(join(pastaDoMotor, ARQUIVO_DO_ULTIMO_PEDIDO), "utf8").catch(() => null);
  const p = ((): { assinatura?: unknown; em?: unknown } | null => { try { return texto === null ? null : (JSON.parse(texto) as { assinatura?: unknown; em?: unknown } | null); } catch { return null; } })();
  return p?.assinatura === assinatura && typeof p.em === "number" && Number.isFinite(p.em) ? p.em : null;
}

/** O sha256 dos arquivos do motor instalado (o que falta vem null). */
export async function shaDoMotorInstalado(env: Env): Promise<Record<string, string | null>> {
  const r: Record<string, string | null> = {};
  for (const nome of ARQUIVOS_DO_MOTOR) r[nome] = await readFile(join(pastaDosArquivosDoMotor(env), nome)).then((b) => createHash("sha256").update(b).digest("hex"), () => null);
  return r;
}

/** Os arquivos do manifesto que o Windows instala (o computador não roda no Windows: #337). */
export function manifestoDoWindows(arquivos: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(ARQUIVOS_DO_MOTOR.filter((n) => typeof arquivos[n] === "string").map((n) => [n, arquivos[n]!]));
}

/** O motor instalado difere do servidor? null = não deu para saber (servidor fora, rota antiga): não faz nada. */
export async function motorDoWindowsDiferente(o: { servidor: string; env: Env; buscar?: typeof fetch }): Promise<boolean | null> {
  return (await conferirMotorDoWindows(o))?.diferente ?? null;
}

/**
 * O motor instalado comparado com o manifesto do servidor, com a assinatura que o motor grava no pedido de troca (a do
 * manifesto inteiro sem os arquivos do computador, como o motor do Windows compara). null = não deu para saber.
 */
export async function conferirMotorDoWindows(o: { servidor: string; env: Env; buscar?: typeof fetch }): Promise<{ diferente: boolean; assinatura: string } | null> {
  const r = await (o.buscar ?? fetch)(`${o.servidor}/api/motor/manifesto`, { redirect: "error", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!r?.ok) return null;
  const m = (await r.json().catch(() => null)) as { arquivos?: Record<string, string> } | null;
  if (!m?.arquivos) return null;
  const manifesto = manifestoDoWindows(m.arquivos);
  if (Object.keys(manifesto).length === 0) return null;
  return { diferente: motorDiferente(await shaDoMotorInstalado(o.env), manifesto), assinatura: assinaturaDoManifesto(manifestoComparavel(m.arquivos, "")) };
}

/** `disparouEm`: quando o app passou por cima do sinal por último (a troca dele também pode falhar: tenta de hora em hora). */
export type EstadoDoApp = { diferenteDesde: number | null; jaConferiu: boolean; disparouEm?: number | null };
export const APP_PARADO: EstadoDoApp = { diferenteDesde: null, jaConferiu: false };

export type MotivoDoApp = "motor_antigo" | "carencia" | "troca_do_motor_nao_pegou" | "motor_preso_com_sinal";

/**
 * O app decide se atualiza o motor. A primeira conferência depois de abrir atualiza na hora (é o caminho do motor antigo,
 * e o app recém-aberto quase nunca tem turno no meio); depois, só se o motor seguir diferente além da carência — o motor
 * novo pede sozinho, esperando os turnos da pessoa. Troca em curso (marca) ou sem resposta do servidor: nada.
 *
 * Motor vivo com o sinal (QA-234): o app espera, mas não para sempre (aceite da rc.14): passa por cima quando a troca
 * que o motor pediu para este manifesto (`trocaPedidaEm`) não pegou em PRAZO_DA_TROCA_PEDIDA_MS, ou quando o motor
 * segue diferente além de PRAZO_COM_SINAL_MS — e nunca com turno da pessoa no sinal (`turnosDaPessoa` > 0).
 */
export function appDeveAtualizar(e: EstadoDoApp, o: { agora: number; diferente: boolean | null; atualizando: boolean; motorCuida?: boolean; turnosDaPessoa?: number | null; trocaPedidaEm?: number | null }): { estado: EstadoDoApp; atualizar: boolean; motivo?: MotivoDoApp } {
  if (o.diferente === null) return { estado: e, atualizar: false };
  if (!o.diferente) return { estado: { diferenteDesde: null, jaConferiu: true }, atualizar: false };
  const desde = e.diferenteDesde ?? o.agora;
  const disparouEm = e.disparouEm ?? null;
  const parado = { estado: { diferenteDesde: desde, jaConferiu: true, disparouEm }, atualizar: false };
  if (o.atualizando) return parado;
  if (o.motorCuida) {
    // #365: com turno da pessoa rodando, o motor (ou o app) esperaria; o app não corta o turno no meio.
    if ((o.turnosDaPessoa ?? 0) > 0) return parado;
    if (disparouEm !== null && o.agora - disparouEm < CARENCIA_DO_APP_MS) return parado;
    const motivo: MotivoDoApp | null = o.trocaPedidaEm != null && o.agora - o.trocaPedidaEm >= PRAZO_DA_TROCA_PEDIDA_MS ? "troca_do_motor_nao_pegou"
      : o.agora - desde >= PRAZO_COM_SINAL_MS ? "motor_preso_com_sinal" : null;
    return motivo ? { estado: { diferenteDesde: desde, jaConferiu: true, disparouEm: o.agora }, atualizar: true, motivo } : parado;
  }
  const motivo: MotivoDoApp | null = !e.jaConferiu ? "motor_antigo" : o.agora - desde >= CARENCIA_DO_APP_MS ? "carencia" : null;
  return motivo ? { estado: { diferenteDesde: null, jaConferiu: true, disparouEm }, atualizar: true, motivo } : parado;
}
