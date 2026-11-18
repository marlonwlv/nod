# Navegação por elementos

## Plano e decisões

1. `feat(computador): contrato de navegação por elementos`: contrato independente do motor, ferramenta do bot e validação fechada. Ações: nenhuma ação nova de pessoa; reusa o gateway de computador existente, inclusive reserva, aprovação e controle humano.
2. `feat(computador): adaptador Playwright nos dois runtimes`: observar/localizar por papel e nome acessível, referências opacas, clicar/preencher, esperar/verificar. Docker e supervisor recebem a mesma ação pelo executor atual. Sem seletores arbitrários ou JavaScript fornecido pelo modelo.
3. `test(computador): provar navegação e recuperação`: navegador real sobre fixture controlada, alvos substituídos, ambiguidade, concorrência, perda de resposta e retomada. Testes do gateway e regressões dos dois transportes, tipos e check.

O PR #153 já está integrado: corrigiu retomada/IPC, não implementou este contrato. A base examinada tem Docker e motor/supervisor, sem adaptador Orgo. Não será anunciado suporte Orgo sem implementação e teste.

Reuso deliberado: perfil persistente, isolamento, transporte, reservas e controle humano (ADRs 037, 122 e 138). Reconstrução: observação e interação de navegador, num adaptador comum independente de pixels. O visual fica explícito em `computador_observar`/`computador_interagir`, para canvas, desktop e controles sem semântica. Não há migração de dados, cópia de perfil ou nova coleta de senha.

Referências pertencem à observação, página e revisão da sessão. Antes de agir, o adaptador confere unicidade, identidade DOM e semântica do alvo; papel e nome enviados no pedido devem coincidir com a observação e tornam a aprovação legível; substituição exige observar novamente. Uma referência é consumida antes do efeito. Não há retry automático de clique/preenchimento após falha; queda exige observar e verificar o resultado externo. A reserva do gateway e a exclusão/fila dos runtimes abrangem caminhos visual e semântico.

Riscos: sites sem acessibilidade exigem alternativa visual; DOM pode mudar entre validação e evento (não há transação num site externo). Nenhum texto de página autoriza ações. Campos de senha não são expostos/preenchidos; login manual usa o handoff existente. Esperar condição não prova resultado de negócio: o bot deve verificar o estado esperado explicitamente.

## Evidências

A preencher com os resultados efetivamente executados. WhatsApp só será examinado se existir sessão autorizada disponível; envio externo depende de destinatário e conteúdo explicitamente autorizados. A fixture local cobre envio sem terceiros.

## Próxima etapa: autenticação

Requisito registrado, sem implementar nesta entrega: login uma vez reutilizável entre bots autorizados; formulário protegido no chat, com opção de cofre, mantendo senha fora do modelo, histórico, logs e observações. O adaptador recebe uma página da sessão existente, não gerencia credenciais; uma futura política de sessão/autenticação pode fornecer a página sem mudar o contrato de navegação.
