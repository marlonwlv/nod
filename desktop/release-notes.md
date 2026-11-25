# nod 1.0.0-rc.12

Décima segunda candidata da 1.0.0, com as correções dos QAs da rc.10 no Windows e no navegador. Macs: DMGs assinados (Developer ID) e notarizados; quem está numa rc anterior recebe pelo atualizador automático quando a versão for anunciada, ou instala o DMG por cima. Windows: instalador `.exe` de 1 clique, por usuário, ainda sem assinatura (o SmartScreen pede "Mais informações > Executar assim mesmo", NOD-471). O motor do Windows não se atualiza com o app: quem já tem o motor instalado roda de novo `irm https://nodbot.ai/windows | iex`. Instalação, requisitos e atualização: [guia do desktop](https://github.com/marlonwlv/nod/blob/v1.0.0-rc.12/docs/release-desktop.md).

## O que entra desde a rc.11 (24/11)

- **Windows: nod.log e a janela lembra tamanho e posição** ([#333](https://github.com/marlonwlv/nod/pull/333)): correções do QA geral da rc.10 no Windows, com o log do app em `nod.log` e a janela reabrindo no tamanho e na posição em que foi fechada.
- **A primeira tarefa no Windows volta a funcionar** ([#327](https://github.com/marlonwlv/nod/pull/327)): o shim do Codex reescrito com caminhos absolutos passa a ser reconhecido (antes caía no `codex.ps1` e a primeira mensagem falhava), e os erros da primeira mensagem ficam claros.
- **Navegador** ([#339](https://github.com/marlonwlv/nod/pull/339)): site vai sempre pelo navegador do bot, download direto, Chrome em pt-BR e os achados do QA do navegador no Windows.
- **Repareamento leva a chave nova** ([#325](https://github.com/marlonwlv/nod/pull/325)): ao parear de novo o mesmo computador, os bots e as sessões passam para a chave sucessora em vez de ficarem presos na antiga.
- **Computador desligado no Mac e no Windows** ([#337](https://github.com/marlonwlv/nod/pull/337)): o computador só roda em máquina Linux; no Mac e no Windows o bot usa só o navegador.

## Registro da versão

```text
Versão / tag / SHA: 1.0.0-rc.12 / v1.0.0-rc.12 / <SHA> (último PR no commit: <PR>)
PR e execução do Actions: desktop-release run <RUN> (verify, vm-local arm64 e amd64, windows, mac arm64 e x64, draft)
Servidor e migrações compatíveis: https://app.nodbot.ai, mesma tag
DMGs, ZIPs, .exe e hashes: ver SHA256-arm64.txt, SHA256-x64.txt e SHA256-win-x64.txt anexos
Disco da VM local (Mac): nod-vm-1.0.0-rc.12-arm64.img.zst e -amd64.img.zst, com .sha256, anexos e em gs://nodbot-downloads/v1.0.0-rc.12/
Windows: nod-windows-x64.exe (nome estável, /download/windows e o botão do site) e nod-1.0.0-rc.12-win-x64.exe (feed da atualização) em gs://nodbot-downloads
Atualização automática (ZIPs e .exe no bucket, NOD_APP_VERSAO_PUBLICADA e NOD_APP_ATUALIZACAO_SHA256, deploy): pendente
Assinatura e notarização: Mac pendente de conferir nas duas arquiteturas (Developer ID, notarizado e grampeado); Windows sem assinatura (NOD-471)
Aceite Intel (pessoa, Mac, macOS, resultado): pendente
Aceite ARM (pessoa, Mac, macOS, resultado): pendente
Aceite Windows (pessoa, versão do Windows, resultado): pendente
Atualização desde a versão anterior: pendente (origem 1.0.0-rc.11)
Custo dos turnos do aceite: pendente
Limitações e recuperação: candidata (pre-release). Windows: SmartScreen na primeira execução. Mac: primeira abertura baixa o disco da VM (~750 MB).
O que falhou e o que melhorar na próxima versão: <preencher com o estado da CI no merge>
```

Aceite Intel/ARM/Windows: pendente.
