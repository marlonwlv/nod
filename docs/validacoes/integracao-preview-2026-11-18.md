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
