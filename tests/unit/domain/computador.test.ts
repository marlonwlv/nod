import { expect, it } from "vitest";
import { alteraComputador, resumoAcaoComputador, validarAcaoComputador } from "../../../src/domain/computador.ts";
const quadro = "a".repeat(64);
it("valida controle nativo, atalhos, áudio e operações de arquivo", () => {
  expect(validarAcaoComputador({tipo:"arrastar",x:1,y:2,destinoX:100,destinoY:200,quadro})).toMatchObject({tipo:"arrastar",destinoX:100});
  expect(validarAcaoComputador({tipo:"tecla",tecla:"Control+Shift+F12",quadro})).toMatchObject({tecla:"Control+Shift+F12"});
  expect(validarAcaoComputador({tipo:"ler_arquivo",caminho:"/workspace/a.txt"})).toEqual({tipo:"ler_arquivo",caminho:"a.txt"});
  expect(alteraComputador({tipo:"tecla",tecla:"Enter",quadro})).toBe(true);
  expect(alteraComputador({tipo:"audio",segundos:5})).toBe(false);
  expect(validarAcaoComputador({tipo:"ler_texto",caminho:"/workspace/a.txt"})).toEqual({tipo:"ler_texto",caminho:"a.txt",inicio:0});
  expect(alteraComputador({tipo:"ler_texto",caminho:"a.txt",inicio:0})).toBe(false);
  expect(alteraComputador({tipo:"gravar_texto",caminho:"a.txt",texto:"Olá",revisao:"novo"})).toBe(true);
});
it.each(["/etc/passwd","../outro","/workspacex/segredo","a/../../b","a\\b","a\0b"])("recusa caminho fora do workspace: %s", caminho => {
  expect(()=>validarAcaoComputador({tipo:"ler_arquivo",caminho})).toThrow("entrada_invalida");
});
it.each([
  {tipo:"clicar",x:-1,y:0,quadro}, {tipo:"clicar",x:1280,y:0,quadro}, {tipo:"clicar",x:1,y:2,quadro:"antigo"},
  {tipo:"audio",segundos:11}, {tipo:"navegar",url:"file:///etc/passwd"}, {tipo:"tecla",tecla:"Return;curl",quadro},
  {tipo:"ler_texto",caminho:"a.txt",inicio:1}, {tipo:"ler_texto",caminho:"a.txt",inicio:0.5},
  {tipo:"gravar_texto",caminho:"a.txt",texto:"novo",revisao:"inventada"},
])("falha fechado para comando malformado %j", valor => { expect(()=>validarAcaoComputador(valor)).toThrow("entrada_invalida"); });

it("valida o contrato semântico e separa leitura de efeito", () => {
  const acao = validarAcaoComputador({ tipo: "elementos", operacao: "preencher", observacao: quadro, papel: "button", nome: "Enviar", referencia: quadro, texto: "Olá" });
  expect(alteraComputador(acao)).toBe(true);
  expect(alteraComputador(validarAcaoComputador({ tipo: "elementos", operacao: "observar" }))).toBe(false);
  expect(alteraComputador(validarAcaoComputador({ tipo: "elementos", operacao: "verificar", papel: "status", condicao: "texto", texto: "Enviado" }))).toBe(false);
});
it.each([
  { operacao: "executarJS", papel: "button" },
  { operacao: "clicar", observacao: "velha", papel: "button", nome: "Enviar", referencia: quadro },
  { operacao: "preencher", observacao: quadro, papel: "button", nome: "Enviar", referencia: quadro },
  { operacao: "esperar", papel: "button", condicao: "visivel", timeoutMs: 10001 },
  { operacao: "verificar", papel: "status", condicao: "texto" },
  { operacao: "localizar", papel: "button;script" },
])("recusa pedido semântico inválido %j", a => {
  expect(() => validarAcaoComputador({ tipo: "elementos", ...a })).toThrow("entrada_invalida");
});

it("aprovação semântica informa operação e texto que será preenchido", () => {
  const alvo = { tipo: "elementos" as const, observacao: quadro, papel: "button", nome: "Enviar", referencia: quadro };
  expect(resumoAcaoComputador({ ...alvo, operacao: "clicar" })).toContain('Clicar em button "Enviar"');
  expect(resumoAcaoComputador({ ...alvo, operacao: "preencher", texto: "Mensagem da fixture" })).toContain("Mensagem da fixture");
});
