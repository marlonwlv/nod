import type { MotorNavegador } from '../../src/contracts/navegador.ts';
export function criarNavegador(opcoes: {
  pagina: () => Promise<unknown>;
  revisao: () => string;
  invalidar: () => void;
  agora?: () => number;
}): MotorNavegador;
