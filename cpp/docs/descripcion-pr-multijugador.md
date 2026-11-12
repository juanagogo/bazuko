# Port C++/OpenGL: multijugador en línea (mundo compartido, combate, economía, perfiles, migración de anfitrión e internet por relevo)

Sigue al PR anterior del port (ya aceptado). Todo lo de red se compila con `-DBAZUKO_NET=ON`; por defecto el juego es el de un jugador y los hashes de referencia de la simulación
(semillas 42 y 7) no cambian.

## Qué se puede hacer ahora

- **Jugar con otros**: `--anfitrion`, `--conectar=IP`, o por internet sin abrir puertos con un servidor de relevo (`--anfitrion-relay=IP`, `--sala=CODIGO@IP`; ver `cpp/docs/multijugador-internet.md`).
- **Ver a los demás como son**: cada jugador se ve con su propio personaje (sexo, edad, pelo, barba, ropa, calzado, colores).
- **Un mismo mundo**: carros, peatones, buses, hora, clima y semáforos los simula el anfitrión; los invitados los reciben (error medio medido de 1 cm en carros, unos 6 KB/s por invitado).
- **Pelear**: golpes entre jugadores y contra la gente de la calle, validados por el anfitrión (alcance, dirección, ritmo); los peatones del anfitrión también pegan a los invitados.
- **Plata y costal protegidos**: el anfitrión lleva una copia por jugador y revierte lo que las reglas no explican (ventas infladas, plata de la nada, objetos sin receta ni compra).
- **Perfiles**: plata, costal, experiencia, nivel y talentos se guardan en el anfitrión con una clave de perfil y mandan al volver.
- **La partida no se cae con el anfitrión**: si se va o cierra, el siguiente jugador asume y los demás se reconectan; también se puede traspasar con F9. Se conservan hora, clima, carros, gente de la calle, patrullas que acudían y perfiles.

## Cómo está hecho

- La refactorización de `main()` en funciones sobre `PlayerSession` (supervivencia, economía, movimiento, pelea, entrada) con pruebas diferenciales contra el código original.
- Un protocolo propio sobre ENet (bits cuantizados, lectura que nunca se sale del buffer) con simulación de latencia, jitter y pérdida para las pruebas.
- Predicción y reconciliación del jugador local con las mismas reglas de movimiento en cliente y servidor.
- `Simulation` con modo invitado (no simula tráfico ni peatones, aplica y extrapola) y ascenso a anfitrión.
- Servidor de relevo (`bazuko_relay`) que solo reenvía paquetes entre salas.

## Cómo probar

```sh
cmake -S cpp -B cpp/build -DBAZUKO_NET=ON
cmake --build cpp/build --config Release
ctest --test-dir cpp/build -C Release     # 28 pruebas con red, 26 sin ella
```

Además se probó con **tres instancias reales del juego** (relevo, anfitrión y dos invitados en una máquina): el anfitrión cerró, la partida pasó al segundo, el tercero se
reconectó, y luego pasó al tercero.

## Lo que no está hecho

Está en `cpp/docs/plan-multijugador.md` (sección «Estado y pendiente»). Lo principal: no se probó con jugadores en redes distintas ni con NAT real; el relevo no cifra ni
autentica; no hay cuentas (la clave de perfil es el único secreto); no hay menú de multijugador en el juego (se entra por línea de comandos); la economía se valida por
plausibilidad, no por autoridad total; faltan el chat, los nombres sobre los jugadores y las animaciones completas de los jugadores remotos.
