import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { cifrar, decifrar } from "../../src/db/cifra.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { mandarMensagemPadrao } from "../../src/adapters/fundo/navegadores.ts";
import { ANA, depsSobreTrx, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** ADR-190 (0180): preferências do navegador, tarefas ensinadas e o cofre do nod no Postgres, com a RLS separando as pessoas. */
const T0 = 1_795_000_000_000;

describeIntegracao("navegador do bot: repositórios (0180)", () => {
  it("preferências: sem linha não há liberação; gravar só o que veio; liberação torta cai fora; outra pessoa não vê", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, MARLON);
      expect(await repos.navegadorPreferencias.buscar(agenteId)).toBeNull();
      expect(await repos.navegadorPreferencias.liberacoes(agenteId)).toEqual({ pagar: [], enviar: [] });
      const p1 = await repos.navegadorPreferencias.gravar(agenteId, { continuaSemMac: true }, T0);
      expect(p1).toMatchObject({ agenteId, continuaSemMac: true, soNaMaquina: false, maquinaId: null, liberacoes: { pagar: [], enviar: [] }, atualizadoEm: T0 });
      const lib = { pagar: [{ host: "Loja.Exemplo.com", ateCentavos: 5000 }, { host: "", ateCentavos: 1 }, { host: "x.com", ateCentavos: -1 }], enviar: [{ host: "mail.exemplo.com", destino: "ana@exemplo.com" }] };
      const p2 = await repos.navegadorPreferencias.gravar(agenteId, { liberacoes: lib }, T0 + 1);
      expect(p2).toMatchObject({ continuaSemMac: true, liberacoes: { pagar: [{ host: "loja.exemplo.com", ateCentavos: 5000 }], enviar: [{ host: "mail.exemplo.com", destino: "ana@exemplo.com" }] } });
      expect((await repos.navegadorPreferencias.liberacoes(agenteId)).pagar).toHaveLength(1);
      await vincularEscopo(trx, ANA);
      const daAna = criarRepos(trx, ANA);
      expect(await daAna.navegadorPreferencias.buscar(agenteId)).toBeNull();
      // O bot é do Marlon: a Ana não grava preferência nele (o insert sai do bot dela, que não existe).
      expect(await daAna.navegadorPreferencias.gravar(agenteId, { continuaSemMac: false }, T0 + 2)).toBeNull();
      await vincularEscopo(trx, MARLON);
      expect((await repos.navegadorPreferencias.buscar(agenteId))?.continuaSemMac).toBe(true);
    });
  });

  it("tarefas: a mais nova primeiro, nome aparado, mais de 200 passos recusado pelo CHECK", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, MARLON);
      const t1 = await repos.navegadorTarefas.criar({ agenteId, nome: "  Baixar a fatura  ", passos: ["Abriu itau.com.br", 'Clicou em "Faturas"'] });
      expect(t1).toMatchObject({ nome: "Baixar a fatura", passos: ["Abriu itau.com.br", 'Clicou em "Faturas"'] });
      await trx`select pg_sleep(0.002)`;
      const t2 = await repos.navegadorTarefas.criar({ agenteId, nome: "Outra", passos: [] });
      expect((await repos.navegadorTarefas.doAgente(agenteId)).map((t) => t.id)).toEqual([t2!.id, t1!.id]);
      await vincularEscopo(trx, ANA);
      expect(await criarRepos(trx, ANA).navegadorTarefas.doAgente(agenteId)).toEqual([]);
      expect(await criarRepos(trx, ANA).navegadorTarefas.criar({ agenteId, nome: "Da Ana", passos: [] })).toBeNull();
      await vincularEscopo(trx, MARLON);
      await expect(trx.savepoint((sp) => criarRepos(sp, MARLON).navegadorTarefas.criar({ agenteId, nome: "Grande", passos: Array.from({ length: 201 }, (_, i) => `passo ${i}`) }))).rejects.toThrow(/navegador_tarefas_passos/);
    });
  });

  it("tarefas: apagar (Habilidades) só a da dona, do bot certo; a outra pessoa apaga zero", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, MARLON);
      const t = await repos.navegadorTarefas.criar({ agenteId, nome: "Baixar a fatura", passos: ["Abriu itau.com.br"] });
      await vincularEscopo(trx, ANA);
      expect(await criarRepos(trx, ANA).navegadorTarefas.apagar(agenteId, t!.id)).toBe(false);
      await vincularEscopo(trx, MARLON);
      expect(await repos.navegadorTarefas.apagar(randomUUID(), t!.id)).toBe(false);
      expect(await repos.navegadorTarefas.apagar(agenteId, t!.id)).toBe(true);
      expect(await repos.navegadorTarefas.doAgente(agenteId)).toEqual([]);
      expect(await repos.navegadorTarefas.apagar(agenteId, t!.id)).toBe(false);
    });
  });

  it("cofre: a senha só entra cifrada e volta cifrada; a listagem não a leva; outra pessoa não lê", async () => {
    await withRollback(MARLON, async (trx) => {
      const repos = criarRepos(trx, MARLON);
      const chave = randomBytes(32);
      const login = await repos.cofreLogins.criar({ site: "WWW.Itau.com.br", usuario: "marlon", senhaCifrada: cifrar("s3nh4-forte", chave) });
      expect(login).toMatchObject({ site: "www.itau.com.br", usuario: "marlon" });
      expect(JSON.stringify(await repos.cofreLogins.listar())).not.toContain("senha");
      expect((await repos.cofreLogins.doSite("itau.com.br")).map((l) => l.id)).toEqual([login.id]);
      const cifrada = await repos.cofreLogins.senhaCifrada(login.id);
      expect(cifrada).not.toContain("s3nh4");
      expect(decifrar(cifrada!, chave)).toBe("s3nh4-forte");
      // L3: o login inteiro para preencher (site e usuário em claro; a senha ainda cifrada).
      const preencher = await repos.cofreLogins.paraPreencher(login.id);
      expect(preencher).toMatchObject({ site: "www.itau.com.br", usuario: "marlon" });
      expect(decifrar(preencher!.senhaCifrada, chave)).toBe("s3nh4-forte");
      // Em claro não grava: nem pelo repositório, nem por fora dele (o CHECK da 0180).
      await expect(repos.cofreLogins.criar({ site: "x.com", usuario: "a", senhaCifrada: "minha-senha" })).rejects.toThrow("entrada_invalida");
      await expect(trx.savepoint((sp) => sp`insert into cofre_logins (tenant_id, owner_id, site, usuario, senha_cifrada) values (${MARLON.tenantId}, ${MARLON.pessoaId}, 'x.com', 'a', 'minha-senha')`)).rejects.toThrow(/cofre_logins_senha_cifrada/);
      await vincularEscopo(trx, ANA);
      const daAna = criarRepos(trx, ANA);
      expect(await daAna.cofreLogins.listar()).toEqual([]);
      expect(await daAna.cofreLogins.senhaCifrada(login.id)).toBeNull();
      expect(await daAna.cofreLogins.paraPreencher(login.id)).toBeNull();
      expect(await daAna.cofreLogins.apagar(login.id)).toBe(false);
      await vincularEscopo(trx, MARLON);
      expect(await repos.cofreLogins.apagar(login.id)).toBe(true);
      expect(await repos.cofreLogins.listar()).toEqual([]);
    });
  });
});

describeIntegracao("navegador do bot: Ensinar manda a mensagem da pessoa (T3)", () => {
  it("'Ensinei: <nome>.' com passos-gravados.txt anexado entra na conversa do bot como da pessoa e enfileira o turno", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const d = depsSobreTrx(trx, MARLON);
      await mandarMensagemPadrao(d, { agenteId, texto: "Ensinei: Baixar a fatura.", arquivo: { nome: "passos-gravados.txt", conteudo: "Tarefa ensinada: Baixar a fatura\n\n1. Abriu itau.com.br" } });
      const mensagens = await d.repos.mensagens.listarDaConversa(conversaId);
      const minha = mensagens.find((m) => m.texto === "Ensinei: Baixar a fatura.");
      expect(minha?.autoria).toMatchObject({ autor_tipo: "pessoa", autor_id: MARLON.pessoaId });
      const anexos = (await d.repos.anexos.daMensagens([minha!.id])).get(minha!.id) ?? [];
      expect(anexos).toMatchObject([{ nome: "passos-gravados.txt", mime: "text/plain" }]);
      // O turno nasce da mensagem com o anexo na entrada (aqui, sem IA no banco de teste, ele nasce interrompido; o que
      // importa é que é o turno normal da fala da pessoa).
      const [turno] = await trx<{ entrada_anexos: string[] }[]>`select entrada_anexos from turnos where mensagem_origem_id = ${minha!.id}`;
      expect(turno?.entrada_anexos).toEqual([anexos[0]!.id]);
    });
  });
});
