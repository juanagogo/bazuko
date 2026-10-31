# Animaciones de Mixamo para el personaje

El personaje usa el esqueleto de Mixamo (`mixamorig:*`), así que cualquier animación de Mixamo le sirve.
Mientras no estén las tuyas, el juego usa `public/models/animaciones-prueba.glb` (idle, caminar y correr del ejemplo de three.js).

## 1. Descargar (con tu cuenta de Adobe)

1. Entra a <https://www.mixamo.com> e inicia sesión con tu cuenta de Adobe (es gratis).
2. En **Characters** deja el personaje por defecto (**Y Bot**). No hace falta subir el nuestro: el juego adapta la animación a cualquier esqueleto de Mixamo.
3. En **Animations** busca cada animación de la tabla, ajusta los parámetros y pulsa **Download** con:
   - **Format:** FBX Binary (.fbx)
   - **Skin:** Without Skin
   - **Frames per Second:** 30
   - **Keyframe Reduction:** none
4. Guarda el archivo con el **nombre de la tabla** (es el nombre del clip en el juego) en una carpeta, por ejemplo `bazuko-arte/mixamo/`.

| Archivo | Búsqueda sugerida en Mixamo | Para qué |
|---|---|---|
| `idle.fbx` | *Sad Idle* o *Standing Idle* | Quieto |
| `walk.fbx` | *Sad Walk* o *Walking* (marca **In Place**) | Caminar |
| `run.fbx` | *Running* (marca **In Place**) | Correr |
| `buscar.fbx` | *Picking Up* o *Kneeling* | Buscar en la basura |
| `pedir.fbx` | *Begging* o *Asking For Help* | Pedir plata |
| `comer.fbx` | *Eating* o *Drinking* | Comer y tomar |
| `dormir.fbx` | *Sleeping Idle* o *Laying Idle* | Dormir en el cambuche |
| `saludo.fbx` | *Waving* | Saludo del creador |

Solo `idle`, `walk` y `run` son obligatorias; las demás se usan si existen.
**In Place** es importante en caminar y correr: el juego mueve al personaje, la animación no debe avanzar.

## 2. Convertir a un solo GLB

```bash
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --python tools/personaje/mixamo_a_glb.py -- "../bazuko-arte/mixamo" public/models/animaciones.glb
```

El banco de respaldo se configura explícitamente con `ANIM_URL` en `src/character/RealisticCharacter.js`. Después de exportar `animaciones.glb`, actualizar esa ruta para usarlo. ActionForge sigue aportando los clips principales. No se solicita un archivo inexistente durante cada arranque.

## Licencia

Adobe permite usar las animaciones de Mixamo gratis en juegos comerciales, siempre que vayan dentro del juego.
Lo que no se puede es redistribuir los archivos sueltos como un paquete de animaciones. Revisa las condiciones vigentes en las preguntas frecuentes de Mixamo antes de publicar.
