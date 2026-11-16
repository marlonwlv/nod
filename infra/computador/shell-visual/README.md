# Shell visual compartilhado

O bundle `paper-v2` é a exportação versionada da fonte de verdade do Gil no Paper. O ZIP recebido na NOD-497 foi conferido pelo SHA-256 `1efb2fc36d2045eb89833e53b31777bfc83dd6ddf72b9542dfc1d98fae36dcb1`; dele vieram o wallpaper, os tokens, a configuração e as referências PNG 2×. O HTML e os launchers são implementação local declarativa: nenhum JSX ou comando do export é executado e nenhum asset do Bot HQ foi incluído.

Faixas: desktop `≥1180 px`, tablet `768–1179 px` e mobile `390–767 px`. Os breakpoints representativos do manifesto são `1440×900`, `1024×768` e `390×844`. Docker e Orgo aplicam o mesmo manifesto; a instalação valida todos os checksums, é idempotente, troca a versão atomicamente e preserva a anterior para recuperação.

Os apps Browser, Terminal e Files são programas reais e seus launchers são gerados pelo runtime a partir de uma lista fixa. Os cinco prints adicionais do Marlon não vieram no pacote; por isso a validação humana complementar continua pendente.
