# FC Arena - Gerenciador de campeonatos de EA FC

Aplicativo desktop para organizar campeonatos de EA FC entre amigos. O FC Arena reúne salas privadas, jogadores, partidas, ranking, estatísticas e diferentes formatos de competição em uma única interface.

É desenvolvido com Electron e React. Os dados são sincronizados com o Supabase e mantêm um espelho SQLite local para telas de leitura, ranking e dashboard.

## Recursos

- Salas privadas por código, com papéis de proprietário, administrador e participante.
- Cadastro de jogadores e catálogo de times.
- Registro de partidas, histórico, ranking e estatísticas.
- Campeonatos de pontos corridos e mata-mata.
- Fase de grupos seguida por mata-mata, incluindo avanços automáticos quando aplicável.
- Modo maluco, com mutadores e desafios.
- Feed de notícias da arena baseado nas partidas registradas.
- Central da Arena com sorteios, desafios e roleta de times.

## Stack

- Electron
- React 19
- TypeScript
- Vite
- better-sqlite3
- Supabase

## Pré-requisitos

- Node.js 24 ou superior
- Docker (opcional, para testes locais de banco)
- Um projeto Supabase configurado, caso use salas e sincronização online

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

   Não versione o arquivo `.env` e não compartilhe suas chaves.

4. Inicie o aplicativo:

   ```powershell
   npm run dev
   ```

> Alterações no preload ou no processo principal do Electron exigem reiniciar o aplicativo.

## Estrutura do projeto

```text
src/
  main/       Processo principal, serviços, SQLite e integração com Supabase
  preload/    Ponte segura entre o Electron e a interface
  renderer/   Interface React, páginas e estilos
  shared/     Tipos e contratos usados entre renderer, preload e main
supabase/
  migrations/ Estrutura do banco, funções e políticas de segurança
```

## Migrations do Supabase

As migrations ficam em `supabase/migrations/`. Aplique primeiro em um projeto de desenvolvimento, depois de testar e ter um backup adequado.

Com a CLI do Supabase vinculada ao projeto de destino, o comando é:

```powershell
supabase db push
```

Nunca aplique migrations diretamente no projeto de produção sem revisar o SQL, testar no ambiente de desenvolvimento e confirmar o backup.

## Backup

O banco SQLite local pode ser copiado antes de mudanças importantes ou restaurações.

O workflow automático esperado é `.github/workflows/backup.yml`, com execução diária. **Ele ainda não existe neste repositório**, portanto o backup diário por GitHub Actions não está configurado no estado atual.

## Status do projeto

### Já funciona

- Salas privadas e gerenciamento de membros
- Jogadores
- Campeonatos e participantes
- Partidas e histórico
- Ranking e dashboard
- Mata-mata e visualização de chave
- Fase de grupos com transição para mata-mata
- Feed de notícias da arena
- Central da Arena

### Em desenvolvimento

- Fluxo completo de duplas na interface
- Tela de amigos e convites
- Automação diária de backup por GitHub Actions

## Qualidade

```powershell
npm run typecheck
npm run lint
```

## Licença

Este projeto ainda não possui uma licença open source definida.
