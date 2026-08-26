# EnvSync

Sincronização seletiva de ambiente entre máquinas BigLinux na mesma LAN.

## O que é

- **Daemon** (`envsyncd`): descoberta mDNS, TLS mútuo, inventário, plano e apply
- **UI** (Electron): catálogo grupo/item, plano com **Confirmar** obrigatório, conflitos e atividade

## Setup

```bash
cd ~/projects/envsync
pnpm install
pnpm --filter @envsync/protocol build
pnpm --filter @envsync/catalog build
pnpm --filter @envsync/core build
pnpm --filter @envsync/plugins build
pnpm --filter @envsync/daemon build
```

## Rodar (desktop Qt — recomendado)

```bash
pnpm --filter @envsync/ui build   # se ainda não buildou a UI
pnpm desktop                      # sobe daemon se precisar + janela PySide6
```

Ou pelo menu iniciar: **EnvSync**.

## Rodar (dev separado)

```bash
pnpm daemon   # terminal 1 — também serve UI em http://127.0.0.1:45770
# abra a URL no browser, ou:
pnpm desktop
```

A UI web é React (Vite); o shell nativo é **PySide6 + QtWebEngine** (mesmo padrão do Hermes), não Electron.

## Serviço systemd (usuário)

```bash
chmod +x scripts/install-user-service.sh
./scripts/install-user-service.sh
```

## Fluxo de uso

1. Abra a UI nos dois PCs  
2. Em **Dispositivos**, pareie pelo fingerprint  
3. Em **Catálogo**, marque grupos/itens  
4. Em **Plano**, monte o plano e clique **Confirmar** (nada aplica antes disso)  
5. Resolva **Conflitos** se houver  
6. Veja **Atividade**; backups em `~/.local/share/envsync/backups/`

## Testes

```bash
pnpm test
pnpm typecheck
```

## Spec / plano

- `docs/superpowers/specs/2026-08-25-envsync-design.md`
- `docs/superpowers/plans/2026-08-25-envsync.md`
