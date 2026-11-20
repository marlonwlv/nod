/* global window, document, setTimeout -- callbacks de page.evaluate executam no navegador. */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '../../infra/computador/node_modules/playwright-core/index.mjs';
import { criarNavegador } from '../../infra/computador/navegador.mjs';

let browser, page, motor, revision;
const html = `<!doctype html><title>Mensageiro de teste</title>
<h1>Conversa com Fixture</h1><label>Mensagem<input></label>
<button onclick="document.querySelector('[role=status]').textContent='Enviado: '+document.querySelector('input').value; this.dataset.envios=Number(this.dataset.envios||0)+1">Enviar</button>
<div role="status">Ainda não enviado</div><input type="password" aria-label="Senha" value="segredo-da-fixture">
<button>Duplicado</button><button>Duplicado</button>`;
before(async () => { browser = await chromium.launch({ executablePath: process.env.NOD_CHROME, headless: true, args: ['--no-sandbox'] }); });
after(async () => { await browser?.close(); });
beforeEach(async () => {
  await page?.close(); page = await browser.newPage(); await page.setContent(html); revision = 'inicio';
  motor = criarNavegador({ pagina: async () => page, revisao: () => revision, invalidar: () => { revision += '.'; } });
});
const observar = () => motor.executar({ operacao: 'observar' });
const alvo = (r, nome) => ({ observacao: r.pagina.observacao, ...r.pagina.elementos.find(e => e.nome === nome) });
test('observar → localizar → preencher → clicar → verificar envio, sem pixels', async () => {
  let r = await motor.executar({ operacao: 'localizar', papel: 'textbox', nome: 'Mensagem' });
  assert.equal(r.pagina.elementos.length, 1);
  r = await motor.executar({ operacao: 'preencher', ...alvo(r, 'Mensagem'), texto: 'Olá da fixture' });
  r = await motor.executar({ operacao: 'clicar', ...alvo(r, 'Enviar') });
  assert.ok(r.pagina.textos.includes('Enviado: Olá da fixture'));
  assert.deepEqual(await motor.executar({ operacao: 'verificar', papel: 'status', condicao: 'texto', texto: 'Enviado: Olá da fixture' }), { verificacao: { satisfeita: true } });
  assert.equal(await page.getByRole('button', { name: 'Enviar', exact: true }).getAttribute('data-envios'), '1');
});
test('não expõe senha/valor editável nem escolhe alvo ambíguo', async () => {
  await page.getByRole('textbox', { name: 'Mensagem' }).fill('valor-privado');
  const r = await observar();
  assert.doesNotMatch(JSON.stringify(r), /segredo-da-fixture|valor-privado/);
  assert.equal(r.pagina.elementos.some(e => e.nome === 'Senha' || e.nome === 'Duplicado'), false);
});
test('substituição DOM idêntica exige nova observação', async () => {
  const a = alvo(await observar(), 'Enviar');
  await page.getByRole('button', { name: 'Enviar', exact: true }).evaluate(el => el.replaceWith(el.cloneNode(true)));
  await assert.rejects(motor.executar({ operacao: 'clicar', ...a }), /tela_alterada/);
  assert.equal(await page.getByRole('status').innerText(), 'Ainda não enviado');
});
test('troca do destinatário invalida o botão Enviar mesmo quando ele não muda', async () => {
  const a = alvo(await observar(), 'Enviar');
  await page.locator('h1').evaluate(el => { el.textContent = 'Outro destinatário'; });
  await assert.rejects(motor.executar({ operacao: 'clicar', ...a }), /tela_alterada/);
});
test('resposta perdida não permite repetir referência; observar permite conferir o efeito', async () => {
  const a = alvo(await observar(), 'Enviar');
  await motor.executar({ operacao: 'clicar', ...a }); // Simula consumidor que perdeu esta resposta.
  await assert.rejects(motor.executar({ operacao: 'clicar', ...a }), /tela_alterada/);
  await observar();
  assert.equal(await page.getByRole('button', { name: 'Enviar', exact: true }).getAttribute('data-envios'), '1');
});
test('mudança visual/revisão e reinício do adaptador invalidam referências', async () => {
  const a = alvo(await observar(), 'Enviar'); revision = 'visual';
  await assert.rejects(motor.executar({ operacao: 'clicar', ...a }), /tela_alterada/);
  const reiniciado = criarNavegador({ pagina: async () => page, revisao: () => revision, invalidar: () => {} });
  await assert.rejects(reiniciado.executar({ operacao: 'clicar', ...a }), /tela_alterada/);
  assert.ok((await reiniciado.executar({ operacao: 'observar' })).pagina);
});
test('esperar/verificar distinguem condição satisfeita de timeout e ambiguidade', async () => {
  assert.equal((await motor.executar({ operacao: 'esperar', papel: 'status', condicao: 'texto', texto: 'Nunca', timeoutMs: 0 })).verificacao.satisfeita, false);
  assert.equal((await motor.executar({ operacao: 'verificar', papel: 'button', nome: 'Duplicado', condicao: 'visivel' })).verificacao.satisfeita, false);
  assert.equal((await motor.executar({ operacao: 'esperar', papel: 'button', nome: 'Ausente', condicao: 'oculto', timeoutMs: 100 })).verificacao.satisfeita, true);
});
test('iframe e shadow DOM usam elementos da sessão atual', async () => {
  await page.setContent('<iframe srcdoc="<button>Dentro do frame</button>"></iframe><div id="shadow"></div>');
  await page.locator('#shadow').evaluate(el => { el.attachShadow({ mode: 'open' }).innerHTML = '<button>No shadow</button>'; });
  const r = await observar();
  assert.ok(r.pagina.elementos.find(e => e.nome === 'Dentro do frame' && e.frame === 1));
  assert.ok(r.pagina.elementos.find(e => e.nome === 'No shadow'));
});
test('observação expirada e ação que falha não podem ser reaproveitadas', async () => {
  let agora = 0;
  const local = criarNavegador({ pagina: async () => page, revisao: () => revision, invalidar: () => { revision += '.'; }, agora: () => agora });
  const a = alvo(await local.executar({ operacao: 'observar' }), 'Enviar');
  agora = 120001;
  await assert.rejects(local.executar({ operacao: 'clicar', ...a }), /tela_alterada/);
  const b = alvo(await observar(), 'Enviar');
  // fill em botão falha antes de produzir efeito; mesmo assim a referência é consumida.
  await assert.rejects(motor.executar({ operacao: 'preencher', ...b, texto: 'inválido' }));
  await assert.rejects(motor.executar({ operacao: 'clicar', ...b }), /tela_alterada/);
});

test('não extrai conteúdo editável sem role, inclusive descendentes e shadow DOM', async () => {
  await page.setContent('<h1>Texto público</h1><div contenteditable><span>rascunho-privado</span><p>outro-privado</p><h2>titulo-privado</h2></div><div id="host"></div>');
  await page.locator('#host').evaluate(el => { el.attachShadow({ mode: 'open' }).innerHTML = '<div contenteditable>shadow-privado</div><p>Texto shadow público</p>'; });
  const r = await observar();
  assert.doesNotMatch(JSON.stringify(r), /rascunho-privado|outro-privado|shadow-privado|titulo-privado/);
  assert.ok(r.pagina.textos.includes('Texto público'));
  assert.ok(r.pagina.textos.includes('Texto shadow público'));
});

test('recusa rótulo de aprovação diferente do alvo real antes do efeito', async () => {
  const a = alvo(await observar(), 'Enviar');
  await assert.rejects(motor.executar({ operacao: 'clicar', ...a, nome: 'Cancelar' }), /tela_alterada/);
  assert.equal(await page.getByRole('status').innerText(), 'Ainda não enviado');
});

// Regression: QA-001 — texto cortado precisa avisar que a observação é parcial.
// Found by /qa on 2026-11-18
// Report: .gstack/qa-reports/qa-report-elementos-2026-11-18.md
test('sinaliza truncamento de texto mesmo sem atingir o limite de elementos', async () => {
  await page.setContent(`<p>${'a'.repeat(12001)}</p>`);
  const r = await observar();
  assert.equal(r.pagina.textos.join('').length, 12000);
  assert.equal(r.pagina.truncada, true);
  await page.setContent(`<p>${'a'.repeat(12000)}</p>`);
  assert.equal((await observar()).pagina.truncada, false);
  await page.setContent(`<p>${'a'.repeat(12000)}</p><p>omitido</p>`);
  assert.equal((await observar()).pagina.truncada, true);
});

test('espera mudança real da condição e preserva cookies da sessão fornecida', async () => {
  await page.context().addCookies([{ name: 'sessao_fixture', value: 'valor_sintetico', domain: 'fixture.invalid', path: '/' }]);
  const cookies = await page.context().cookies();
  await page.evaluate(() => { setTimeout(() => { document.querySelector('[role=status]').textContent = 'Concluído'; }, 150); });
  assert.equal((await motor.executar({ operacao: 'esperar', papel: 'status', condicao: 'texto', texto: 'Concluído', timeoutMs: 2000 })).verificacao.satisfeita, true);
  await observar();
  assert.deepEqual(await page.context().cookies(), cookies);
});

test('efeito concluído seguido de falha de observação não permite reenviar', async () => {
  await page.setContent('<button onclick="window.envios=(window.envios||0)+1;document.body.remove()">Enviar</button>');
  const a = alvo(await observar(), 'Enviar');
  await assert.rejects(motor.executar({ operacao: 'clicar', ...a }));
  assert.equal(await page.evaluate(() => window.envios), 1);
  await assert.rejects(motor.executar({ operacao: 'clicar', ...a }), /tela_alterada/);
  assert.equal(await page.evaluate(() => window.envios), 1);
  await page.evaluate(() => { document.documentElement.appendChild(document.createElement('body')); document.body.innerHTML = '<p role="status">Enviado uma vez</p>'; });
  assert.equal((await motor.executar({ operacao: 'verificar', papel: 'status', condicao: 'texto', texto: 'Enviado uma vez' })).verificacao.satisfeita, true);
});

test('coleta concorrente mantém ordem, limite e exclusão de alvos ambíguos', async () => {
  await page.setContent('<button>Duplicado</button><button>Duplicado</button>' + Array.from({ length: 170 }, (_, i) => `<button>Alvo ${i}</button>`).join(''));
  const r = await observar();
  assert.deepEqual(r.pagina.elementos.map(e => e.nome), Array.from({ length: 150 }, (_, i) => `Alvo ${i}`));
  assert.equal(r.pagina.truncada, true);
  assert.equal(new Set(r.pagina.elementos.map(e => e.referencia)).size, 150);
});

test('falha num lote descarta handles de leituras que terminam depois da falha', { timeout: 5000 }, async () => {
  let descartados = 0;
  let liberar;
  const portao = new Promise(resolve => { liberar = resolve; });
  const criarHandle = () => ({ dispose: async () => { descartados++; }, evaluate: async () => false });
  const frame = {
    locator: () => ({ ariaSnapshotJSON: async () => [{ role: 'button', name: 'Falha' }, { role: 'button', name: 'Tardio' }], evaluate: async () => [] }),
    getByRole: (_papel, { name }) => ({
      count: async () => 1,
      elementHandle: async () => { if (name === 'Tardio') await portao; return criarHandle(); },
      ariaSnapshot: async () => { if (name === 'Falha') { liberar(); throw new Error('falha_fixture'); } return 'botão'; },
    }),
    url: () => 'https://fixture.invalid',
  };
  const local = criarNavegador({ pagina: async () => ({ frames: () => [frame] }), revisao: () => 'fixa', invalidar: () => {} });
  await assert.rejects(local.executar({ operacao: 'observar' }), /falha_fixture/);
  assert.equal(descartados, 2);
});
