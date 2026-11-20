import { randomBytes, timingSafeEqual } from "node:crypto";
import { FECHAMENTOS_VIVO } from "../../contracts/computador-vivo.ts";
import { log } from "../../obs/log.ts";
import { criarFiltroRfb } from "./rfb-so-ver.ts";
import type { Escopo } from "../../shared/types.ts";

/**
 * NOD-95 (definido em 2026-10-29, ADR-138): as sessões da tela ao vivo. Cada sessão junta dois lados que chegam por
 * WebSocket em momentos diferentes: o navegador da pessoa (que pediu) e o motor da máquina (que o servidor mandou vir,
 * pelo comando `vivo` assinado, com o id e o token da sessão). Pareados, o servidor só repassa bytes de um ao outro: o
 * conteúdo é o VNC (RFB) da tela, que ele não interpreta nem guarda. Em memória, como a fila do canal: um servidor
 * reiniciado derruba as sessões, e a web reabre (ou volta às capturas).
 */

/** Um lado da sessão: só bytes. Quem fecha um lado fecha o outro. */
export type LadoVivo = {
  enviar(bytes: Uint8Array): void;
  aoDados(fn: (bytes: Uint8Array) => void): void;
  aoFechar(fn: () => void): void;
  fechar(codigo: number, motivo?: string): void;
};

type Sessao = {
  escopo: Escopo; agenteId: string; token: string; web: LadoVivo; motor: LadoVivo | null; prazo: ReturnType<typeof setTimeout>;
  conferir?: () => Promise<boolean>; vigia: ReturnType<typeof setInterval> | null; falhasSeguidas: number;
  /**
   * Card D, F3: a sessão de quem assiste (aberta com `assistir`). O fluxo do navegador passa pelo filtro RFB e só leva
   * teclado e mouse com `entrada` (a pessoa no controle). Assumir e devolver só mudam `entrada`: a tela não reconecta.
   */
  assistir?: () => Promise<PodeAssistir>; entrada: boolean;
  /** Sobe a cada assumir/devolver: uma reconferência que saiu antes não desfaz a troca que chegou depois. */
  geracao: number;
};

/** Card D, F3: o que a sessão de quem assiste pode, relido no pareamento e a cada RECONFERIR_VIVO_MS. */
export type PodeAssistir = { ver: boolean; mexer: boolean };

/** O motor tem até isto para chegar depois que a web pediu (abrir a tela e subir o VNC cabem aqui). */
export const PRAZO_PAR_MS = 90_000;
/**
 * Revisão do PR #599: de quanto em quanto uma sessão pareada reconfere que a pessoa segue no controle. Os caminhos que
 * tiram o controle já fecham a sessão (`fecharDaTela`); isto cobre a corrida entre a checagem do `vivo` e o pareamento
 * e qualquer caminho futuro que esqueça de fechar.
 */
export const RECONFERIR_VIVO_MS = 10_000;
/** Revisão do PR #599: sessões abertas por pessoa e tela; a mais antiga cai quando passa disto (abas, reconexões). */
export const VIVO_POR_TELA = 2;
/** 2ª revisão: um soluço do banco não derruba a sessão; só esta quantidade de erros seguidos na reconferência. */
export const FALHAS_RECONFERIR_MAX = 3;

export type SessoesVivo = ReturnType<typeof criarSessoesVivo>;

export function criarSessoesVivo(o: { prazoParMs?: number; reconferirMs?: number } = {}) {
  const sessoes = new Map<string, Sessao>();
  const mesmaPessoa = (a: Escopo, b: Escopo) => a.tenantId === b.tenantId && a.pessoaId === b.pessoaId;

  function encerrar(id: string, codigo: number, motivo?: string): void {
    const s = sessoes.get(id);
    if (!s) return;
    sessoes.delete(id);
    clearTimeout(s.prazo);
    if (s.vigia) clearInterval(s.vigia);
    s.web.fechar(codigo, motivo);
    s.motor?.fechar(codigo, motivo);
  }

  /**
   * Pergunta a quem abriu se a pessoa ainda pode estar ao vivo; não pode: a sessão acaba. Erro (banco fora um instante)
   * conta; FALHAS_RECONFERIR_MAX seguidos também encerram — sem saber, não fica aberta para sempre.
   */
  function reconferir(id: string): void {
    const s = sessoes.get(id);
    if (s?.assistir) {
      const geracao = s.geracao;
      s.assistir().then(
        (pode) => { s.falhasSeguidas = 0; if (!pode.ver) encerrar(id, FECHAMENTOS_VIVO.trocou, "a tela não está mais à vista"); else if (s.geracao === geracao) s.entrada = pode.mexer; },
        () => { if (s.geracao === geracao) s.entrada = false; if (++s.falhasSeguidas >= FALHAS_RECONFERIR_MAX) encerrar(id, FECHAMENTOS_VIVO.trocou, "a tela não está mais à vista"); },
      );
      return;
    }
    if (!s?.conferir) return;
    s.conferir().then(
      (pode) => { s.falhasSeguidas = 0; if (!pode) encerrar(id, FECHAMENTOS_VIVO.trocou, "o controle mudou"); },
      () => { if (++s.falhasSeguidas >= FALHAS_RECONFERIR_MAX) encerrar(id, FECHAMENTOS_VIVO.trocou, "o controle mudou"); },
    );
  }

  return {
    /**
     * A web pediu: nasce a sessão, com o lado dela já ligado, e o token que o motor vai trazer de volta. `conferir`
     * diz se a pessoa segue no controle; roda no pareamento e de RECONFERIR_VIVO_MS em RECONFERIR_VIVO_MS.
     */
    abrir(p: { escopo: Escopo; agenteId: string; web: LadoVivo; conferir?: () => Promise<boolean>; assistir?: () => Promise<PodeAssistir> }): { sessao: string; token: string } {
      // Card D: quem assiste e quem controla contam à parte (a sessão de controle antiga não derruba a de assistir).
      const daTela = [...sessoes.entries()].filter(([, s]) => s.agenteId === p.agenteId && mesmaPessoa(s.escopo, p.escopo) && Boolean(s.assistir) === Boolean(p.assistir));
      for (const [id] of daTela.slice(0, Math.max(0, daTela.length - VIVO_POR_TELA + 1))) encerrar(id, FECHAMENTOS_VIVO.trocou, "outra janela abriu a tela");
      const sessao = randomBytes(16).toString("hex");
      const token = randomBytes(32).toString("base64url");
      const prazo = setTimeout(() => { if (!sessoes.get(sessao)?.motor) encerrar(sessao, FECHAMENTOS_VIVO.sem_maquina, "a máquina não chegou"); }, o.prazoParMs ?? PRAZO_PAR_MS);
      prazo.unref?.();
      sessoes.set(sessao, { escopo: p.escopo, agenteId: p.agenteId, token, web: p.web, motor: null, prazo, ...(p.assistir ? { assistir: p.assistir } : p.conferir ? { conferir: p.conferir } : {}), vigia: null, falhasSeguidas: 0, entrada: !p.assistir, geracao: 0 });
      p.web.aoFechar(() => encerrar(sessao, 1000));
      return { sessao, token };
    },
    /**
     * O motor chegou com o id e o token. Confere o token em tempo constante; sessão desconhecida, já pareada ou token
     * errado: false (quem chamou fecha o socket). Pareada, os bytes passam a correr nos dois sentidos.
     */
    anexarMotor(sessao: string, token: string, motor: LadoVivo): boolean {
      const s = sessoes.get(sessao);
      if (!s || s.motor) return false;
      const a = Buffer.from(token);
      const b = Buffer.from(s.token);
      if (a.length !== b.length || !timingSafeEqual(a, b)) { log("aviso", "computador_vivo_token_errado", { sessao }); return false; }
      s.motor = motor;
      clearTimeout(s.prazo);
      motor.aoDados((bytes) => s.web.enviar(bytes));
      if (s.assistir) {
        const filtro = criarFiltroRfb();
        s.web.aoDados((bytes) => {
          const r = filtro(bytes, s.entrada);
          if ("erro" in r) { log("aviso", "computador_vivo_fluxo_recusado", { sessao, erro: r.erro }); encerrar(sessao, FECHAMENTOS_VIVO.recusado, "fluxo desconhecido"); return; }
          if (r.passa.length) motor.enviar(r.passa);
        });
      } else s.web.aoDados((bytes) => motor.enviar(bytes));
      motor.aoFechar(() => encerrar(sessao, 1000));
      if (s.conferir || s.assistir) {
        reconferir(sessao);
        s.vigia = setInterval(() => reconferir(sessao), o.reconferirMs ?? RECONFERIR_VIVO_MS);
        s.vigia.unref?.();
      }
      return true;
    },
    /** A sessão não vai acontecer (o comando ao motor falhou): a web fica sabendo o porquê. */
    recusar(sessao: string, motivo: string): void {
      encerrar(sessao, FECHAMENTOS_VIVO.recusado, motivo);
    },
    /** O controle saiu da pessoa (Parar, devolver, tela fechada): toda sessão ao vivo desta tela acaba. */
    fecharDaTela(escopo: Escopo, agenteId: string): void {
      for (const [id, s] of sessoes) {
        if (s.agenteId !== agenteId || !mesmaPessoa(s.escopo, escopo)) continue;
        // Card D: quem assiste continua vendo; só perde teclado e mouse.
        if (s.assistir) { s.entrada = false; s.geracao++; }
        else encerrar(id, FECHAMENTOS_VIVO.trocou, "o controle mudou");
      }
    },
    /** Card D, F4: a pessoa assumiu; as sessões de assistir desta tela passam teclado e mouse na hora. */
    liberarDaTela(escopo: Escopo, agenteId: string): void {
      for (const s of sessoes.values()) if (s.assistir && s.agenteId === agenteId && mesmaPessoa(s.escopo, escopo)) { s.entrada = true; s.geracao++; }
    },
    /** Só testes. */
    abertas: () => [...sessoes.entries()].map(([sessao, s]) => ({ sessao, agenteId: s.agenteId, pareada: s.motor !== null, ...(s.assistir ? { entrada: s.entrada } : {}) })),
  };
}
