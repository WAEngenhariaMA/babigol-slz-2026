# 1º Campeonato Babigol SLZ

Site oficial do campeonato de FIFA 26 Pro Clubs para PC, Xbox e PS5.

- [Site oficial](https://babigol-slz-2026.vercel.app)
- Projeto Vercel existente `babigol-slz-2026`
- Branch de produção `main`

## Arquitetura da V3

O HTML, o CSS, os assets e o JavaScript do navegador são publicados como arquivos estáticos. A função Node.js `/api/campeonato` autentica o administrador, valida as operações e acessa o Airtable. `rules.js` contém as regras de sorteio, classificação e mata-mata usadas nos dois lados.

O Airtable fornece os 12 participantes, os registros das 25 partidas, o controle do sorteio e o orçamento. As atualizações usam os IDs existentes. Criar um item do orçamento é a única operação de edição que cria um registro de dados. Desativar e restaurar alteram o checkbox `Ativo` do mesmo item.

A função mantém um cache de leitura de 35 segundos por instância. A página consulta periodicamente enquanto estiver visível e fora de edição. A versão retornada pela API representa uma revisão e o conteúdo lido. Cada gravação verifica essa versão e reserva uma operação na tabela `Controle`. Registros internos com prefixo `__babigol_v3_write:` guardam a operação e os valores anteriores enquanto ela está em andamento. A API só confirma a gravação após verificar os campos gravados. Se a compensação falhar, a opção **Recuperar gravação** verifica a operação pendente depois de dois minutos e restaura os valores quando for seguro. Edite pelo site para que as gravações usem esse controle. A API do Airtable não fornece uma transação entre tabelas nem uma condição atômica sobre a revisão.

Os visitantes veem apenas itens ativos. O custo por pessoa é calculado pelo total dividido pela quantidade de pessoas. A cota sugerida é configurável e determina, com o rateio, a arrecadação e a reserva previstas.

## API

Todas as rotas usam `/api/campeonato?acao=<operação>`. As escritas exigem JSON da mesma origem e uma sessão de administrador, com a exceção do login. A sessão dura duas horas e usa um cookie `Secure`, `HttpOnly` e `SameSite=Strict`. As tentativas malsucedidas são limitadas por origem de rede e registradas no Airtable com identificador derivado por HMAC.

| Método | Operações | Acesso |
| --- | --- | --- |
| GET | `estado`, `sessao` | Público |
| GET | `backup` | Administrador |
| POST | `login`, `logout` | Mesma origem |
| POST | `participantes`, `sorteio`, `placares`, `mata-mata` | Administrador |
| POST | `importar`, `reiniciar`, `recuperar` | Administrador |
| POST | `orcamento-adicionar`, `orcamento-editar`, `orcamento-ativo`, `orcamento-rateio` | Administrador |

A API devolve HTTP 409 quando a revisão mudou ou outra gravação está em andamento. Atualize a tela e revise a edição. Em falhas de conexão ou configuração, a tela identifica a última leitura disponível e bloqueia a edição.

## Configurar Preview com segurança

1. Em **Airtable → Developer hub → Personal access tokens**, crie um PAT exclusivo para a base de testes `appAgvXJuUfI6X73J`. Selecione `data.records:read`, `data.records:write` e `schema.bases:read`. O último escopo permite ler as opções do campo Categoria e os tipos de campo existentes. [Documentação de PATs do Airtable](https://support.airtable.com/docs/creating-personal-access-tokens)
2. No PowerShell, dentro da pasta deste projeto, execute:

   ```powershell
   pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\credenciais.ps1
   ```

   Digite uma senha exclusiva de testes com pelo menos 16 caracteres. A entrada fica oculta. O script produz um hash scrypt com salt aleatório e uma chave de sessão aleatória. Guarde a senha no seu gerenciador de senhas.
3. Em **Vercel → babigol-slz-2026 → Settings → Environment Variables**, confira que `AIRTABLE_BASE_ID` em Preview aponta para `appAgvXJuUfI6X73J`. Adicione `AIRTABLE_TOKEN` com o PAT do passo 1, `ADMIN_PASSWORD_HASH` e `SESSION_SECRET` com as saídas do passo 2. Use o tipo **Secret** e selecione **Preview**. Copie só o valor após o sinal de igual. [Variáveis da Vercel](https://vercel.com/docs/environment-variables)
4. Gere um novo deploy da branch V3 no ambiente **Preview** para incluir as variáveis. Abra o endereço da prévia, confira a leitura pública e use **Acesso administrativo** no rodapé para entrar.
5. Valide na base de testes e aguarde a aprovação para produção. Quando essa etapa for autorizada, use um PAT exclusivo da base oficial `applelq32YWbB2Icp`, senha e chave de sessão diferentes, todos no alvo **Production**. A função rejeita IDs de base incompatíveis com o ambiente.

## Migração e recuperação

1. No navegador que contém os dados antigos, use **Exportar backup local** e guarde o JSON. A V3 mantém a chave `babigol2026` para esse backup e usa uma chave separada para o cache online.
2. Entre como administrador na prévia. Use **Comparar com backup local** para conferir nomes, nicks, posições e placares. Exporte também o backup online para ter o estado anterior à importação.
3. Use **Importar JSON**, escolha o backup local e confira a confirmação antes de gravar. Um arquivo antigo restaura participantes, grupos, sorteio e partidas. Ao importar um backup online, a opção **Incluir o orçamento** restaura o rateio e os itens presentes no arquivo, desde que seus IDs já existam na mesma base.
4. Recarregue a página e confira os dados em outro navegador. Se precisar desfazer a importação, importe o backup online anterior. Para falha parcial sinalizada pela API, use **Recuperar gravação** antes de tentar outra edição.

Para testar orçamento na prévia, exporte um backup da base de testes, adicione um item com nome de QA, edite-o, desative-o, restaure-o e confirme os totais em dois navegadores. Teste a quantidade e a cota, depois restaure os valores originais e desative o item de QA. Use apenas a base de testes para este roteiro.

## Testes locais

```powershell
npm test
npm run build
```

Os testes usam um simulador das quatro tabelas do Airtable e passam pela função HTTP, autenticação, cálculo do chaveamento, gravações, conflitos e compensação. Os arquivos do servidor, testes e scripts ficam fora da saída estática `dist/`. A validação real em Preview depende das credenciais configuradas e de uma sessão administrativa.
