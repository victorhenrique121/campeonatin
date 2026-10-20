# FC Arena - Gerenciador de campeonatos de EA FC

O FC Arena é um aplicativo desktop para organizar campeonatos de EA FC entre amigos. Ele reúne salas privadas, jogadores, partidas, ranking e formatos de campeonato em uma experiência compartilhada.

O app oferece salas por código, pontos corridos, mata-mata, modo Maluco, duplas 2v2, ranking, histórico de partidas, feed de notícias e a Central da Arena para sorteios e desafios.

## Stack

- Electron
- React 19
- TypeScript
- Vite
- better-sqlite3
- Supabase

## Pré-requisitos

- Node.js 24 ou superior

## Como rodar

1. Clone o repositório e entre na pasta do projeto:

   ```powershell
   git clone https://github.com/victorhenrique121/campeonatin.git
   cd campeonatin
   ```

2. Instale as dependências:

   ```powershell
   npm install --ignore-scripts
   ```

3. Crie o arquivo de ambiente a partir do exemplo e preencha as variáveis do seu projeto:

   ```powershell
   Copy-Item .env.example .env
   ```

   Não versione o arquivo `.env` nem compartilhe suas chaves.

4. Inicie o aplicativo:

   ```powershell
   npm run dev
   ```

> Alterações no preload ou no processo principal do Electron exigem reiniciar o aplicativo.

## Estrutura do projeto

```text
src/
  main/       Processo principal, serviços, espelho SQLite e integração com Supabase
  renderer/   Interface React, páginas, componentes e estilos
  shared/     Tipos e contratos compartilhados entre renderer, preload e main
supabase/
  migrations/ Estrutura do banco, funções e políticas de segurança
```

O diretório `src/preload/` expõe a ponte segura entre o Electron e a interface.

## Migrations

As migrations ficam em `supabase/migrations/`. Aplique primeiro em um projeto de desenvolvimento, revise o SQL e confirme um backup antes de usar qualquer projeto de produção.

Com a CLI do Supabase vinculada ao projeto de destino, use:

```powershell
supabase db push
```

## Backup

O backup diário é previsto pelo workflow `.github/workflows/backup.yml`. No checkout atual, esse arquivo ainda não existe; portanto, a automação diária precisa ser adicionada ou restaurada antes de ser considerada ativa.

## Status do projeto

### Já funciona

- Salas privadas e gestão de membros
- Jogadores e catálogo de times
- Campeonatos, participantes e partidas
- Pontos corridos, mata-mata e fase de grupos
- Modo Maluco
- Duplas 2v2
- Ranking, dashboard e histórico de partidas
- Feed de notícias geradas a partir das partidas
- Central da Arena com sorteios, desafios e roleta de times

### Em desenvolvimento

- Tela de amigos e convites

## Qualidade

```powershell
npm run typecheck
npm run lint
```

## Licença

Este projeto ainda não possui uma licença open source definida.
