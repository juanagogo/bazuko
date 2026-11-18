# Cambios respecto a cpp_2

**Corregido**
- `Input`: las pulsaciones se registran por evento. Un toque de tecla más corto que un fotograma (Esc, C, V, Tab...) ya no se pierde.
- Menú de pausa: el volumen mostraba "0 %" o "1 %" (el control iba de 0 a 1 con formato de porcentaje); ahora muestra 0–100 %.
- Build: un solo `CMakeLists.txt` para Windows y Linux; libwebp, GLFW, GLM e ImGui se descargan solos si faltan (ya no hace falta `WEBP_ROOT`). Se quitó `FetchContent_Populate` (obsoleto) y la copia obligatoria de `public/` (50 MB) en cada compilación.
- Independencia: los recursos que el port usaba de `../public` (modelos, texturas, audio, imágenes) se reunieron en `cpp/public/` con `tools/reunir_recursos.py`; el juego ya no busca nada fuera de `cpp/`.
- Rutas: el juego encuentra `assets/` y `public/` desde cualquier directorio de trabajo (`core/Paths`), no solo desde `build/`.
- Compilación cruzada a Windows (MinGW) comprobada: genera `bazuko.exe` x64 que solo depende de DLL del sistema.
- Limpieza: eliminados `test_diag`, `test_*.cpp`, `CMakeLists-win64.txt` y `win64-deps/` (binarios y glm copiados a mano); archivos normalizados a UTF-8 sin BOM y saltos LF.

**Nuevo**
- Super-resolución y afilado inteligente con AMD FidelityFX FSR 1.0 (EASU + RCAS) y AMD CAS en la pasada final (`assets/shaders/present.frag`). Reconstrucción direccional de 12 muestras que preserva bordes y texturas al correr en calidad baja (0,75×) o resolución adaptativa, logrando mayor fluidez en GPUs integradas con nitidez cercana a resolución nativa.
- Variables de entorno `BAZUKO_FSR_MODE` (0 = bilineal, 1 = CAS, 2 = FSR 1.0) y `BAZUKO_SHARPEN` (0.0–1.0) para ajustar y comparar en vivo.
- Rótulos legibles en las fachadas (`world/SignAtlas`, `world/TextRaster`): 16 nombres de local del original (DROGUERÍA, PANADERÍA, MISCELÁNEA...), 8 grafitis en las persianas y 8 avisos de cartulina (SE ARRIENDA, RECARGAS...). El texto se dibuja con Roboto Medium usando stb_truetype de ImGui; no añade dependencias.
- Texturas con mipmaps y filtrado anisotrópico (los rótulos y el ladrillo ya no parpadean a distancia).
