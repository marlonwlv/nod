// Sandbox Docker de um único comando: o host monta somente o workspace do agente em /workspace.
import process from 'node:process';
import { rodarComando } from './terminal.mjs';

let entrada = '';
for await (const parte of process.stdin) entrada += parte;
let pedido;
try { pedido = JSON.parse(entrada); } catch { process.exit(2); }
if (typeof pedido?.comando !== 'string' || !pedido.comando.trim() || pedido.comando.length > 8000) process.exit(2);
const resultado = await rodarComando({ workspace: '/workspace', comando: pedido.comando, bwrap: null });
process.stdout.write(JSON.stringify(resultado));
