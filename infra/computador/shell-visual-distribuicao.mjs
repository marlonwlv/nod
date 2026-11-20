export const VERSAO_SHELL_VISUAL = 'paper-v2';

const caminhos = [
  'manifesto.json',
  'tema/home.html', 'tema/openbox.xml', 'tema/tint2rc', 'tema/wallpaper-nod.svg',
  'apps/browser.svg', 'apps/files.svg', 'apps/terminal.svg',
  'referencias/shell-config.json', 'referencias/tokens.json',
];

export const ARQUIVOS_DO_SHELL_VISUAL = Object.freeze(Object.fromEntries(caminhos.map((caminho) => [
  `computador-shell-${caminho.replaceAll('/', '--')}`,
  caminho,
])));
