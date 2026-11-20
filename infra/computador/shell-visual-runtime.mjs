import path from 'node:path';

const APLICATIVOS = Object.freeze({
  browser: { nome: 'Browser', comando: '/usr/bin/xdotool search --onlyvisible --class Chromium windowactivate' },
  files: { nome: 'Files', comando: '/usr/bin/pcmanfm /workspace' },
  terminal: { nome: 'Terminal', comando: '/usr/bin/xfce4-terminal --disable-server --working-directory=/workspace' },
});

function escapar(valor) {
  return String(valor).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function dimensoesShell(env = process.env) {
  const numero = (nome, padrao, minimo, maximo) => {
    const valor = env[nome];
    if (valor === undefined || valor === '') return padrao;
    if (!/^\d+$/.test(valor)) throw new Error('shell_dimensoes_invalidas');
    const n = Number(valor);
    if (!Number.isSafeInteger(n) || n < minimo || n > maximo) throw new Error('shell_dimensoes_invalidas');
    return n;
  };
  return { largura: numero('NOD_SHELL_LARGURA', 1280, 390, 7680), altura: numero('NOD_SHELL_ALTURA', 800, 570, 4320) };
}

export function renderizarHomeShell(template, dados) {
  if (typeof template !== 'string' || /<(?:script|iframe|object|embed)\b|\bon\w+\s*=|javascript:|(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(template)) throw new Error('shell_home_insegura');
  const valores = {
    NOME: dados.nome,
    PAPEL: dados.papel,
    DISPLAY: dados.display,
    HORA: dados.hora,
    DATA: dados.data,
  };
  return template.replace(/\{\{(NOME|PAPEL|DISPLAY|HORA|DATA)\}\}/g, (_, chave) => escapar(valores[chave] ?? ''));
}

export function lancadorShellSeguro(app, icone) {
  const configuracao = APLICATIVOS[app];
  if (!configuracao || !path.isAbsolute(icone) || icone.includes('\n')) throw new Error('shell_app_invalido');
  return `[Desktop Entry]\nType=Application\nName=${configuracao.nome}\nExec=${configuracao.comando}\nIcon=${icone}\nTerminal=false\nCategories=Utility;\n`;
}

export function tint2ShellSeguro(template, lancadores) {
  if (typeof template !== 'string' || !Array.isArray(lancadores) || lancadores.length !== 3 || lancadores.some((p) => !path.isAbsolute(p) || p.includes('\n'))) throw new Error('shell_tint2_inseguro');
  const linhas = template.split(/\r?\n/);
  let i = 0;
  const saida = linhas.map((linha) => /^launcher_item_app\s*=/.test(linha) ? `launcher_item_app = ${lancadores[i++] ?? ''}` : linha);
  if (i !== lancadores.length || saida.some((linha) => /^launcher_item_app\s*=\s*$/.test(linha))) throw new Error('shell_tint2_inseguro');
  return saida.join('\n');
}

export function temaOpenboxShellSeguro(template) {
  if (typeof template !== 'string' || /<!DOCTYPE|<!ENTITY|<script\b/i.test(template)) throw new Error('shell_openbox_inseguro');
  const nome = /<name>\s*([^<]{1,80})\s*<\/name>/i.exec(template)?.[1]?.trim();
  const borda = /<keepBorder>\s*(yes|no)\s*<\/keepBorder>/i.exec(template)?.[1]?.toLowerCase() ?? 'no';
  if (!nome || !/^[\w .-]+$/.test(nome)) throw new Error('shell_openbox_inseguro');
  return { nome, manterBorda: borda };
}
