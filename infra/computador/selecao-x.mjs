import { spawn } from 'node:child_process';
import { setTimeout, clearTimeout } from 'node:timers';

/**
 * Revisão 29 do PR #600 (QA): o `xclip` que grava uma seleção deixa um filho no fundo, dono dela, com a saída herdada.
 * Pelo `execFile` a ação esperava esse filho até o prazo (25 s por seleção, 50 s na guarda: estourava o prazo da ação).
 * Aqui a saída vai para o nada e basta o pai sair. Erro, código diferente de 0 ou o prazo vencido viram falha.
 */
export function gravarSelecaoDoX(bin, selecao, arquivo, env, prazoMs = 5000) {
  return new Promise((ok, falha) => {
    const filho = spawn(bin, ['-selection', selecao, arquivo], { env, stdio: 'ignore' });
    const prazo = setTimeout(() => { filho.kill('SIGKILL'); falha(new Error('xclip_preso')); }, prazoMs);
    filho.on('error', (e) => { clearTimeout(prazo); falha(e); });
    filho.on('exit', (codigo) => { clearTimeout(prazo); if (codigo === 0) ok(); else falha(new Error(`xclip saiu com ${codigo}`)); });
  });
}
