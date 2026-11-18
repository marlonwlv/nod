import { setTimeout, clearTimeout } from 'node:timers';
import { URL } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { criarComputadores } from '../../src/adapters/fundo/computadores.ts';
import { FERRAMENTAS_COMPUTADOR } from '../../src/contracts/ferramentas-computador.ts';

// Gateway real → transporte IPC → processo de tela real → Chromium. Repositórios em memória;
// perfil descartável e sem bwrap: este ensaio prova a navegação, não o isolamento do SO.
test('ferramenta real, controle humano, fila IPC e navegador persistente', { timeout: 90_000 }, async () => {
  const raiz = await mkdtemp(join(process.cwd(), '../ensaio-'));
  const http = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<title>Fixture</title><h1>Conversa controlada</h1><label>Mensagem<input></label><button onclick="document.querySelector(\'[role=status]\').textContent=\'Enviado: \'+document.querySelector(\'input\').value;this.disabled=true">Enviar</button><p role="status">Pendente</p>');
  });
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  const proc = fork(new URL('../../infra/computador/tela.mjs', import.meta.url), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  // Não imprimir conteúdo de navegação nem ambiente. stderr é retido apenas para falha do boot da fixture.
  let stderr = ''; proc.stderr.on('data', b => { stderr = (stderr + b).slice(-4000); });
  const pending = new Map();
  proc.on('message', m => { if (m.tipo === 'resposta') { pending.get(m.id)?.(m); pending.delete(m.id); } });
  const enviar = a => new Promise((resolve, reject) => {
    const id = randomUUID(); const timer = setTimeout(() => { pending.delete(id); reject(new Error('prazo da fixture')); }, 30_000);
    pending.set(id, m => { clearTimeout(timer); if (m.erro) reject(new Error(m.erro)); else resolve(m.resultado); });
    proc.send({ tipo: 'acao', id, acao: a });
  });
  try {
    for (const d of ['base', 'logins', 'ws', 'run', 'perfis']) await mkdir(join(raiz, d));
    const pronta = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`boot: ${stderr}`)), 40_000);
      const ouvir = m => { if (m.tipo === 'pronta' || m.tipo === 'falhou') { clearTimeout(timer); proc.off('message', ouvir); if (m.tipo === 'pronta') resolve(); else reject(new Error(m.codigo)); } };
      proc.on('message', ouvir);
    });
    proc.send({ tipo: 'abrir', config: {
      agenteId: 'fixture', display: 300 + process.pid % 100, raiz, run: join(raiz, 'run'), ocultar: [], perfil: join(raiz, 'perfis/fixture'), perfilBase: join(raiz, 'base'), workspace: join(raiz, 'ws'), logins: join(raiz, 'logins'), tmp: join(raiz, 'run/tela'), x11: '/tmp/.X11-unix', busEndereco: 'unix:path=/nonexistent-fixture-bus', sandbox: false, cookies: [], storage: [], geracao: 0,
      bin: { xvfb: '/usr/bin/Xvfb', openbox: '/usr/bin/openbox', chromium: process.env.NOD_CHROME, xdotool: '/usr/bin/xdotool', scrot: '/usr/bin/scrot', xclip: '/usr/bin/xclip', bwrap: null, tint2: '/nonexistent-fixture-dock' },
    } });
    await pronta;
    const escopo = { tenantId: randomUUID(), pessoaId: randomUUID() };
    const agenteId = randomUUID(), turnoId = randomUUID();
    let computador = { id: randomUUID(), agenteId, habilitado: true, controle: 'bot', politica: 'autonomo', ajuda: null, ajudaDecisaoId: null, ocupadoAte: null, operacaoId: null, criadoEm: 0, falhasSeguidas: 0, falhaMotivo: null, indisponivelDesde: null };
    const deps = { escopo, agora: Date.now, repos: {
      computadores: { obter: async () => computador, travar: async () => computador, registrar: async () => ({ id: randomUUID() }), concluir: async () => {}, ocupar: async (_id, operacaoId, ocupadoAte) => { computador = { ...computador, operacaoId, ocupadoAte }; }, liberar: async () => { computador = { ...computador, operacaoId: null, ocupadoAte: null }; }, registrarSucesso: async () => false },
      turnos: { buscar: async () => ({ id: turnoId, estado: 'executando', agenteId, ownerId: escopo.pessoaId, pararSolicitadoEm: null, motivoInterrupcao: null }) },
      agentes: { buscar: async () => ({ id: agenteId, modoAprovacao: 'total' }), execucaoBloqueada: async () => false },
      paradas: { ativa: async () => false }, events: { gravarComOutbox: async () => {} },
    } };
    const driver = { ambiente: async () => ({ disponivel: true, motivo: null }), estado: async () => ({ disponivel: true, ativo: true, motivo: null }), iniciar: async () => {}, parar: async () => {}, ligados: async () => new Set(), executar: (_id, a) => enviar(a) };
    const gateway = criarComputadores({ executor: () => 'catcher', dentro: async (_e, fn) => fn(deps), driver, cifrar: s => s, decifrar: s => s, mudou: () => {} });
    const plano = { ...escopo, turnoId, agenteId, conversaId: randomUUID(), expiraEm: Number.MAX_SAFE_INTEGER, confiancaEntrada: 'nao_confiavel', autoria: { conta_de_execucao: escopo.pessoaId }, catalogo: { ferramentas: Object.keys(FERRAMENTAS_COMPUTADOR).map(nome => ({ nome, origem: 'computador' })) } };
    const chamar = async (nome, args) => {
      const r = await gateway.chamar(escopo, plano, nome, args);
      assert.equal(r.ok, true); assert.notEqual(r.isError, true, r.conteudo); return JSON.parse(r.conteudo);
    };
    const elementos = args => chamar('computador_elementos', args);
    await chamar('computador_navegar', { url: `http://127.0.0.1:${http.address().port}` });
    let r = await elementos({ operacao: 'observar' });
    const ref = nome => ({ observacao: r.pagina.observacao, nome, papel: r.pagina.elementos.find(e => e.nome === nome).papel, referencia: r.pagina.elementos.find(e => e.nome === nome).referencia });
    r = await elementos({ operacao: 'preencher', ...ref('Mensagem'), texto: 'Envio controlado' });
    const clique = { tipo: 'elementos', operacao: 'clicar', ...ref('Enviar') };
    // A fila real recebe duas ações simultâneas com a mesma referência: só a primeira pode produzir efeito.
    const corrida = await Promise.allSettled([enviar(clique), enviar(clique)]);
    assert.deepEqual(corrida.map(x => x.status), ['fulfilled', 'rejected']);
    assert.equal(corrida[1].reason.message, 'tela_alterada');
    assert.deepEqual(await elementos({ operacao: 'verificar', papel: 'status', condicao: 'texto', texto: 'Enviado: Envio controlado' }), { verificacao: { satisfeita: true } });
    computador.controle = 'pessoa';
    const bloqueado = await chamar('computador_elementos', { operacao: 'observar' });
    assert.equal(bloqueado.estado, 'aguardando_pessoa');
    computador.controle = 'bot';
    assert.ok((await elementos({ operacao: 'observar' })).pagina);
  } finally {
    http.close();
    proc.kill('SIGTERM');
    await once(proc, 'exit');
    await rm(raiz, { recursive: true, force: true });
  }
});
