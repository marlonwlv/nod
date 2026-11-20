# nod 1.0.0-rc.9

Nona candidata da 1.0.0. Ela traz para a main a frente da preview: a interface minimalista com as Tarefas em abas, o computador compartilhado entre bots, o Marketplace em modal com apps por chave de API e a atualização do app do Mac pela janela web. Macs: DMGs assinados (Developer ID) e notarizados; quem está numa rc anterior recebe pelo atualizador automático quando a versão for anunciada, ou instala o DMG por cima. Windows: instalador `.exe` de 1 clique, por usuário, ainda sem assinatura (o SmartScreen pede "Mais informações > Executar assim mesmo", NOD-471). Instalação, requisitos e atualização: [guia do desktop](https://github.com/marlonwlv/nod/blob/v1.0.0-rc.9/docs/release-desktop.md).

## O que entra nesta versão (desde a rc.8, 18/11)

- **Tarefas em tela cheia, com abas** ([#173](https://github.com/marlonwlv/nod/pull/173), [#176](https://github.com/marlonwlv/nod/pull/176)): "frente", "task" e "trabalho" viram uma palavra só na tela, tarefa. A tarefa abre em tela cheia com a conversa detalhada e o Parar no campo. Na Conversa, o botão de abas ao lado da pílula do bot liga o modo abas, e "Fechar abas" volta ao modo pílula. Nenhuma aba fecha sozinha, e a que precisa da pessoa nunca fica escondida.
- **Atualizar o nod pela janela web** ([#173](https://github.com/marlonwlv/nod/pull/173), ADR-188): quando a versão nova já baixou, um cartão no pé da barra reinicia o app com um clique.
- **O Parar não perde o que a pessoa disse** ([#173](https://github.com/marlonwlv/nod/pull/173), ADR-185): a fala escrita no meio de um turno volta à fila se o bot não chegou a lê-la, e a fala mostra se ele já leu.
- **Acessos devolvidos à interface minimalista** ([#108](https://github.com/marlonwlv/nod/pull/108)): cancelar a mensagem na fila, cartão de aprovação enxuto e os demais acessos da decisão de 16/11.
- **Computador compartilhado entre bots** ([#88](https://github.com/marlonwlv/nod/pull/88), [#89](https://github.com/marlonwlv/nod/pull/89), [#91](https://github.com/marlonwlv/nod/pull/91), [#107](https://github.com/marlonwlv/nod/pull/107), [#140](https://github.com/marlonwlv/nod/pull/140), [#162](https://github.com/marlonwlv/nod/pull/162)): uma máquina por pessoa, com display, perfil e espaço de trabalho próprios para cada bot. Dá para assistir ao vivo por VNC sem porta pública, e o chat reconcilia o estado depois de uma reconexão. Também entram as correções de aprovação, retomada e preview ([#114](https://github.com/marlonwlv/nod/pull/114), [#134](https://github.com/marlonwlv/nod/pull/134), [#145](https://github.com/marlonwlv/nod/pull/145), [#152](https://github.com/marlonwlv/nod/pull/152), [#153](https://github.com/marlonwlv/nod/pull/153)).
- **Marketplace em modal e apps por chave de API** ([#171](https://github.com/marlonwlv/nod/pull/171), [#174](https://github.com/marlonwlv/nod/pull/174), [#175](https://github.com/marlonwlv/nod/pull/175)): o Marketplace vira um modal (Apps · Plugins · Bots · Avançado). Os toolkits do Composio que pedem chave de API passam a conectar, e Microsoft e as reuniões entram pelo Composio.

## Registro da versão

```text
Versão / tag / SHA: 1.0.0-rc.9 / v1.0.0-rc.9 / <SHA> (último PR no commit: <PR>)
PR e execução do Actions: desktop-release run <RUN> (verify, vm-local arm64 e amd64, windows, mac arm64 e x64, draft)
Servidor e migrações compatíveis: https://app.nodbot.ai, mesma tag
DMGs, ZIPs, .exe e hashes: ver SHA256-arm64.txt, SHA256-x64.txt e SHA256-win-x64.txt anexos
Disco da VM local (Mac): nod-vm-1.0.0-rc.9-arm64.img.zst e -amd64.img.zst, com .sha256, anexos e em gs://nodbot-downloads/v1.0.0-rc.9/
Windows: nod-windows-x64.exe (nome estável, /download/windows e o botão do site) e nod-1.0.0-rc.9-win-x64.exe (feed da atualização) em gs://nodbot-downloads
Atualização automática (ZIPs e .exe no bucket, NOD_APP_VERSAO_PUBLICADA e NOD_APP_ATUALIZACAO_SHA256, deploy): pendente
Assinatura e notarização: Mac pendente de conferir nas duas arquiteturas (Developer ID, notarizado e grampeado); Windows sem assinatura (NOD-471)
Aceite Intel (pessoa, Mac, macOS, resultado): pendente
Aceite ARM (pessoa, Mac, macOS, resultado): pendente
Aceite Windows (pessoa, versão do Windows, resultado): pendente
Atualização desde a versão anterior: pendente (origem 1.0.0-rc.8; primeira com o cartão "Atualizar o nod" na janela web)
Custo dos turnos do aceite: pendente
Limitações e recuperação: candidata (pre-release). Windows: SmartScreen na primeira execução. Mac: primeira abertura baixa o disco da VM (~750 MB).
O que falhou e o que melhorar na próxima versão: <preencher com o estado da CI no merge>
```

Aceite Intel/ARM/Windows: pendente.
