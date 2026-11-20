// O container compartilhado tem dois processos de privilégio igual: o supervisor (perfis/display) e o terminal
// (comandos no workspace isolado pelo bwrap). Um derruba o outro para o restart do Docker recuperar o conjunto inteiro.
import { spawn } from 'node:child_process';
import { chmod, mkdir } from 'node:fs/promises';
import process from 'node:process';

const run = process.env.NOD_PC_RUN ?? '/tmp/nod-pc';
await mkdir(run, { recursive: true });
await chmod(run, 0o700);

const filhos = ['terminal.mjs', 'supervisor.mjs'].map((arquivo) => spawn(process.execPath, [arquivo], {
  cwd: import.meta.dirname,
  env: process.env,
  stdio: 'inherit',
}));
let encerrando = false;
const encerrar = (codigo = 0) => {
  if (encerrando) return;
  encerrando = true;
  for (const filho of filhos) if (filho.exitCode === null) filho.kill('SIGTERM');
  globalThis.setTimeout(() => process.exit(codigo), 10_000).unref();
};
for (const filho of filhos) {
  filho.on('error', () => encerrar(1));
  filho.on('exit', (codigo, sinal) => { if (!encerrando) encerrar(codigo ?? (sinal ? 1 : 0)); });
}
process.on('SIGTERM', () => encerrar(0));
process.on('SIGINT', () => encerrar(0));
