import type { ChaveMaquinaDto } from "../contracts/api.ts";
import type { PapelMaquina, PlataformaMaquina } from "../contracts/ponte.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms, msOuNull } from "./conversao.ts";

interface Linha {
  id: string;
  nome: string;
  prefixo: string;
  criado_em: Date;
  ultimo_uso_em: Date | null;
  revogado_em: Date | null;
  papel: PapelMaquina;
}

/** definido em 2026-10-20 (NOD-293 A8): `ultimo_uso_em` atrasa até isto; a tela mostra o uso em minutos. */
export const MARCAR_USO_A_CADA_MS = 30_000;

const paraDto = (l: Linha): ChaveMaquinaDto => ({ id: l.id, nome: l.nome, prefixo: l.prefixo, criadaEm: ms(l.criado_em), ultimoUsoEm: msOuNull(l.ultimo_uso_em), revogadaEm: msOuNull(l.revogado_em), papel: l.papel });

/**
 * Chaves de máquina da pessoa (ADR-031). Guarda só o hash; NENHUM método devolve o hash para fora
 * do repositório exceto `buscarVivaPorHash`, que existe só para a comparação em tempo constante.
 * Sob RLS a pessoa só vê as próprias (owner_id), e o WHERE repete isso (segunda camada, ADR-003).
 */
export function maquinaTokensRepo(conn: Conn, escopo: Escopo) {
  return {
    /** NOD-94: `papel` ausente = `motor`. O índice `maquina_tokens_um_computador` recusa (23505) o 2º só-computador vivo. */
    async criar(e: { nome: string; prefixo: string; hash: Buffer; papel?: PapelMaquina }): Promise<ChaveMaquinaDto | null> {
      const [l] = await conn<Linha[]>`
        insert into maquina_tokens (tenant_id, owner_id, nome, prefixo, hash, papel)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${e.nome}, ${e.prefixo}, ${e.hash}, ${e.papel ?? "motor"})
        returning id, nome, prefixo, criado_em, ultimo_uso_em, revogado_em, papel`;
      return l ? paraDto(l) : null;
    },

    /**
     * NOD-94 (0105): a máquina só-computador viva da pessoa, depois de revogar (na data em que venceu) a que venceu sem
     * confirmação — ela ainda seguraria a vaga do índice único. null = a vaga está livre.
     */
    async computadorVivo(agora: number): Promise<{ id: string; nome: string } | null> {
      await conn`update maquina_tokens set revogado_em = expira_em
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and papel = 'computador' and revogado_em is null and expira_em <= ${data(agora)}`;
      const [l] = await conn<{ id: string; nome: string }[]>`select id, nome from maquina_tokens
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and papel = 'computador' and revogado_em is null`;
      return l ?? null;
    },

    async listar(): Promise<ChaveMaquinaDto[]> {
      // ADR-102 (revisão do PR #306): a chave que venceu (o "Desconectar" sem confirmação) conta como cancelada na data
      // em que venceu — a tela, a escolha de máquina dos bots e as contas a veem como as revogadas.
      const linhas = await conn<Linha[]>`
        select id, nome, prefixo, criado_em, ultimo_uso_em, papel,
          coalesce(revogado_em, case when expira_em <= now() then expira_em end) as revogado_em
        from maquina_tokens
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
        order by criado_em desc`;
      return linhas.map(paraDto);
    },

    /**
     * NOD-89 (corte 1): as chaves vivas (não revogadas e não vencidas) com o sistema que cada máquina anunciou — a linha
     * "Roda em" da rotina. Mesma ordem e mesmo filtro por dona do `listar()`.
     * NOD-94 (emenda 11 da ADR-090): sem a só-computador — ela nunca pega turno, então não segura o "qualquer máquina".
     */
    async vivasComPlataforma(): Promise<{ id: string; nome: string; plataforma: PlataformaMaquina | null }[]> {
      return conn<{ id: string; nome: string; plataforma: PlataformaMaquina | null }[]>`
        select id, nome, plataforma from maquina_tokens
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
          and revogado_em is null and (expira_em is null or expira_em > now()) and papel = 'motor'
        order by criado_em desc`.then((ls) => ls.map((l) => ({ id: l.id, nome: l.nome, plataforma: l.plataforma ?? null })));
    },

    /**
     * definido em 2026-11-25: a pessoa tem uma máquina Linux viva (motor, só-computador ou na nuvem), o único lugar onde o
     * computador do bot roda agora (COMPUTADOR_NO_MAC, src/domain/computador-canal.ts). Conta mesmo desconectada: o
     * computador dela fica "fora do ar" e volta quando a máquina volta, em vez de sumir da tela.
     */
    async temLinuxViva(): Promise<boolean> {
      const [l] = await conn<{ tem: boolean }[]>`
        select exists (select 1 from maquina_tokens
          where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and plataforma = 'linux'
            and revogado_em is null and (expira_em is null or expira_em > now())) as tem`;
      return l?.tem === true;
    },

    /** Revogar é idempotente: a primeira data fica. false = a chave não existe (ou é de outra pessoa). */
    async revogar(id: string, agora: number): Promise<boolean> {
      const linhas = await conn`
        update maquina_tokens set revogado_em = coalesce(revogado_em, ${data(agora)})
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
        returning id`;
      return linhas.length > 0;
    },

    /**
     * ADR-102 (revisão do PR #306): a chave passa a vencer em `ate` (ou antes, se já vencia antes). É o "Desconectar e
     * sair das contas": a máquina tem até lá para sair das contas e confirmar; sem confirmação, a chave cai sozinha —
     * gravado no banco, sobrevive a um reinício do servidor.
     */
    async vencerEm(id: string, ate: number): Promise<boolean> {
      const r = await conn`update maquina_tokens set expira_em = least(coalesce(expira_em, ${data(ate)}), ${data(ate)})
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and revogado_em is null returning id`;
      return r.length > 0;
    },

    async buscarVivaPorHash(hash: Buffer, agora: number): Promise<{ id: string; hash: Buffer } | null> {
      const [l] = await conn<{ id: string; hash: Buffer }[]>`
        select id, hash from maquina_tokens
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and hash = ${hash}
          and revogado_em is null and (expira_em is null or expira_em > ${data(agora)})`;
      return l ?? null;
    },

    /**
     * ADR-090 (0067): o sistema que a máquina anunciou ao se conectar. Só escreve quando muda; true = mudou (a primeira
     * conexão da máquina, ADR-190 N: a primeira máquina sempre ligada avisa os bots).
     */
    async registrarPlataforma(id: string, plataforma: PlataformaMaquina): Promise<boolean> {
      const r = await conn`update maquina_tokens set plataforma = ${plataforma}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and plataforma is distinct from ${plataforma} returning id`;
      return r.length > 0;
    },

    /**
     * Nome e sistema de uma chave, revogada ou não (o aviso de uma queda antiga ainda a nomeia). null = não é chave da
     * pessoa — no modo local, o Mac que roda o servidor não tem chave.
     */
    async identificar(id: string): Promise<{ nome: string; plataforma: PlataformaMaquina | null; papel: PapelMaquina; ultimoUsoEm: number | null } | null> {
      const [l] = await conn<{ nome: string; plataforma: PlataformaMaquina | null; papel: PapelMaquina; ultimo_uso_em: Date | null }[]>`
        select nome, plataforma, papel, ultimo_uso_em from maquina_tokens where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      // NOD-365: o último uso gravado é o "sem contato desde" que sobrevive à ponte esquecer a conexão (90 s) e ao reinício.
      return l ? { nome: l.nome, plataforma: l.plataforma, papel: l.papel, ultimoUsoEm: l.ultimo_uso_em?.getTime() ?? null } : null;
    },

    /**
     * NOD-293 A7: a chave existe e não vale mais — revogada, ou vencida em `agora` (o "Desconectar" sem confirmação, como
     * em `listar`). A mesma régua da chave viva de alvo-da-maquina.ts. false = viva ou não é chave da pessoa (o Mac do
     * modo local não tem chave).
     */
    async removida(id: string, agora: number): Promise<boolean> {
      const [l] = await conn<{ removida: boolean }[]>`
        select (revogado_em is not null or (expira_em is not null and expira_em <= ${data(agora)})) as removida
        from maquina_tokens where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return l?.removida === true;
    },

    /** ADR-102 (R2): o nome que a pessoa deu à máquina; a tela e as notas usam este, não o hostname anunciado. */
    async renomear(id: string, nome: string): Promise<boolean> {
      const r = await conn`update maquina_tokens set nome = ${nome} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and revogado_em is null returning id`;
      return r.length > 0;
    },

    /**
     * definido em 2026-10-20 (NOD-293 A8): grava o uso no máximo uma vez a cada MARCAR_USO_A_CADA_MS. Cada pedido da
     * máquina (puxar, renovar, entregar) passava aqui e fazia um UPDATE; quem lê `ultimo_uso_em` (a lista de chaves) tolera
     * esse atraso. true = gravou.
     */
    async marcarUso(id: string, agora: number): Promise<boolean> {
      const r = await conn`update maquina_tokens set ultimo_uso_em = ${data(agora)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
          and (ultimo_uso_em is null or ultimo_uso_em < ${data(agora - MARCAR_USO_A_CADA_MS)}) returning id`;
      return r.length > 0;
    },

    /**
     * definido em 2026-11-24 (sucessão de chave): o mesmo computador pareou de novo e ganhou a chave `para`; tudo o que
     * apontava para a chave `de` passa a apontar para ela, ANTES de `de` ser revogada. Sem isto os bots presos a `de`
     * (`agentes.maquina_id`) e as sessões do CLI nascidas nela (`trabalhos`/`conversas.sessao_maquina_id`, o nível da
     * sessão em alvo-da-maquina.ts) esperavam "sem contato" uma chave que ninguém mais usa — com o computador ligado e
     * puxando com a nova. Medido em produção em 24/11: o Dev Local e o Mr Mime presos assim; o Comunidade Nod desde 16/11.
     * A sessão segue retomável: é o mesmo computador, as pastas das contas são as mesmas. Só da dona (filtro por owner).
     * Devolve os bots que mudaram (o chamador avisa a tela).
     */
    async transferirReferencias(de: string, para: string): Promise<{ bots: string[]; padrao: boolean; sessoes: number; turnos: number; navegador: number }> {
      const dono = conn`tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
      const bots = await conn<{ id: string }[]>`update agentes set maquina_id = ${para} where ${dono} and maquina_id = ${de} returning id`;
      const padrao = await conn`update preferencias set maquina_padrao_id = ${para} where ${dono} and maquina_padrao_id = ${de} returning 1`;
      // sessao_maquina_id é text (0079): compara pelo texto.
      const trabalhos = await conn`update trabalhos set sessao_maquina_id = ${para} where ${dono} and sessao_maquina_id = ${de} returning 1`;
      const conversas = await conn`update conversas set sessao_maquina_id = ${para} where ${dono} and sessao_maquina_id = ${de} returning 1`;
      // O "desta vez" só importa no turno que ainda vai sair; o histórico fica como foi.
      const turnos = await conn`update turnos set maquina_desta_vez = ${para} where ${dono} and maquina_desta_vez = ${de} and estado = 'pendente' returning 1`;
      // ADR-190: o navegador escolhido nesta máquina segue nela (senão o revogar o devolveria ao nod com aviso).
      const navegador = await conn`update navegador_preferencias set maquina_id = ${para} where ${dono} and maquina_id = ${de} returning 1`;
      return { bots: bots.map((b) => b.id), padrao: padrao.length > 0, sessoes: trabalhos.length + conversas.length, turnos: turnos.length, navegador: navegador.length };
    },
  };
}
