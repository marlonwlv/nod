// Cliente de uma única resposta para o supervisor multi-tela dentro do Docker. O client.mjs continua sendo a ponte
// longa do VNC; este termina assim que encontra a foto pedida ou a resposta do comando, para o `docker exec` não ficar
// preso numa conexão que também recebe batimentos.
import net from 'node:net';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';

let entrada = '';
for await (const parte of process.stdin) entrada += parte;
let pedido;
try { pedido = JSON.parse(entrada); } catch { process.exit(2); }
const comando = pedido?.comando;
if (!comando?.id || !comando?.computadorId) process.exit(2);

const socket = net.connect(process.env.NOD_PC_SOCKET ?? '/tmp/nod-computer.sock');
let buf = '';
let terminou = false;
const timer = setTimeout(() => { socket.destroy(); process.exit(1); }, 65_000);
const terminar = (valor) => {
  if (terminou) return;
  terminou = true;
  clearTimeout(timer);
  process.stdout.write(JSON.stringify(valor));
  socket.end();
};
// A sonda pede somente a foto pública do socket. Ela não fabrica um comando sem assinatura: todo comando que chega a
// `supervisor.tratar` continua autenticado, inclusive quando o servidor é alcançado pelo caminho HTTP do preview.
socket.on('connect', () => socket.write(`${JSON.stringify(pedido.sonda === true ? { tipo: 'pedir_estado', computadorId: comando.computadorId } : comando)}\n`));
socket.on('data', (bytes) => {
  buf += bytes.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const linha = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    let m;
    try { m = JSON.parse(linha); } catch { continue; }
    if (pedido.sonda === true && m?.tipo === 'estado' && m.computadorId === comando.computadorId) return terminar({ estado: m });
    if (m?.tipo === 'resultado' && m.id === comando.id) return terminar({ resultado: m });
  }
});
socket.on('error', () => { clearTimeout(timer); process.exit(1); });
