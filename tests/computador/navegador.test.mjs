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
const alvo = (r, nome) => ({ observacao: r.pagina.observacao, referencia: r.pagina.elementos.find(e => e.nome === nome)?.referencia });
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
