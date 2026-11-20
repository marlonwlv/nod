import { randomBytes } from 'node:crypto';
import { setTimeout as esperar } from 'node:timers/promises';

const token = () => randomBytes(32).toString('hex');
const PRAZO = 120_000;
const MAX_ELEMENTOS = 150;
const MAX_TEXTOS = 12_000;
const LEITURAS_PARALELAS = 8;

/**
 * Adaptador de MotorNavegador. Recebe a página da sessão existente: não cria perfil nem toca credenciais.
 * O chamador mantém a mesma reserva/fila das ações visuais. Não repetir efeitos após erro/timeout.
 */
export function criarNavegador({ pagina, revisao, invalidar, agora = Date.now }) {
  let observada = null;
  async function limpar() {
    const anterior = observada;
    observada = null;
    if (anterior) await Promise.all([...anterior.alvos.values()].map(a => a.handle.dispose().catch(() => {})));
  }
  async function observar(filtro) {
    await limpar();
    const p = await pagina();
    const r = revisao();
    const id = token();
    const alvos = new Map();
    const handles = new Set();
    const elementos = [];
    const textos = [];
    let caracteres = 0;
    let truncada = false;
    const vistos = new Set();
    const frames = p.frames();
    if (frames.length > 20) throw new Error("acao_falhou");
    let visitados = 0;
    const fotos = [];
    try {
      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i];
        const arvore = await frame.locator('body').ariaSnapshotJSON({ timeout: 3000 });
        fotos.push({ frame, arvore: JSON.stringify(arvore) });
        // A árvore ARIA achata contenteditable sem role em nós de texto. Extraia texto
        // pelo DOM para preservar a fronteira editável, inclusive em shadow roots.
        const publicos = await frame.locator('body').evaluate((body, limite) => {
          const document = body.ownerDocument;
          const { Node, Element } = document.defaultView;
          const saida = [];
          let restantes = limite;
          function visitarDom(no) {
            if (restantes <= 0) return;
            if (no.nodeType === Node.TEXT_NODE) {
              const texto = no.textContent.trim();
              if (!texto) return;
              const range = document.createRange(); range.selectNodeContents(no);
              if (!range.getClientRects().length) return;
              saida.push(texto.slice(0, restantes)); restantes -= texto.length;
              return;
            }
            if (no instanceof Element) {
              if (no.isContentEditable || no.matches('input, textarea, select, script, style, [role="textbox"], [role="searchbox"], [role="combobox"], [role="spinbutton"], [aria-hidden="true"]')) return;
              const estilo = document.defaultView.getComputedStyle(no);
              if (estilo.display === 'none' || estilo.visibility === 'hidden') return;
              if (no.shadowRoot) { for (const filho of no.shadowRoot.childNodes) visitarDom(filho); return; }
            }
            for (const filho of no.childNodes) visitarDom(filho);
          }
          visitarDom(body);
          return saida;
        }, MAX_TEXTOS - caracteres + 1);
        for (const t of publicos) {
          const restante = MAX_TEXTOS - caracteres;
          if (t.length > restante) truncada = true;
          const texto = t.slice(0, restante);
          if (texto) textos.push(texto);
          caracteres += texto.length;
        }
        const candidatos = [];
        function visitar(nodes) {
          for (const n of Array.isArray(nodes) ? nodes : [nodes]) {
            if (!n || typeof n !== 'object') continue;
            if (++visitados > 3000) { truncada = true; return; }
            const nome = n.name ?? '';
            if (n.role && n.role !== 'text' && n.role !== 'generic' && (!filtro || n.role === filtro.papel && (filtro.nome === undefined || nome === filtro.nome))) {
              const chave = JSON.stringify([i, n.role, nome]);
              if (!vistos.has(chave)) {
                vistos.add(chave);
                candidatos.push({ papel: n.role, nome });
              }
            }
            if (n.children) visitar(n.children);
          }
        }
        visitar(arvore);
        // Só leituras independentes em paralelo; ordem, teto e validação antes do efeito permanecem iguais.
        for (let inicio = 0; inicio < candidatos.length;) {
          const vagas = MAX_ELEMENTOS - elementos.length;
          if (!vagas) { truncada = true; break; }
          const lote = candidatos.slice(inicio, inicio + Math.min(LEITURAS_PARALELAS, vagas));
          inicio += lote.length;
          const resultados = await Promise.allSettled(lote.map(async ({ papel, nome }) => {
            const locator = frame.getByRole(papel, { name: nome, exact: true });
            if (await locator.count() !== 1) return null;
            const handle = await locator.elementHandle({ timeout: 1000 });
            if (!handle) return null;
            handles.add(handle);
            if (await handle.evaluate(el => el.matches('input[type=password]') || (el.isContentEditable && !['textbox', 'searchbox'].includes(el.getAttribute('role'))))) {
              await handle.dispose(); handles.delete(handle); return null;
            }
            const semantica = await locator.ariaSnapshot({ timeout: 1000 });
            return { handle, locator, semantica, frame, url: frame.url(), papel, nome: String(nome).slice(0, 1000) };
          }));
          // Esperar o lote inteiro permite descartar todos os handles mesmo se uma leitura falhar.
          const falha = resultados.find(r => r.status === 'rejected');
          if (falha) throw falha.reason;
          for (const resultado of resultados) {
            const alvo = resultado.value;
            if (!alvo) continue;
            const referencia = token();
            alvos.set(referencia, alvo);
            elementos.push({ referencia, papel: alvo.papel, nome: alvo.nome, frame: i });
          }
        }
      }
      if (r !== revisao() || p !== await pagina()) throw new Error('tela_alterada');
      observada = { id, p, r, em: agora(), alvos, fotos };
      return { pagina: { observacao: id, url: p.url(), titulo: await p.title(), elementos, textos, truncada } };
    } catch (e) {
      await Promise.all([...handles].map(handle => handle.dispose().catch(() => {})));
      throw e;
    }
  }
  async function conferir(a) {
    const o = observada;
    const p = await pagina();
    const alvo = o?.alvos.get(a.referencia);
    if (!o || o.id !== a.observacao || o.p !== p || o.r !== revisao() || agora() - o.em > PRAZO || !alvo || alvo.frame.isDetached() || alvo.url !== alvo.frame.url()) throw new Error('tela_alterada');
    if (a.papel !== alvo.papel || a.nome !== alvo.nome) throw new Error('tela_alterada');
    if (p.frames().length !== o.fotos.length) throw new Error('tela_alterada');
    for (const foto of o.fotos) {
      if (foto.frame.isDetached() || JSON.stringify(await foto.frame.locator('body').ariaSnapshotJSON({ timeout: 1000 })) !== foto.arvore) throw new Error('tela_alterada');
    }
    if (await alvo.locator.count() !== 1 || !(await alvo.locator.evaluate((el, antigo) => el === antigo && el.isConnected, alvo.handle)) || await alvo.locator.ariaSnapshot({ timeout: 1000 }) !== alvo.semantica) throw new Error('tela_alterada');
    if (await alvo.handle.evaluate(el => el.matches('input[type=password]'))) throw new Error('acao_falhou');
    return alvo;
  }
  async function condicao(a) {
    const p = await pagina();
    const matches = [];
    for (const f of p.frames()) {
      const l = f.getByRole(a.papel, { ...(a.nome === undefined ? {} : { name: a.nome, exact: true }), includeHidden: true });
      const n = await l.count();
      if (n > 1) return false;
      if (n === 1) matches.push(l);
    }
    if (matches.length > 1) return false;
    if (!matches.length) return a.condicao === 'oculto';
    const l = matches[0];
    if (a.condicao === 'oculto') return !(await l.isVisible());
    if (!(await l.isVisible())) return false;
    if (a.condicao === 'visivel') return true;
    // Texto renderizado, nunca inputValue (senha e outros valores não são extraídos).
    return await l.innerText({ timeout: 1000 }) === a.texto;
  }
  return {
    async executar(a) {
      if (a.operacao === 'observar' || a.operacao === 'localizar') return observar(a.operacao === 'localizar' ? a : undefined);
      if (a.operacao === 'esperar' || a.operacao === 'verificar') {
        const fim = agora() + (a.operacao === 'esperar' ? a.timeoutMs ?? 5000 : 0);
        let satisfeita;
        do {
          satisfeita = await condicao(a);
          if (satisfeita || agora() >= fim) break;
          // Poll de uma condição externa; não é atraso para decidir ordem de ações.
          await esperar(100);
        } while (agora() <= fim);
        return { verificacao: { satisfeita } };
      }
      const alvo = await conferir(a);
      // Invalida ANTES do efeito; resposta perdida não torna a referência reutilizável.
      invalidar();
      try {
        if (a.operacao === 'clicar') await alvo.handle.click({ timeout: 3000 });
        else if (a.operacao === 'preencher') await alvo.handle.fill(a.texto, { timeout: 3000 });
        else throw new Error('acao_falhou');
      } finally { await limpar(); }
      return observar();
    },
  };
}
