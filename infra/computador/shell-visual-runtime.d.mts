export function dimensoesShell(env?: NodeJS.ProcessEnv): { largura: number; altura: number };
export function renderizarHomeShell(template: string, dados: { nome: string; papel: string; display: string; hora: string; data: string }): string;
export function lancadorShellSeguro(app: "browser" | "files" | "terminal", icone: string): string;
export function tint2ShellSeguro(template: string, lancadores: string[]): string;
export function temaOpenboxShellSeguro(template: string): { nome: string; manterBorda: "yes" | "no" };
