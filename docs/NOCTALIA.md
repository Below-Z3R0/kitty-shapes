# Conectar con Noctalia y con el login screen

Cómo se comporta Noctalia v5 con la imagen del usuario, y qué hay que tocar
para que el oso aparezca en el login screen (SDDM).

---

## La variable

En Noctalia **v5** (el nativo, en C++ y OpenGL ES; el v4 de Quickshell es
JSON y está sin mantener) el avatar se guarda en la sección `[shell]` de la
config TOML:

```toml
[shell]
avatar_path = "/home/tu-usuario/.config/noctalia/avatar.png"
```

- **Valor por defecto**: `~/Pictures/avatar.png`
- **Qué pinta**: el avatar que Noctalia muestra en su UI (la tarjeta de usuario
  del Control Center, entre otros).

---

## Las tres capas de la config

| Capa | Ruta | Quién manda |
|---|---|---|
| Defaults del binario | — | la base |
| Tu config declarativa | `~/.config/noctalia/*.toml` | tu fuente de verdad |
| Overrides de la GUI | `~/.local/state/noctalia/settings.toml` | **gana sobre la tuya** |

Orden de carga: defaults → tus `*.toml` (ordenados alfabéticamente) →
`settings.toml`. Los dos últimos se recargan en caliente.

**La trampa clásica**: si alguna vez tocaste el avatar desde la GUI, el valor
queda en `settings.toml` y le gana a tu `config.toml`. De ahí que el script
**no** lea `config.toml` a mano (ahí `avatar_path` suele estar vacío): lee
directamente `~/.local/state/noctalia/settings.toml` (1 ms) y deja
`noctalia config export` (24 ms) como respaldo si ese fichero no existe.

> Esto se descubrió a la mala: la versión que leía `config.toml` se quedaba sin
> avatar porque el `config.toml` tiene `avatar_path = ""` y el valor real está
> en el state de la GUI.

### Comandos útiles

```bash
noctalia config export            # tu config fusionada (lo que lee el script)
noctalia config export full       # la config efectiva con TODOS los defaults
noctalia config validate          # sintaxis + claves desconocidas
noctalia msg config-reload        # recarga la config ahora
```

---

## Ponerlo

```bash
# 1. el oso con una forma fija (la cookie de 6 lóbulos queda bien de avatar)
kitty-shapes pick ~/osito.png \
    --shape cookie12 --size 512 --palette 256 \
    --path --out ~/.config/noctalia/avatar.png

# 2. apuntar en la config
printf '\n[shell]\navatar_path = "%s/.config/noctalia/avatar.png"\n' "$HOME" \
    >> ~/.config/noctalia/config.toml

# 3. recargar
noctalia msg config-reload
noctalia config validate
```

> Si tu `config.toml` **ya tiene** una sección `[shell]`, no añadas otra: mete
> solo la línea `avatar_path = ...` dentro de la que ya hay, o TOML se queja.

---

## El login screen (SDDM)

SDDM no sabe nada de Noctalia. Busca el avatar en este orden:

| # | Fuente |
|---|---|
| 1 | `/var/lib/AccountsService/faces/<usuario>.face.icon` |
| 2 | `~/.face.icon` |
| 3 | `/var/lib/AccountsService/icons/<usuario>` ← **aquí cae lo de Noctalia** |
| 4 | `<tema>/faces/.face.icon` (el del tema) |
| 5 | `<FacesDir>/.face.icon` (por defecto `/usr/share/sddm/faces/`) |

La cadena que lo hace funcionar:

```
Noctalia [shell].avatar_path
  └─ escribe org.freedesktop.Accounts → IconFile (por D-Bus)
        └─ accounts-daemon copia la imagen a /var/lib/AccountsService/icons/<usuario>
              └─ SDDM lo encuentra (prioridad nº3) → tema silent → pantalla de login
```

**Si cambias el avatar en Noctalia y en SDDM cambia, es que tienes
accountsservice** (el paquete `accountsservice`, el servicio `accounts-daemon`).
No hay que hacer nada más.

### Si no tienes accountsservice

```bash
# Arch / Fedora
sudo pacman -S accountsservice
sudo systemctl enable --now accounts-daemon
```

Y para el greeter, a mano:

```bash
cp ~/.config/noctalia/avatar.png ~/.face
cp ~/.config/noctalia/avatar.png ~/.face.icon
# el usuario sddm tiene que poder leerlos
sudo setfacl -m u:sddm:x "$HOME"
sudo setfacl -m u:sddm:r "$HOME/.face.icon"
```

### Alternativa: que SDDM lea un directorio común

```toml
# /etc/sddm.conf.d/avatar.conf
[Theme]
FacesDir=/var/lib/AccountsService/icons/
```

Y si los avatares no salen:

```toml
# /etc/sddm.conf.d/avatars.conf
[Theme]
EnableAvatars=true
DisableAvatarsThreshold=7
```

---

## El tema silent

El tema silent (uiriansan/SilentSDDM) tiene su propia sección de avatar:

```ini
[LoginScreen.LoginArea.Avatar]
shape = circle
border-radius = 35
active-size = 120
inactive-size = 80
```

Ojo: con `shape = circle` la cookie de 6 lóbulos se ve recortada por el
círculo. Si te molesta, baja el `border-radius` o usa una forma más redonda
(`cookie6`, `hexagon`).

---

## Diagnóstico

```bash
# ¿qué avatar tiene Noctalia ahora mismo?
noctalia config export | sed -n 's/^[[:space:]]*avatar_path.*= *"\(.*\)".*/\1/p'

# ¿qué icono tiene registrado tu usuario (lo que ve el greeter)?
loginctl show-user "$USER" -p IconFile

# ¿está el servicio?
systemctl is-active accounts-daemon
```

En fish, el mismo script de diagnóstico se ejecuta como fichero (no pegado en
el prompt, que no entiende `var="valor"`):

```fish
bash ~/noctalia-avatar-check.sh
```
