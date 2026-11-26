# nod 1.0.0-rc.16

Décima sexta candidata da 1.0.0, para o bot usar os apps do seu Mac também quando você está num app em tela cheia. Macs: DMGs assinados (Developer ID) e notarizados; quem está numa rc anterior recebe pelo atualizador automático, ou instala o DMG por cima. Windows: instalador `.exe` de 1 clique, por usuário, ainda sem assinatura (NOD-471); no PC as correções chegam pelo motor, que se atualiza sozinho. Instalação, requisitos e atualização: [guia do desktop](https://github.com/marlonwlv/nod/blob/v1.0.0-rc.16/docs/release-desktop.md).

## O que entra desde a rc.15 (26/11)

- **Seu Mac com a janela em outro Space** ([#397](https://github.com/marlonwlv/nod/pull/397)): com você num app em tela cheia, o app que o bot abre fica noutro Space e a acessibilidade não o alcança por trás; agora o bot lê de novo e, se precisar, age em primeiro plano por um instante e devolve o foco. Testado no Mac do dono.
- **A aba Seu Mac / Seu PC no painel e a pausa no PC** ([#396](https://github.com/marlonwlv/nod/pull/396)): o último quadro da janela e os passos do bot ao lado da conversa; no PC, o bot pausa quando você mexe no mesmo app.

## Registro da versão

```text
Versão / tag / SHA: 1.0.0-rc.16 / v1.0.0-rc.16 / <SHA> (último PR no commit: <PR>)
PR e execução do Actions: desktop-release run <RUN> (verify, vm-local arm64 e amd64, windows, mac arm64 e x64, draft)
Servidor e migrações compatíveis: https://app.nodbot.ai, mesma tag
DMGs, ZIPs, .exe e hashes: ver SHA256-arm64.txt, SHA256-x64.txt e SHA256-win-x64.txt anexos
Disco da VM local (Mac): nod-vm-1.0.0-rc.16-arm64.img.zst e -amd64.img.zst, com .sha256, anexos e em gs://nodbot-downloads/v1.0.0-rc.16/
Windows: nod-windows-x64.exe (nome estável, /download/windows e o botão do site) e nod-1.0.0-rc.16-win-x64.exe (feed da atualização) em gs://nodbot-downloads
Atualização automática (ZIPs e .exe no bucket, NOD_APP_VERSAO_PUBLICADA e NOD_APP_ATUALIZACAO_SHA256, deploy): pendente
Assinatura e notarização: Mac pendente de conferir nas duas arquiteturas (Developer ID, notarizado e grampeado); Windows sem assinatura (NOD-471)
Aceite Intel (pessoa, Mac, macOS, resultado): pendente
Aceite ARM (pessoa, Mac, macOS, resultado): pendente
Aceite Windows (pessoa, versão do Windows, resultado): pendente
Atualização desde a versão anterior: pendente (origem 1.0.0-rc.15)
Custo dos turnos do aceite: pendente
Limitações e recuperação: candidata (pre-release). Windows: SmartScreen na primeira execução. Mac: primeira abertura baixa o disco da VM (~750 MB).
O que falhou e o que melhorar na próxima versão: <preencher com o estado da CI no merge>
```

Aceite Intel/ARM/Windows: pendente.
