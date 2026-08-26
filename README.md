# EnvSync

Sincronização seletiva de ambiente entre máquinas BigLinux na mesma LAN.

## O que é

- **Daemon** (`envsyncd`): descoberta mDNS, TLS mútuo, inventário, plano e apply (HTTP local + UI)
- **Desktop**: shell **PySide6 + QtWebEngine** (mesmo padrão do Hermes)

## Instalação (PC ou notebook)

### 1. Dependências do sistema

BigLinux / Manjaro / Arch:

```bash
sudo pacman -S python-pyside6 nodejs npm librsvg
```

Node com pnpm (se ainda não tiver):

```bash
corepack enable   # ou: npm install -g pnpm
```

### 2. Clonar e instalar o app

```bash
git clone git@github.com:fidelesdev/EnvSync.git ~/projects/envsync
cd ~/projects/envsync
chmod +x scripts/install.sh
./scripts/install.sh
```

Isso faz: `pnpm install`, build, ícone e atalho **EnvSync** no menu iniciar.

Daemon sempre em background (opcional):

```bash
ENVSYNC_INSTALL_SERVICE=1 ./scripts/install.sh
```

### 3. Abrir

- Menu iniciar → **EnvSync**
- Ou: `~/projects/envsync/scripts/launch-envsync.sh`

## Uso entre dois dispositivos

1. Instale e abra o EnvSync nos **dois**
2. Mesma Wi‑Fi/LAN
3. **Dispositivos** → parear pelo fingerprint
4. **Catálogo** → selecionar → **Plano** → **Confirmar**

## Desenvolvimento

```bash
pnpm daemon    # API + UI em http://127.0.0.1:45770
pnpm desktop   # janela Qt
pnpm test
pnpm typecheck
```

## Spec / plano

- `docs/superpowers/specs/2026-08-25-envsync-design.md`
- `docs/superpowers/plans/2026-08-25-envsync.md`
