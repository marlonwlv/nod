// NOD-497: pacote visual único para qualquer Linux que hospede o computador do Nod. O conteúdo visual vem do Paper;
// este módulo só instala, valida e alterna versões sem interpretar instruções do bundle nem executar arquivos dele.
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readlink, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const FLAG_SHELL_VISUAL = 'NOD_SHELL_VISUAL';
export const SHELL_VISUAL_DESLIGADO = 'desligado';
export const APPS_DO_SHELL = Object.freeze(['browser', 'files', 'terminal']);
export const PAPEIS_DO_SHELL = Object.freeze(['home', 'openbox', 'tint2', 'wallpaper']);
const VERSAO_RE = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;
const SHA_RE = /^[a-f0-9]{64}$/;
const TRAVA_VELHA_MS = 5 * 60_000;

function falhar(codigo) {
  const e = new Error(codigo);
  e.code = codigo;
  e.codigo = codigo;
  throw e;
}

function caminhoRelativoSeguro(caminho) {
  return typeof caminho === 'string' && caminho.length > 0 && caminho.length <= 240 && !path.isAbsolute(caminho) &&
    caminho === caminho.replaceAll('\\', '/') && !caminho.split('/').some((p) => !p || p === '.' || p === '..');
}

export function selecaoDoShellVisual(env = process.env) {
  const valor = String(env[FLAG_SHELL_VISUAL] ?? '').trim().toLowerCase();
  if (!valor || valor === SHELL_VISUAL_DESLIGADO || valor === '0' || valor === 'false') return null;
  if (!VERSAO_RE.test(valor)) falhar('shell_versao_invalida');
  return valor;
}

export function validarManifestoShellVisual(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m) || m.schema !== 1 || !VERSAO_RE.test(m.versao ?? '')) falhar('shell_manifesto_invalido');
  if (m.fonte !== 'paper') falhar('shell_fonte_invalida');
  if (!Array.isArray(m.breakpoints) || !m.breakpoints.length || m.breakpoints.some((b) => !Number.isSafeInteger(b?.largura) || !Number.isSafeInteger(b?.altura) || b.largura < 320 || b.altura < 320 || b.largura > 7680 || b.altura > 4320)) falhar('shell_breakpoints_invalidos');
  if (new Set(m.breakpoints.map((b) => `${b.largura}x${b.altura}`)).size !== m.breakpoints.length) falhar('shell_breakpoints_invalidos');
  const vistos = new Set();
  if (!Array.isArray(m.arquivos) || !m.arquivos.length) falhar('shell_arquivos_invalidos');
  for (const a of m.arquivos) {
    if (!caminhoRelativoSeguro(a?.caminho) || !SHA_RE.test(a?.sha256 ?? '') || vistos.has(a.caminho)) falhar('shell_arquivos_invalidos');
    vistos.add(a.caminho);
  }
  const conferirMapa = (mapa, chaves, codigo) => {
    if (!mapa || typeof mapa !== 'object' || Array.isArray(mapa) || Object.keys(mapa).sort().join(',') !== [...chaves].sort().join(',')) falhar(codigo);
    for (const chave of chaves) if (!caminhoRelativoSeguro(mapa[chave]) || !vistos.has(mapa[chave])) falhar(codigo);
  };
  conferirMapa(m.papeis, PAPEIS_DO_SHELL, 'shell_papeis_invalidos');
  conferirMapa(m.apps, APPS_DO_SHELL, 'shell_apps_invalidos');
  const papeisEApps = [...Object.values(m.papeis), ...Object.values(m.apps)];
  if (new Set(papeisEApps).size !== papeisEApps.length) falhar('shell_papeis_apps_sobrepostos');
  if (new Set(Object.values(m.apps).map((p) => path.basename(p))).size !== APPS_DO_SHELL.length) falhar('shell_apps_invalidos');
  return m;
}

async function sha256(arquivo) {
  return createHash('sha256').update(await readFile(arquivo)).digest('hex');
}

async function conferirDiretorioReal(raiz) {
  const info = await lstat(raiz).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) falhar('shell_raiz_invalida');
}

async function conferirPaisSemLinks(raiz, caminho) {
  await conferirDiretorioReal(raiz);
  let atual = raiz;
  for (const parte of caminho.split('/').slice(0, -1)) {
    atual = path.join(atual, parte);
    const info = await lstat(atual).catch(() => null);
    if (!info?.isDirectory() || info.isSymbolicLink()) falhar('shell_arquivo_invalido');
  }
}

async function lerManifesto(raiz) {
  const arquivo = path.join(raiz, 'manifesto.json');
  const info = await lstat(arquivo).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) falhar('shell_manifesto_ausente');
  let m;
  try { m = JSON.parse(await readFile(arquivo, 'utf8')); } catch { falhar('shell_manifesto_ausente'); }
  return validarManifestoShellVisual(m);
}

async function conferirArquivo(raiz, item) {
  await conferirPaisSemLinks(raiz, item.caminho);
  const arquivo = path.join(raiz, item.caminho);
  const info = await lstat(arquivo).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink()) falhar('shell_arquivo_invalido');
  if (await sha256(arquivo) !== item.sha256) falhar('shell_checksum_invalido');
  return arquivo;
}

async function conferirVersao(raiz, manifestoEsperado = null) {
  await conferirDiretorioReal(raiz);
  const manifesto = await lerManifesto(raiz);
  if (manifestoEsperado && JSON.stringify(manifesto) !== JSON.stringify(manifestoEsperado)) falhar('shell_versao_divergente');
  for (const item of manifesto.arquivos) await conferirArquivo(raiz, item);
  return manifesto;
}

async function ponteiro(estado, nome) {
  const alvo = await readlink(path.join(estado, nome)).catch((erro) => {
    if (erro?.code === 'ENOENT') return null;
    falhar('shell_ponteiro_invalido');
  });
  if (alvo === null) return null;
  const prefixo = 'versoes/';
  if (!alvo.startsWith(prefixo) || alvo.includes('..') || !VERSAO_RE.test(alvo.slice(prefixo.length))) falhar('shell_ponteiro_invalido');
  return alvo;
}

async function trocarPonteiro(estado, nome, alvo) {
  const temporario = path.join(estado, `.${nome}.${process.pid}.${Date.now()}`);
  await rm(temporario, { force: true });
  await symlink(alvo, temporario);
  await rename(temporario, path.join(estado, nome));
}

const ARQUIVO_RECUPERACAO = '.recuperando.json';

function ponteiroValido(alvo) {
  const prefixo = 'versoes/';
  return typeof alvo === 'string' && alvo.startsWith(prefixo) && !alvo.includes('..') && VERSAO_RE.test(alvo.slice(prefixo.length));
}

async function lerRecuperacao(estado) {
  const arquivo = path.join(estado, ARQUIVO_RECUPERACAO);
  const info = await lstat(arquivo).catch(() => null);
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink()) falhar('shell_recuperacao_invalida');
  const plano = await readFile(arquivo, 'utf8').then(JSON.parse).catch(() => null);
  if (!plano || !ponteiroValido(plano.atual) || !ponteiroValido(plano.anterior) || plano.atual === plano.anterior) falhar('shell_recuperacao_invalida');
  return plano;
}

async function gravarRecuperacao(estado, plano) {
  const temporario = path.join(estado, `.${ARQUIVO_RECUPERACAO}.${process.pid}.${Date.now()}`);
  await writeFile(temporario, `${JSON.stringify(plano)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporario, path.join(estado, ARQUIVO_RECUPERACAO));
}

async function inicioDoProcesso(pid) {
  const statProc = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => null);
  if (!statProc) return null;
  // O nome entre parênteses pode conter espaços; os campos após ele começam no estado (campo 3).
  return statProc.slice(statProc.lastIndexOf(')') + 2).split(' ')[19] ?? null;
}

async function comTrava(estado, fn, agora = Date.now()) {
  await mkdir(estado, { recursive: true, mode: 0o700 });
  await conferirDiretorioReal(estado);
  const trava = path.join(estado, '.aplicando');
  const dono = { pid: process.pid, inicio: await inicioDoProcesso(process.pid), token: randomBytes(16).toString('hex') };
  const arquivoDono = path.join(trava, 'dono.json');
  const aindaSouDono = async () => {
    const lido = await readFile(arquivoDono, 'utf8').then(JSON.parse).catch(() => null);
    return lido?.token === dono.token;
  };
  const confirmarDono = async () => { if (!await aindaSouDono()) falhar('shell_trava_perdida'); };
  const tomar = async () => {
    try {
      await mkdir(trava, { mode: 0o700 });
      await writeFile(arquivoDono, JSON.stringify(dono), { mode: 0o600, flag: 'wx' });
      return;
    } catch (e) { if (e?.code !== 'EEXIST') throw e; }
    const info = await stat(trava).catch(() => null);
    if (!info || agora - info.mtimeMs <= TRAVA_VELHA_MS) falhar('shell_em_atualizacao');
    const ocupante = await readFile(arquivoDono, 'utf8').then(JSON.parse).catch(() => null);
    if (ocupante?.pid && ocupante?.inicio && await inicioDoProcesso(ocupante.pid) === ocupante.inicio) falhar('shell_em_atualizacao');
    const orfa = path.join(estado, `.aplicando-orfa-${dono.token}`);
    try { await rename(trava, orfa); } catch { falhar('shell_em_atualizacao'); }
    try {
      await mkdir(trava, { mode: 0o700 });
      await writeFile(arquivoDono, JSON.stringify(dono), { mode: 0o600, flag: 'wx' });
      await rm(orfa, { recursive: true, force: true });
    } catch {
      await rename(orfa, trava).catch(() => {});
      falhar('shell_em_atualizacao');
    }
  };
  await tomar();
  try { return await fn(confirmarDono); } finally { if (await aindaSouDono()) await rm(trava, { recursive: true, force: true }); }
}

/** Instala uma versão imutável e troca `atual` por rename atômico. Nunca segue symlink vindo do bundle. */
export async function aplicarShellVisual({ origem, estado, versao, agora = Date.now() }) {
  if (!VERSAO_RE.test(versao ?? '')) falhar('shell_versao_invalida');
  return comTrava(estado, async (confirmarDono) => {
    const manifesto = await lerManifesto(origem);
    if (manifesto.versao !== versao) falhar('shell_versao_divergente');
    const atual = await ponteiro(estado, 'atual');
    if (atual === `versoes/${versao}`) {
      await conferirVersao(path.join(estado, atual), manifesto);
      return { alterou: false, versao, raiz: path.join(estado, atual) };
    }
    const versoes = path.join(estado, 'versoes');
    const destino = path.join(versoes, versao);
    await mkdir(versoes, { recursive: true, mode: 0o700 });
    await conferirDiretorioReal(versoes);
    const destinoExistente = await lstat(destino).catch(() => null);
    if (destinoExistente) {
      if (!destinoExistente.isDirectory() || destinoExistente.isSymbolicLink()) falhar('shell_versao_invalida');
      await conferirVersao(destino, manifesto);
    } else {
      const staging = path.join(estado, `.staging-${versao}-${process.pid}-${agora}`);
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true, mode: 0o700 });
      try {
        for (const item of manifesto.arquivos) {
          const fonte = await conferirArquivo(origem, item);
          const saida = path.join(staging, item.caminho);
          await mkdir(path.dirname(saida), { recursive: true, mode: 0o700 });
          await copyFile(fonte, saida, constants.COPYFILE_EXCL);
        }
        await writeFile(path.join(staging, 'manifesto.json'), `${JSON.stringify(manifesto, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        await conferirVersao(staging, manifesto);
        await rename(staging, destino);
      } catch (e) {
        await rm(staging, { recursive: true, force: true });
        throw e;
      }
    }
    await confirmarDono();
    if (atual) await trocarPonteiro(estado, 'anterior', atual);
    await trocarPonteiro(estado, 'atual', `versoes/${versao}`);
    return { alterou: true, versao, raiz: destino };
  }, agora);
}

/** Volta para a versão anterior sem apagar nenhuma versão; a versão desfeita vira a próxima recuperação. */
export async function recuperarShellVisual({ estado, agora = Date.now() }) {
  return comTrava(estado, async (confirmarDono) => {
    const pendente = await lerRecuperacao(estado);
    if (pendente) {
      await conferirVersao(path.join(estado, pendente.anterior));
      await confirmarDono();
      await trocarPonteiro(estado, 'atual', pendente.anterior);
      await trocarPonteiro(estado, 'anterior', pendente.atual);
      await rm(path.join(estado, ARQUIVO_RECUPERACAO));
      return { versao: pendente.anterior.slice('versoes/'.length), raiz: path.join(estado, pendente.anterior) };
    }
    const atual = await ponteiro(estado, 'atual');
    const anterior = await ponteiro(estado, 'anterior');
    if (!atual || !anterior || atual === anterior) falhar('shell_sem_versao_anterior');
    await conferirVersao(path.join(estado, anterior));
    await confirmarDono();
    await gravarRecuperacao(estado, { atual, anterior });
    await trocarPonteiro(estado, 'atual', anterior);
    await trocarPonteiro(estado, 'anterior', atual);
    await rm(path.join(estado, ARQUIVO_RECUPERACAO));
    return { versao: anterior.slice('versoes/'.length), raiz: path.join(estado, anterior) };
  }, agora);
}

export async function verificarShellVisual({ estado }) {
  const atual = await ponteiro(estado, 'atual');
  if (!atual) return null;
  const raiz = path.join(estado, atual);
  const manifesto = await conferirVersao(raiz);
  return { versao: manifesto.versao, raiz, manifesto };
}

/** Entrada comum a Docker e Orgo. A ausência da flag é o estado seguro enquanto o Paper não foi exportado. */
export async function prepararShellVisual({ env = process.env, origem, estado, agora = Date.now() }) {
  const versao = selecaoDoShellVisual(env);
  if (versao === null) return { habilitado: false, versao: null, raiz: null, alterou: false };
  const aplicado = await aplicarShellVisual({ origem, estado, versao, agora });
  const verificado = await verificarShellVisual({ estado });
  return { habilitado: true, ...aplicado, manifesto: verificado.manifesto };
}
