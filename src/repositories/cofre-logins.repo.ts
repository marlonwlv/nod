import type { EpochMs } from "../contracts/ids.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { ms } from "./conversao.ts";

/**
 * O cofre do nod (0180, ADR-190 decisão 6): logins da pessoa para o navegador do bot. A senha entra e sai CIFRADA
 * (`cifrar` do servidor); o repositório nunca vê o texto em claro e a listagem nunca leva a senha. Só a dona lê.
 */
export type LoginDoCofre = { id: string; site: string; usuario: string; criadoEm: EpochMs };

/** O formato do `cifrar` (v1:iv:tag:dados); o CHECK da 0180 confere o mesmo. */
const CIFRADO = /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

type Linha = { id: string; site: string; usuario: string; criado_em: Date };
const login = (l: Linha): LoginDoCofre => ({ id: l.id, site: l.site, usuario: l.usuario, criadoEm: ms(l.criado_em) });

export function cofreLoginsRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(p: { site: string; usuario: string; senhaCifrada: string }): Promise<LoginDoCofre> {
      if (!CIFRADO.test(p.senhaCifrada)) throw new ErroDeDominio("entrada_invalida", { cause: "senha do cofre sem cifra" });
      const [l] = await conn<Linha[]>`
        insert into cofre_logins (tenant_id, owner_id, site, usuario, senha_cifrada)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${p.site.trim().toLowerCase()}, ${p.usuario}, ${p.senhaCifrada})
        returning id, site, usuario, criado_em`;
      return login(l!);
    },

    async listar(): Promise<LoginDoCofre[]> {
      const linhas = await conn<Linha[]>`
        select id, site, usuario, criado_em from cofre_logins
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} order by site, criado_em`;
      return linhas.map(login);
    },

    /** Os logins do site (o host exato, sem o "www."). */
    async doSite(site: string): Promise<LoginDoCofre[]> {
      const s = site.trim().toLowerCase().replace(/^www\./, "");
      const linhas = await conn<Linha[]>`
        select id, site, usuario, criado_em from cofre_logins
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and (site = ${s} or site = ${`www.${s}`}) order by criado_em`;
      return linhas.map(login);
    },

    /**
     * O login inteiro para preencher (ADR-190, L3): o site (o portão confere que casa com a aba), o usuário e a senha ainda
     * cifrada, que o servidor decifra na hora e esquece. null = não existe ou não é da pessoa.
     */
    async paraPreencher(id: string): Promise<{ site: string; usuario: string; senhaCifrada: string } | null> {
      const [l] = await conn<{ site: string; usuario: string; senha_cifrada: string }[]>`
        select site, usuario, senha_cifrada from cofre_logins where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return l ? { site: l.site, usuario: l.usuario, senhaCifrada: l.senha_cifrada } : null;
    },

    /** A senha ainda cifrada, para o servidor decifrar na hora de preencher o campo. */
    async senhaCifrada(id: string): Promise<string | null> {
      const [l] = await conn<{ senha_cifrada: string }[]>`
        select senha_cifrada from cofre_logins where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return l?.senha_cifrada ?? null;
    },

    async apagar(id: string): Promise<boolean> {
      const r = await conn`delete from cofre_logins where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count > 0;
    },
  };
}
