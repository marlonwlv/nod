export type ManifestoShellVisual = {
  schema: 1;
  versao: string;
  fonte: "paper";
  breakpoints: Array<{ largura: number; altura: number }>;
  arquivos: Array<{ caminho: string; sha256: string }>;
  papeis: { home: string; openbox: string; tint2: string; wallpaper: string };
  apps: { browser: string; files: string; terminal: string };
};
export const FLAG_SHELL_VISUAL: "NOD_SHELL_VISUAL";
export const SHELL_VISUAL_DESLIGADO: "desligado";
export const APPS_DO_SHELL: readonly ["browser", "files", "terminal"];
export const PAPEIS_DO_SHELL: readonly ["home", "openbox", "tint2", "wallpaper"];
export function selecaoDoShellVisual(env?: NodeJS.ProcessEnv): string | null;
export function validarManifestoShellVisual(m: unknown): ManifestoShellVisual;
export function aplicarShellVisual(o: { origem: string; estado: string; versao: string; agora?: number }): Promise<{ alterou: boolean; versao: string; raiz: string }>;
export function recuperarShellVisual(o: { estado: string; agora?: number }): Promise<{ versao: string; raiz: string }>;
export function verificarShellVisual(o: { estado: string }): Promise<{ versao: string; raiz: string; manifesto: ManifestoShellVisual } | null>;
export function prepararShellVisual(o: { env?: NodeJS.ProcessEnv; origem: string; estado: string; agora?: number }): Promise<{ habilitado: false; versao: null; raiz: null; alterou: false } | { habilitado: true; versao: string; raiz: string; alterou: boolean; manifesto: ManifestoShellVisual }>;
