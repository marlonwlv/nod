# Integração do preview — 2026-11-18

## Origens

Branch criada a partir de `origin/preview/grokbot` em `e7a538af`, incorporando por merge
`122463de11e2a2b056bc0f000ffcca5f8fe35136` (trabalho do PR #164). Esse commit inclui
`db0e4391` e a otimização `da4b4848`. A integração preserva os recursos exclusivos do
preview, incluindo a interface React, os controles de aprovação e os provedores de computador.
Não houve nova otimização, atualização do preview, merge em main ou deploy nesta validação.

## Teste real anterior à integração

O preview respondeu saúde positiva. A árvore de código da aplicação coincide com `db0e4391`;
o processo servidor iniciou depois dos arquivos de `src`. No computador Docker, os hashes
SHA-256 de `runtime.mjs`, `navegador.mjs` e `selecao-x.mjs` coincidem com o trabalho otimizado
`122463de`. O processo `node runtime.mjs` iniciou às 14:27:59 UTC, depois dos arquivos da
imagem (14:26:32 UTC), confirmando que a otimização já estava carregada, não apenas no disco.
Nenhum desses processos foi reiniciado por esta tarefa.

Pela interface pública: abrir tela, assumir controle, abrir aba pelo teclado remoto e devolver
controle passaram, sem erro JavaScript. Pela API autenticada do mesmo preview: abrir Amazon,
observar elementos, clicar no campo de busca, digitar `mouse sem fio`, executar a busca,
abrir um produto e capturar sua página passaram. O controle terminou devolvido ao bot.
A aba anterior permaneceu aberta. Não houve compra, envio de mensagem externa, mudança de conta,
remoção de perfil, volume ou sessão. O WhatsApp não foi acessado nem alterado; sua autenticação
não foi testada. As capturas e registros privados ficaram fora do repositório público.

Limitações observadas: o turno pelo chat foi interrompido pelo limite de uso do provedor de IA,
antes de executar o cenário; não foi validado o percurso completo por linguagem natural.
A leitura semântica retornou referências, mas o preenchimento semântico foi recusado com HTTP 409
(`estado_invalido`, motivo `indisponivel`), inclusive após nova localização do campo. A busca foi
concluída pela alternativa visual, sem tratar a ação semântica recusada como sucesso.
A branch integrada ainda não foi instalada nesse runtime; a prova real acima corresponde ao
preview existente com o computador otimizado, e a integração é validada localmente.

## Resolução

Conflitos resolvidos combinando funcionalidades, com adaptação dos contratos extraídos, do login
na região React, das ações e das referências do prompt. Provedores que oferecem somente interação
visual recusam explicitamente a ação semântica não suportada, com teste; não foi adicionada uma
implementação nova de navegação semântica nesses provedores.
Seis PNGs antigos de referência/QA, não necessários ao runtime e não aprovados pelo scanner público,
foram removidos da árvore publicada e do manifesto de assets, mantendo cópias locais privadas.

## Validações locais

- Lint, typecheck completo, cercas do domínio e das migrações passaram.
- Build Vite passou; mantém os avisos de tamanho de bundles já presentes nessa interface.
- Navegador/runtime: 17/17 testes passaram.
- Testes de conflitos: 252 passaram inicialmente; a referência do prompt foi atualizada após
  revisão das instruções combinadas. A saída para conta foi adaptada e testada no componente React.
- A rodada geral de unitários/componentes teve 14.446 aprovados, 37 ignorados e seis falhas.
  Corrigidos os encaixes do rótulo semântico, da distribuição das imagens e da reconciliação das
  aprovações do preview. O reteste dos seis arquivos afetados passou: 184/184, incluindo o prompt.
  A falha restante nessa rodada era `ENOTEMPTY` na limpeza temporária do teste de fila; passou no
  reteste sem alteração nesse teste ou no mecanismo da fila.

A execução de `npm run check` ocorreu uma vez e parou na etapa unitária. As etapas de banco
foram executadas separadamente depois das correções, em banco exclusivo da worktree. Não se
apresenta essa primeira execução como um `check` inteiramente verde.

Integração com banco: 2.778 testes passaram na rodada de 338 arquivos. Um teste de freios do
quadro excedeu 20 segundos e foi separado para reteste. A outra falha é a asserção de uso do
índice `trabalhos_pkey` em `pedir-a-bot.test.ts`; ela foi reproduzida também numa worktree limpa
em `e7a538af`, a base original do preview, com o mesmo ambiente de banco. O teste e o repositório
de pedidos não foram alterados pela integração; não foi feita otimização SQL fora do escopo.

O reteste isolado dos dois cenários de laço do quadro passou na integração (2/2), sem alteração
do mecanismo. Conformidade passou: 24 arquivos, 113 testes, incluindo RLS e migrações.


Concorrência: 145 arquivos executados, 143 aprovados e dois com falha; 761 testes aprovados,
sete ignorados e dois com falha. A criação de bot com cor e forma excedeu a espera pela conversa
nova na rodada geral; passou isoladamente tanto na base original quanto na integração, sem
mudança de código. O teste `conversa-fim-sem-pulo-chrome` vindo da outra origem exige balão e
resumo durante o turno. O preview já usa somente um indicador de atividade nessa fase, sem
resposta parcial. O mesmo teste, copiado sem alterações para a base original e executado contra o build dela,
falha pelo mesmo motivo. Essa incompatibilidade permanece explícita,
sem enfraquecer ou ignorar o teste e sem redesenhar a conversa fora do escopo solicitado.

Assim, esta branch é uma integração para continuidade, com as duas ressalvas locais persistentes
(asserção do índice SQL e contrato visual herdado), e não uma certificação de toda a suíte verde.
Não houve atualização de `main`, de `preview/grokbot`, instalação da integração no preview,
PR adicional ou deploy. O scanner público passou (3.910 arquivos, nenhum arquivo proibido ou achado do gitleaks); os registros
com sessões, identificadores e capturas ficaram privados.
