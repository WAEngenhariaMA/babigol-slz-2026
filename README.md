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

- 12 participantes e cadastro de nomes/nicks
- Sorteio aleatório para três grupos de quatro
- Placar de 18 jogos e classificação automática
- Oito classificados: dois primeiros de cada grupo e dois melhores terceiros
- Quartas de final, semifinais e final
- Estimativa de custos do churrasco e chopp

## Limitações conhecidas

- Dados ficam apenas no localStorage do navegador; não são compartilhados em tempo real entre dispositivos.
- A identidade visual publicada ainda usa emblema e troféu ilustrativos. Os arquivos originais do escudo e troféu precisam ser adicionados e incorporados ao layout.
- O desempate e a ordenação dos terceiros colocados merecem testes de regras adicionais antes da competição.
- Não coloque senhas, tokens, credenciais ou informações pessoais privadas neste repositório público.
