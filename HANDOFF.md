# FC Arena — Passagem de bastão para a próxima IA

Leia este documento inteiro, depois o `AGENTS.md` na raiz do repositório. O `AGENTS.md` traz as regras e o plano em fases. Este arquivo traz o estado real, o que deu errado até aqui e o que fazer agora.

Atualizado em 17/10/2026. **Verificado** indica conferência direta no repositório ou em teste local; **não verificado** indica relato do dono ou algo que não pôde ser conferido nesta atualização.

---

## 1. O projeto e o objetivo

**FC Arena** é um app desktop para gerenciar campeonatos de EA FC entre amigos: jogadores, times, partidas, campeonatos, ranking e estatísticas.

Stack: Electron 43, React 19, TypeScript 7, Vite 8, `better-sqlite3`, Supabase (Auth, Postgres, Storage). Repositório: https://github.com/victorhenrique121/campeonatin

**Objetivo final:** sair de gerenciador local e virar uma plataforma online. Cada pessoa tem conta e perfil, entra em uma sala por código, e os campeonatos, partidas e ranking são compartilhados dentro da sala. Mais adiante: jogadores vinculados a contas, confirmação de resultado pelo adversário, estatísticas no perfil e convites.

**Sobre o dono:** não é desenvolvedor profissional, escreve em português, trabalha no Windows e cola saídas de terminal. Explique em linguagem simples, dê comandos prontos para PowerShell e um passo de cada vez. Quando ele disser que não está entendendo, simplifique em vez de detalhar mais.

---

## 2. O que já está pronto

- **Conta e perfil:** cadastro, login, verificação de e-mail, sessão, logout, avatar, nome, `@username` único, bio e papel.
- **Configurações:** Conta, Senha, E-mail, Aparência, Notificações, Privacidade e Sobre.
- **Banco:** `profiles.role` protegido por trigger; bucket `avatars` com políticas por dono.
- **Regras do jogo:** 3/1/0 e mínimo 3 para Melhor Forma, via `repository.gameRules()`.
- **Fase 0:** CI, ESLint, Vitest e modularização parcial do renderer; PR #8 mergeado no `main`.
- **Fase 1:** fechada no repositório, na branch `fix/fase-1-salas`; correções e documentação nos commits `40d53c1`, `12c3156`, `ff48de4`, `48fbe5c`, `de38a3f`, `5329b5f` e `332ae81` (**verificado** no histórico). Isso não significa que as migrations foram aplicadas ou aceitas no Supabase.
- **Verificações no Windows do dono:** typecheck, lint e test **verificado** pelo dono no PowerShell, com 8 testes passando e saída real.

---

## 3. Arquitetura

```text
renderer (React) -> preload (window.arena) -> IPC -> services -> Supabase
                                                  \-> repository.ts (SQLite local)
```

- **Modo híbrido:** escritas de jogadores, partidas, campeonatos e times vão ao Supabase; leituras, ranking, dashboard e partidas vêm de um espelho SQLite sincronizado por `syncMirror`. Offline: leitura pelo espelho, escrita recusada.
- **Dois clientes em `src/main/supabase.ts`:** `userAuthClient` para login e perfil, e o cliente dos serviços de dados.
- **Problema estrutural:** serviços de dados e `syncMirror` usam uma conta de serviço com `profiles.role = 'admin'`, não a sessão do usuário. Isso compartilha dados no app inteiro e inclui uma credencial administrativa no app distribuível. A troca pela sessão é a Fase 2.
- **App atual:** segundo o dono, foi testado conectado ao projeto Supabase real com a conta de serviço, e a escrita funciona no schema antigo, sem salas (**não verificado nesta atualização**).
- **RLS legado:** autenticados leem e admin global escreve, com exceções para jogador vinculado. Na Fase 1, as políticas compatíveis preservam o acesso global de admin; veja a seção 5.
- **Tabelas de domínio:** `players`, `teams`, `championships`, `matches`, `fixtures` e `championship_participants`; perfil em `profiles`.
- **Cadeia de IPC:** uma operação precisa ter o mesmo nome e formato na tela, no preload, em `src/shared/api.ts` e no handler. Divergência já causou erro de função ausente.
- **Erros ao usuário:** em português, sem prefixos técnicos ou texto em inglês. Há uma função central em `src/renderer/settings/auth-error.ts`.

---

## 4. Ambiente do dono (Windows)

- Projeto em `C:\Users\Admin\Desktop\campeonatin`. A Área de Trabalho pode ser sincronizada pelo OneDrive e travar arquivos em `node_modules`; `C:\dev\campeonatin` é uma alternativa.
- O Build Tools 2022 está instalado e o app abre no Windows (**verificado** pelo dono; o app subiu com `npm run dev`). O dono executa typecheck, lint e test normalmente no PowerShell.
- O erro `EPERM` ao rodar Vitest no sandbox do Codex é do ambiente do Codex, não uma evidência de falha no Windows do dono (**relato; não verificado nesta atualização**).
- Preserve `vitest.config.ts` separado de `vite.config.ts` e o script `vitest run --root .`; a configuração no arquivo errado já causou TS2769.
- Preload e processo principal só atualizam ao reiniciar o app. Não reinstale dependências nem rode o app sem autorização e sem conferir as instruções atuais.
- O SMTP padrão do Supabase tem limite baixo. A página de confirmação está em `https://authenticator-email.vercel.app/`, configurada em `src/shared/auth-config.ts`.
- O app aponta para o projeto real segundo o dono; não consulte nem altere `.env` sem autorização. Antes de testes de integração, o dono deve confirmar o destino de desenvolvimento. Nunca exponha credenciais.

---

## 5. O que está acontecendo agora

### 5.1 Correções e teste local

O PR #9 da Fase 1 foi mergeado antes da revisão. Na branch `fix/fase-1-salas`, os três bugs originais foram corrigidos: políticas restritivas separadas por comando (`12c3156`), registro das tentativas de `join_room` e geração de códigos com descarte (`40d53c1`). `join_room` devolve UUID ou `NULL`, não a linha da sala.

Um quarto bug apareceu ao aplicar a migration inicial num banco local limpo: `current_user_role()` era usada antes da definição. O commit `5329b5f` moveu a definição para depois da criação de `profiles` e antes das políticas.

No Postgres local, o shim e as oito migrations foram aplicados; a matriz obteve o resultado esperado em **5 de 6 itens**. O item (e) mostrou que a conta de serviço com admin global consegue ler jogadores de sala da qual não participa: medidos 3, esperados 0. A conta também leu e escreveu dados legados sem `room_id`.

A exposição entre salas é dívida conhecida aceita para a Fase 1 e documentada em `supabase/FASE_1_SALAS.md` pelo commit `332ae81`; não significa isolamento completo enquanto o admin global continuar habilitado.

A migration adiada `supabase/deferred/20261016090500_enforce_room_scope_after_phase_3.sql` executou em transação revertida no banco local (**verificado**), mas está incompleta: falta remover as políticas de admin global. Não aplicá-la antes de concluir as Fases 2 e 3 e revisar seu conteúdo.

### 5.2 Próximos passos

1. Revisar as correções da branch e a dívida conhecida antes de qualquer merge.
2. Resolver a disponibilidade de um projeto de desenvolvimento e testar nele, inclusive o backfill parametrizado, antes de considerar o real.
3. Obter um backup adequado do projeto real antes de qualquer aplicação nele; exportação CSV é apenas proteção parcial, não restauração completa.
4. Não aplicar migrations automaticamente nem avançar de fase sem aprovação do dono.

---

## 6. Decisões já tomadas (não reabrir sem motivo)

- Um usuário pode estar em várias salas (N:N). Papéis: `owner`, `admin`, `participant`. Só o owner cria admins; só sai depois de transferir a propriedade.
- `teams` é catálogo global somente leitura; sem `room_teams` por enquanto.
- Código permanente, regenerado por owner ou admin; alfabeto `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, 8 caracteres.
- Exclusão de sala por soft delete (`deleted_at`).
- Jogadores, campeonatos e partidas: escrita por owner e admin da sala; participantes só leem. Confirmação pelo adversário fica para depois.
- Espelho SQLite: um arquivo por sala (`room-<id>.sqlite`).
- `profiles.role` é global e, no modelo final, não dá acesso a salas; o papel da sala vem de `room_members.role`.
- Exceção transitória aceita na Fase 1: o admin global da conta de serviço enxerga dados de outras salas. A dívida deve ser resolvida na Fase 2 ao substituir a conta pela sessão do usuário; não apresentar o isolamento atual como completo.
- Busca por `@username` desligada; entrada por código. Offline: só leitura.
- `players.user_id` é opcional, com unicidade parcial por sala e usuário.
- Ordem obrigatória: criar salas e membros; adicionar `room_id` nullable; fazer backfill; somar políticas compatíveis; só depois das Fases 2 e 3 considerar `NOT NULL` e remoção do admin global, corrigindo antes a migration adiada incompleta.

---

## 7. Roteiro do que implementar

**Fase 1:** fechada no repositório; aplicação no real pendente e bloqueada por backup. Antes disso, obter projeto de desenvolvimento e testar nele, inclusive backfill com dono indicado pelo usuário. O aceite em desenvolvimento ainda não foi confirmado.

**Fase 2:** trocar a conta de serviço pela sessão do usuário em `players`, `teams`, `championships` e `matches`, nessa ordem, um serviço por PR; depois o `syncMirror`. Validar `created_by = auth.uid()` no banco e resolver a dívida de acesso global. Não remover a conta de serviço ainda.

**Fase 3:** espelho SQLite por sala; repositório exige `roomId`, e trocar de sala descarta o contexto e resincroniza. Testar isolamento entre salas. Só depois revisar e aplicar a migration adiada, não antes de completar as Fases 2 e 3.

**Fase 4:** interface para criar, entrar, selecionar, trocar e sair de salas; mostrar/copiar/regenerar código. Antes, implementar gestão de membros e decidir se participantes veem `entry_code`.

**Fase 5:** migrar dados antigos com backup, reconstruir SQLite, retirar credenciais administrativas do app; o dono troca a senha da conta de serviço e revoga sessões.

**Fase 6:** jogadores vinculados, confirmação de resultados, estatísticas calculadas, exportação de dados, convites e busca opcional por `@username`.

**Adiados:** SMTP próprio, modelos de e-mail traduzidos, recuperação de senha, Auth Hook de e-mail, TOTP, ajustes finos de cor, modularização adicional do renderer e vídeo promocional.

---

## 8. O que deu errado no caminho (evite repetir)

- Build quebrou sem typecheck; rode e apresente a saída quando autorizado.
- PR #9 foi mergeado antes da revisão do SQL; revise migrations antes do merge.
- O HANDOFF original foi escrito sem ver commits de 16/10 que já corrigiam dois dos três bugs, causando retrabalho. Confira branch e histórico antes de agir.
- A migration inicial falhava em banco limpo pela ordem de `current_user_role()`; isso só apareceu no teste local com banco limpo.
- Ferramentas diferentes podem enxergar só GitHub ou só arquivos locais; confirme branch e commit.
- `(create_room()).*` pode chamar a função uma vez por coluna; em testes use `select * from create_room(...)`.
- A configuração do Vitest no arquivo errado causou TS2769; veja a seção 4.
- O `AGENTS.md` não estava no repositório durante a Fase 0.

---

## 9. Regras de trabalho

1. Nunca declare que typecheck, lint ou testes passaram sem rodar e mostrar a saída real. Se não puder rodar, diga.
2. Uma fase por vez, branch própria, commits pequenos e separados, parar ao fim de cada parte.
3. Migrations: escrever, **não aplicar**. O dono aplica, primeiro no projeto de desenvolvimento. Nunca no real sem backup.
4. Nunca enfraquecer RLS nem a proteção de `profiles.role`. Segurança vive no banco, não no front-end.
5. Nunca pedir nem usar senhas, tokens ou chaves. `.env` fora do git; nunca commitar segredos nem expô-los em logs.
6. Não apagar funções, tabelas ou migrations só por limpeza; listar o que ficou sem uso.
7. Mensagens ao usuário em português e sem termos técnicos.
8. Se algo estiver ambíguo ou conflitar com estas regras, pergunte antes de agir.

---

## 10. O que você precisa descobrir com o dono antes de começar

- O backup do projeto real pode ser feito? Segundo o dono, o plano atual não permite backup automático nem manual pelo dashboard; avaliar CSV como rede de segurança parcial, não backup completo (**não verificado**).
- O projeto de desenvolvimento pode ser criado? Segundo o dono, o plano atingiu o limite (**não verificado**).
- A conta de serviço funciona após correção da senha no `.env` (**verificado** pelo dono; o app conectou e os testes de login, perfil, configurações, ranking, dashboard, lista de partidas e cadastro de jogador/time passaram). O app aponta para o real; quando houver desenvolvimento, o dono deve apontar o `.env` para ele. Não ler nem expor a credencial.
- O Docker local `fc-arena-test` e o shim `supabase/local_test/00_supabase_shim.sql` servem para testes de migrations. Não devem ir para o Git; o `.gitignore` ainda não cobre o shim e a correção está pendente em commit separado (**verificado**).

---

## 11. Estado do ambiente de teste local

- O container descartável `fc-arena-test` usa Postgres 15, porta 5433 e banco `fcarena` (**versão informada pelo dono; não verificada nesta atualização**). A credencial local não é registrada neste documento.
- O shim `supabase/local_test/00_supabase_shim.sql` simula `auth.uid()`, `auth.users`, `gen_random_bytes`, os papéis `anon`, `authenticated` e `service_role`, e uma representação mínima de Storage e Realtime.
- Para repetir a matriz em banco limpo, recriar o container descartável e reaplicar shim e migrations na ordem. Antes de usar `docker rm -f` ou `docker volume rm`, confirmar os nomes exatos e verificar que os volumes pertencem somente ao teste; nunca apagar volumes por seleção genérica ou sem autorização. Depois recriar o container com `docker run`.
- O shim não deve ir para o Git. O `.gitignore` ainda não o cobre; corrigir em commit separado com autorização do dono.
