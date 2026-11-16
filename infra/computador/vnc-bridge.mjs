import net from 'node:net';
import process from 'node:process';

// NOD-496: transporte binário de uma única sessão. Ele só roda por `docker exec`; não escuta rede nem cria arquivo.
const socket = net.createConnection({ path: '/tmp/nod-vnc.sock' });
const encerrar = () => { if (!socket.destroyed) socket.destroy(); };
socket.on('connect', () => {
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
});
socket.on('error', () => { process.exitCode = 1; });
socket.on('close', () => {
  process.stdin.unpipe(socket);
  // `docker exec -i` mantém stdin aberto. Sem destruí-lo, a ponte pode sobreviver à queda do VNC e o relay nunca recebe
  // EOF para reconectar ou cair para capturas.
  process.stdin.destroy();
  process.stdout.end();
});
process.stdin.on('error', encerrar);
process.stdin.on('end', () => socket.end());
process.on('SIGTERM', encerrar);
