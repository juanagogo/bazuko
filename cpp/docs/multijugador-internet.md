# Jugar por internet (sin abrir puertos)

El multijugador del port en C++ funciona de dos maneras:

| Modo | Para qué | Qué hace falta |
|---|---|---|
| **Directo** | Red local (LAN) o un anfitrión con el puerto UDP abierto en su router | La IP y el puerto del anfitrión |
| **Por relevo** | Internet, cada jugador detrás de su router, sin abrir nada | Un **servidor de relevo** con IP pública (`bazuko_relay`) |

Todo lo demás (mundo compartido, combate, economía, perfiles, migración y traspaso de anfitrión) es igual en los dos modos.
Se compila con `-DBAZUKO_NET=ON` (por defecto está apagado y el juego es el de siempre).

```sh
cmake -S cpp -B cpp/build -DBAZUKO_NET=ON
cmake --build cpp/build --config Release
```

## 1. El servidor de relevo

Es un programa pequeño (`bazuko_relay`) que no sabe nada del juego: solo reenvía paquetes entre el anfitrión y sus invitados, por salas con un código de 6 caracteres.
Todos los jugadores se conectan **hacia afuera** hacia él, por eso no hay que abrir puertos en casa. Necesita una máquina con IP pública (un VPS básico alcanza:
cada invitado cuesta unos 6 KB/s) y **un puerto UDP abierto** (por defecto el 7770).

```sh
bazuko_relay            # puerto 7770
bazuko_relay 9000       # otro puerto
```

Limita a 500 salas, 100 invitados por sala y 600 mensajes por segundo por conexión. Una sala sin anfitrión espera 60 s a que alguien la retome (es lo que permite la
migración) y después se borra.

## 2. Anfitrión e invitados por relevo

```sh
bazuko --anfitrion-relay=IP_DEL_RELEVO[:puerto]     # abre una sala y muestra su código (también en el registro)
bazuko --sala=CODIGO@IP_DEL_RELEVO[:puerto]         # entra a la sala de otro jugador
```

También con variables de entorno: `BAZUKO_RELAY=IP[:puerto]` y `BAZUKO_ROOM=CODIGO@IP[:puerto]`.

## 3. Modo directo

```sh
bazuko --anfitrion[=puerto]            # por defecto 7777
bazuko --conectar=IP[:puerto]
```

(`BAZUKO_HOST` y `BAZUKO_JOIN` hacen lo mismo.) Detrás de un router hay que abrir el puerto UDP del anfitrión; para eso es el relevo.

## Qué pasa cuando el anfitrión se va

* **Cae o cierra el juego sin más**: el jugador de menor número abre la partida (en el mismo puerto, o retomando la misma sala del relevo con su código) y los demás se
  reconectan solos. Si ese tampoco responde en 8 s, el siguiente de la lista.
* **Cerrar la ventana del anfitrión** ya no tumba la partida: antes de salir le pasa la partida al siguiente (lista de jugadores y perfiles incluidos).
* **Traspasar sin salir**: **F9** (solo el anfitrión) pasa la partida al siguiente y el antiguo anfitrión vuelve a entrar como invitado.
* Se conservan la hora, el clima, los carros (siguen su circuito desde donde estaban), la gente de la calle, las patrullas que acudían con la sirena y los
  perfiles de todos (plata, costal, experiencia, nivel, talentos). **No** se conservan los policías que iban a pie ni las persecuciones a pie, y las patrullas que acudían
  pasan a acudir al nuevo anfitrión. Las bolsas de basura son de cada jugador (no se comparten), así que no se pierden con el relevo.

## Apariencia

Cada jugador ve a los demás con **su propio personaje** (sexo, edad, pelo, barba, ropa, calzado y colores), no con uno genérico. La apariencia viaja en el saludo y el
anfitrión se la reparte a todos, también a quien entra después. Se lee con validación (nunca se confía: cualquier valor fuera de las opciones del creador se
normaliza). Mientras el personaje de otro jugador se está armando se ve un civil por unos instantes. Si alguien cambia su apariencia en medio de la partida, los demás
la ven al volver a entrar.

## Perfiles

Cada jugador tiene una clave de perfil (`bazuko_clave_perfil.txt`, junto al guardado). El anfitrión guarda su plata, costal, experiencia, nivel y talentos en
`bazuko_perfiles/` (`--perfiles=carpeta`). Un perfil que ese anfitrión no conoce entra recortado (50 000 de plata, 60 objetos, nivel 20): un perfil se gana jugando en
ese anfitrión. **No hay cuentas ni contraseñas todavía**: quien copie la clave es ese jugador.

## Límites actuales

* El relevo no tiene cifrado ni autenticación: cualquiera que conozca su IP puede crear salas (hasta el máximo). Conviene ponerlo detrás de un cortafuegos o
  sobre una VPN si es público. El código de sala (32^6 combinaciones) es lo único que protege una sala, y el secreto para retomarla solo lo recibe el siguiente anfitrión.
* Por relevo cada paquete hace un salto extra: añade la latencia de ir y volver al servidor de relevo (conviene que esté en la misma región que los jugadores).
* Probado en una sola máquina (relevo, anfitrión y dos invitados reales por 127.0.0.1) y con las pruebas automáticas; **no se ha probado con jugadores reales en
  redes distintas ni con NAT de verdad**.
