export const ELECTRON_MINIMO_ANTI_DOWNGRADE: number;
export const ARGUMENTO_ANTI_DOWNGRADE: string;
export function versaoFinal(versao: unknown): boolean;
export function majorDoElectron(spec: unknown): number | null;
export function chaveAntiDowngrade(entrada: { versao: unknown; electron: unknown }): boolean;
export function lerPacote(json: string): { versao: string | undefined; electron: string | undefined };
