# 1º Campeonato Babigol SLZ

Site oficial do campeonato. Repositório de código-fonte público.

- **Site:** https://babigol-slz-2026.vercel.app
- **Hospedagem:** projeto existente `babigol-slz-2026` na Vercel
- **Branch principal:** `main`
- **Aplicação atual:** página estática HTML/CSS/JavaScript, sem instalação de dependências

## Como desenvolver com Codex (Windows)

1. Abra o projeto local `Babigol SLZ` no Codex.
2. Execute `git pull origin main` antes de editar (a versão original foi adicionada ao GitHub depois do clone).
3. Abra `index.html` e trabalhe numa branch de alteração, como `codex/melhorar-layout`.
4. Teste o site no navegador antes de propor a integração em `main`.
5. Crie um Pull Request para revisar as alterações antes do deploy.

## Publicação

**Importante:** o site já está publicado na Vercel e o projeto existente deve ser preservado. Primeiro vincule o repositório GitHub ao **projeto Vercel existente**, em Settings → Git → Connect Git Repository, caso ainda não esteja vinculado. Não crie um novo projeto Vercel de mesmo nome. Depois configure `main` como Production Branch e faça um deploy de teste.

## Funcionalidades atuais

- Identidade visual do escudo: fundo branco, azul-marinho e dourado (fontes Barlow, Barlow Condensed e Chakra Petch, hospedadas em `assets/fonts`)
- Página inicial com contagem regressiva, troféu animado e etapas do campeonato
- 12 participantes e cadastro de nomes/nicks
- Sorteio animado: um controle digita um código de 8 botões (ex.: `BG26-69528D`) que serve de semente do embaralhamento, e os nicks são revelados um a um nos grupos A, B e C. O código fica salvo e aparece na classificação
- Placar de 18 jogos, classificação automática e corrida dos terceiros colocados
- Oito classificados: dois primeiros de cada grupo e dois melhores terceiros
- Chaveamento espelhado (2 quartas e 1 semi de cada lado) com a final e o troféu no centro; o placar de cada partida é lançado numa janela, com desempate em caso de empate
- Estimativa de custos do churrasco e chopp
- Imagens em WebP com fundo transparente (`assets/*.webp`); os JPG originais ficam para o `og:image`

## Limitações conhecidas

- Dados ficam apenas no localStorage do navegador; não são compartilhados em tempo real entre dispositivos.
- O desempate e a ordenação dos terceiros colocados merecem testes de regras adicionais antes da competição.
- Não coloque senhas, tokens, credenciais ou informações pessoais privadas neste repositório público.
