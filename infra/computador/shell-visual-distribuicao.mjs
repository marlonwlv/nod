export const VERSAO_SHELL_VISUAL = 'paper-v2';

const caminhos = [
  'manifesto.json',
  'tema/home.html', 'tema/openbox.xml', 'tema/tint2rc', 'tema/wallpaper-nod.svg',
  'apps/browser.svg', 'apps/files.svg', 'apps/terminal.svg',
  'qa/1440x900.png', 'qa/1024x768.png', 'qa/390x844.png',
  'referencias/00-cover-2x.png', 'referencias/home-2x.png', 'referencias/paridade-2x.png',
  'referencias/shell-config.json', 'referencias/tokens.json',
];

export const ARQUIVOS_DO_SHELL_VISUAL = Object.freeze(Object.fromEntries(caminhos.map((caminho) => [
  `computador-shell-${caminho.replaceAll('/', '--')}`,
  caminho,
])));
