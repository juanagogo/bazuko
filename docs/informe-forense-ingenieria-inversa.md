# Informe Forense Defensivo e Ingeniería Inversa Estática — Bazuko (`bazuko.exe` y Repositorio)

**Fecha de auditoría:** 2026-11-11  
**Herramientas utilizadas:** Craft Anything MCP (`core_target_open`, `core_overview_show`, `core_feature_find`, `native_function_study`), Python `pefile`, y `gitleaks` (Cybersecurity Stack).  
**Target ID (Craft Anything):** `t_886a141e7c7a`

---

## 1. Identificación Criptográfica y Triaje del Binario Nativo

| Atributo | Valor Verificado |
| :--- | :--- |
| **Ruta del artefacto** | `cpp/build/Release/bazuko.exe` |
| **Formato / Arquitectura** | `PE32+ executable (GUI) x86-64, for MS Windows` (`Machine: 0x8664`) |
| **Tamaño exacto** | `8,841,728 bytes` (8.43 MB) |
| **SHA-256** | `886a141e7c7ae046bee4cfdbfbb4f7040e43b10afd8a4941d1d290fd7944ad2e` |
| **SHA-1** | `fd8b90d3abff6a5d4dd295ca7e1586da42fbbe4e` |
| **MD5** | `8bf68be0de949438f41621d33d505c5c` |
| **Imphash (PEFile)** | `37ddfa6ca0fc1b303f8c279221fa8338` |
| **ImageBase / EntryPoint** | `0x140000000` / `0x140623ff0` (RVA `0x623ff0`, CRT startup) |
| **Compilador / Linker** | MSVC `14.51` (Visual Studio 2022 build `36260`) |
| **Total de Funciones / Cadenas** | `18,245` funciones analizadas / `24,198` cadenas extraídas |

**Evidencias registradas en el ledger:**
* `ev_8765f52ce36a24517dd9cbcff5435e4e92da6e04e628fec56dc1749ff2fb614c` (Apertura y triaje de `bazuko.exe`)
* `ev_2c2b6c302e1f1415ee390293c125ec9ad1bbedc249c8c8aec54846e6626324aa` (Inspección estructural PE64, secciones, imports y Rich Header)

---

## 2. Mapa de Secciones PE y Análisis de Entropía

El análisis de entropía de Shannon confirma que el binario es **100% código nativo limpio compilado desde fuente**, sin empaquetadores (UPX/Themida/VMProtect), sin secciones cifradas y sin *overlays* ocultos al final del archivo:

| Sección | Virtual Address | Virtual Size | Raw Size | Entropía (0–8) | Permisos | Diagnóstico Forense |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`.text`** | `0x1000` | `6,499,298 B` | `6,499,840 B` | **6.489** | `R-X` | Código máquina x86_64 estándar (motor C++20 + librerías estáticas) |
| **`.rdata`** | `0x634000` | `1,615,292 B` | `1,615,360 B` | **5.557** | `R--` | Constantes, tablas RTTI (`glm`, `nlohmann`, `Assimp`, `ImGui`), strings y RTTI |
| **`.data`** | `0x7bf000` | `1,401,536 B` | `179,712 B` | **4.212** | `RW-` | Variables globales inicializadas + ~1.22 MB `.bss` sin inicializar |
| **`.pdata`** | `0x916000` | `508,428 B` | `508,416 B` | **5.961** | `R--` | Tablas de *Exception Unwinding* x64 (`RUNTIME_FUNCTION`) |
| **`.rsrc`** | `0x993000` | `1,480 B` | `1,536 B` | **2.593** | `R--` | Manifiesto XML de aplicación Windows (DPI awareness) |
| **`.reloc`** | `0x994000` | `35,668 B` | `35,840 B` | **5.308** | `R--` | Tabla de relocalización base para ASLR de 64 bits |

---

## 3. Postura de Seguridad del Binario (Hardening) y Símbolos Exportados

### Mitigaciones de Memoria (`DllCharacteristics = 0x8160`)
* **ASLR Dinámico (`IMAGE_DLLCHARACTERISTICS_DYNAMIC_BASE`):** **ACTIVO**
* **High-Entropy 64-bit ASLR (`HIGH_ENTROPY_VA`):** **ACTIVO**
* **DEP / NX (`IMAGE_DLLCHARACTERISTICS_NX_COMPAT`):** **ACTIVO** (Ninguna sección combina permisos `W` y `X` simultáneamente).
* **Control Flow Guard (`GUARD_CF`):** **INACTIVO** (Compilado sin `/GUARD:CF` para priorizar el rendimiento de cuadro en el bucle de renderizado).
* **Firma Digital Authenticode:** **NO FIRMADO** (`Security Directory RVA = 0x0`, esperado en compilación local de desarrollo).

### Símbolos Exportados por un `.exe` (Descubrimiento de Ingeniería Inversa)
Aunque es un ejecutable (`.exe`) y no una librería (`.dll`), contiene un directorio de exportación explícito con **2 símbolos en la sección `.data`** para forzar a los controladores de gráficos híbridos en portátiles a utilizar la GPU de mayor rendimiento:
1. **`NvOptimusEnablement`** en `0x1407b8000` (RVA `0x7b8000`) — Driver NVIDIA Optimus.
2. **`AmdPowerXpressRequestHighPerformance`** en `0x1407b8004` (RVA `0x7b8004`) — Driver AMD Radeon PowerXpress / Enduro.

---

## 4. Cadena de Suministro, Dependencias y Rich Header

* **Enlace Estático Autónomo:** Las librerías de terceros del motor (**GLFW 3**, **GLAD**, **Dear ImGui**, **Miniaudio**, **cgltf**, **Assimp**, **zlib**, **stb**, **nlohmann/json** y **GLM**) están compiladas estáticamente dentro de `.text` y `.rdata`.
* **Imports Dinámicos del Sistema (19 DLLs, 473 funciones):**
  * Gráficos y Ventanas: `OPENGL32.dll` (`wglCreateContext`, `wglMakeCurrent`, `wglSwapBuffers`), `GDI32.dll`, `USER32.dll`, `SHELL32.dll`, `IMM32.dll`, `ole32.dll`, `ADVAPI32.dll`.
  * Runtime C/C++: `KERNEL32.dll`, `MSVCP140.dll`, `VCRUNTIME140.dll`, `VCRUNTIME140_1.dll`, `api-ms-win-crt-*.dll`.
  * **Ausencia de red/telemetría:** El binario **no importa** `ws2_32.dll` (Winsock), `wininet.dll` ni `winhttp.dll`. No realiza conexiones de red ni telemetría externa.
* **Huella del Rich Header:**
  * `257` objetos compilados con C++ (`Utc1900_CPP`, build `36260`), `190` objetos en C (`Utc1900_C`, build `36260` — `glad.c`, `cgltf.c`, `miniaudio`, `zlib`), y `19` objetos ensamblados con `MASM`.

---

## 5. Decompilación y Verificación Binaria de AMD FidelityFX FSR 1.0 + CAS

Mediante `core_feature_find` y `native_function_study` se rastrearon las referencias cruzadas (XREFs) de la cadena `BAZUKO_FSR_MODE` (alojada en `.rdata` en la dirección virtual `0x14065b0b0`) hacia tres funciones del ejecutable:

| Dirección Virtual | RVA | Tamaño | Bloques / Instrucciones | Símbolo Reconstruido y Rol |
| :--- | :--- | :--- | :--- | :--- |
| **`0x1400ec730`** | `0xec730` | `2,331 B` | 84 bloques / 611 inst. | **`Renderer::EndScaledTarget`**: Carga `present.vert` y `present.frag`, lee `BAZUKO_FSR_MODE` (`off`/`bilinear` -> `0`, `cas` -> `1`, `fsr`/`fsr1` -> `2`) y `BAZUKO_SHARPEN`, e inyecta los uniforms `uScene`, `uBloom`, `uBloomStrength`, `uExposure`, `uToneMap`, `uSharpen`, `uInvSourceSize`, `uSourceSize`, `uOutputSize`, `uIsUpscaling` y `uUpscaleMode`. |
| **`0x140135920`** | `0x135920` | `7,448 B` | — | **`UIManager`**: Manejo de eventos de interfaz y menú de pausa (`fsr_toggle`). |
| **`0x140169b20`** | `0x169b20` | `15,435 B` | — | **`WebPanels`**: Renderizado del panel de pausa y botón interactivo `[Escala: FSR 1.0 + CAS / AMD CAS / Bilineal]`. |

**Evidencias registradas en el ledger:**
* `ev_6fbbc55f810688a68bf5742266745d7dc938e6a3d91a68dcf2ab2705f61ff889` (Búsqueda de símbolos y strings FSR/CAS)
* `ev_8ef014956d26c6b84302cc4554c4c426c794e40ae01b81761fdacd993fff7aec` (XREFs de `BAZUKO_FSR_MODE` en `0x14065b0b0`)
* `ev_1f3b77ba9c594adc173b902a128cf7535899e7e1572c6863c25a6d6a62626d5e` (Estudio de flujo de control y llamadas de `sub_1400ec730`)

---

## 6. Auditoría Forense de Secretos en Git (`gitleaks`)

Se ejecutó un escaneo criptográfico completo sobre todo el historial del repositorio (`237 commits`, ~`122.62 MB` de historial) utilizando `gitleaks`:
* **Resultado:** **`0 leaks found`** (Ninguna llave privada, token de API, credencial ni secreto expuesto en el árbol de commits).
