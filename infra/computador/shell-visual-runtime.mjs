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
