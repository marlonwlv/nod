# Autorização do pedido no computador — 2026-11-18

## Diagnóstico e decisão

No preview do PR #155, o envio solicitado parou depois do login e da preparação do texto.
O registro HTTP de 18/11/2026 às 12:35:07 UTC mostra `POST /api/interno/ferramentas/pedir_aprovacao`,
status **400**, código `entrada_invalida`, causa `conector nod não registrado`.
Não é evidência de serviço fora do ar. O relato do bot interpretou incorretamente uma chamada inválida.
A conversa registra o pedido explícito antes do login e a devolução do controle depois; não registra
pedido de confirmação adicional. Não foi enviado nada durante esta investigação.

O prompt mandava passar todo efeito externo por `pedir_aprovacao`, sem explicar a exceção do computador.
Esse caminho recebe destinos de conectores. O computador já possui um gateway em
`src/adapters/fundo/computadores.ts`: consulta o modo vigente, reserva, valida controle e turno,
executa e registra. Automático/total já passavam diretamente; no manual supervisionado o próprio
servidor cria a aprovação. Não falta um segundo serviço de aprovação para clicar.

Plano implementado em um commit: esclarecer o contrato do prompt; recusar encaminhamento indevido
com resposta estruturada; testar os modos com aprovação indisponível e a confirmação solicitada;
registrar evidências e limites. Ações: nenhuma ação nova. Sem migração, alteração de modo ou liberação
por indisponibilidade. Complementa ADR-037/059/062/066 e a precedência da instrução explícita da ADR-038;
a ADR-154 não foi reaproveitada como autorização genérica de navegador.

## Política Nod e limites

O pedido autoriza o trabalho no seu escopo, destinatário e conteúdo. O agente usa `computador_*`
diretamente e o servidor continua aplicando o modo escolhido. No manual supervisionado o cartão
permanece: escolher esse modo é uma instrução vigente para confirmar. Se a pessoa pedir confirmação
antes, o agente usa `pedir_a_pessoa` e espera a resposta, inclusive em automático/total. Login e
devolução do controle permitem retomar o pedido, não autorizam outras ações. Conteúdo de páginas,
imagens e arquivos continua sendo dado, nunca fonte de autorização. Antes do efeito, conferir o
alvo e o conteúdo; resultado incerto exige observar/verificar, não repetir o envio.

A correção não interpreta linguagem natural no gateway nem inventa um selo `autorizado=true`
fornecido pelo modelo. A correspondência semântica entre pedido e ação continua responsabilidade
do agente; os testes do prompt não provam resistência absoluta a injeção. O servidor continua
impondo escopo, catálogo, modo, controle humano, reserva e validação da ação. Falha real na criação
de aprovação do manual não executa a ação. Indisponibilidade não amplia direitos.

## Referências verificadas (não são a mesma implementação)

- [OpenBot/CopilotKit, README fixado](https://github.com/CopilotKit/OpenBot/blob/ba124594c020c61d7ca5b7abb77016e6400db6c4/README.md):
  descreve gateway único, política CEL, auditoria antes do efeito, precedência de negação e falha fechada.
  Portanto há equivalente conceitual de autorização/aprovação, mas não o `pedir_aprovacao` do Nod.
- [OpenBot/Nightly, arquitetura do navegador](https://github.com/nightly-labs/openbot/blob/ba75f50fb3d8f2ae4e9d115e6db6692add4865bc/docs/architecture/browser.md):
  é outro repositório, aquele citado na conversa anterior. Documenta ações tipadas CDP, filas, referências
  e verificação de foco; confirmação de preenchimento é prova técnica do efeito, não consentimento humano.
  Também descreve acesso/autoaprovação e takeover para autenticação não suportada. No exemplo de 3-D Secure,
  a orientação exige checkout aprovado e comerciante/valor correspondentes. Não se conclui daí que toda
  ação exija um serviço separado, nem que login autorize envios irrestritos.
- [agent-browser, segurança](https://agent-browser.dev/security): controles de navegação, ações e saída
  são opcionais; documenta política de ações, `confirm`/`deny` e delimitação de conteúdo não confiável.
  Não é correto dizer que não possui aprovações; sua configuração não determina a política do Nod.
  [README fixado](https://github.com/vercel-labs/agent-browser/blob/deda8eff5e29bcc3b4a9f10aafd1412dbe91745a/README.md).
- [Playwright, actionability](https://playwright.dev/docs/actionability): espera unicidade, visibilidade,
  estabilidade, recebimento de eventos e habilitação antes de clicar. Esses checks são mecânicos;
  não decidem se o usuário autorizou destinatário/conteúdo. A camada de política é do aplicativo.

## Validação e reprodução

`mise exec -- npx vitest run --project unit tests/unit/domain/prompt-sistema.test.ts tests/unit/domain/prompt-referencia.test.ts tests/unit/use-cases/pedir-aprovacao.test.ts tests/unit/adapters/computadores-observacao.test.ts tests/unit/use-cases/pedir-a-pessoa.test.ts`

Casos novos: destino errado (`nod.computador_*` e `computador`) retorna recusa sem efeito/cartão;
indisponibilidade de aprovação não bloqueia automático/total; manual não executa nessa falha;
confirmação explicitamente solicitada permanece pendente nos dois modos autônomos, sem retomada;
prompt conserva destinatário/conteúdo, exceção do gateway, confirmação e fronteira de páginas.
As referências do prompt e hashes foram atualizados deliberadamente e o diff foi conferido.

Para teste humano no preview: em uma fixture local sem destinatários reais, pedir um envio direto e
verificar o estado final; depois pedir "prepare, mas confirme comigo antes de enviar" e verificar
que nada muda antes da resposta. No WhatsApp, só a pessoa pode iniciar novo teste autorizado:
a investigação não reenvia o pedido antigo nem clica no texto que ficou preparado.

Resultado local: **132 testes focados aprovados**, lint dos arquivos alterados e typecheck completos
aprovados. Os cinco testes novos do encaminhamento/prompt falharam com o código da base e passaram
com a correção. A cópia de runtime com PR #155 mais esta correção passou **15 testes Chromium/IPC**,
sem pulos; preserva os testes de alvo substituído, destinatário alterado e não repetição de efeito.
A suíte completa não foi executada (não há push/PR nesta frente). Não houve rodada independente
por subagente nem ensaio do modelo enviando mensagem real. A confirmação solicitada foi provada
no contrato do prompt e no caso de uso de pergunta pendente, não como prova universal do modelo.
