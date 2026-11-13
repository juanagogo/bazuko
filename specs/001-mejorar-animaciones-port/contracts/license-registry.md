# Contrato del registro de licencias

Archivo: `cpp/docs/animaciones-licencias.md`. Una sección por fuente externa. Ningún clip de captura entra al banco sin su sección completa.

## Formato de cada sección

```text
## <Nombre de la fuente>

- Licencia: <CC0 | texto de la fuente | ...>
- Enlace de la fuente: <URL>
- Enlace de la licencia: <URL>
- Atribución: <texto exacto exigido o pedido, o «ninguna exigida»>
- Clips del juego que vienen de ella: <lista de nombres del banco>
- Verificado: <fecha> por <página oficial | copia guardada en docs/> 
- Notas: <condiciones que importan: redistribución, uso comercial, otros>
```

## Reglas

1. **Solo licencias que permitan uso comercial y redistribución dentro de un juego.** Quedan fuera: licencias de solo evaluación, no comerciales, de investigación, o que prohíban redistribuir el archivo de animación como recurso.
2. **Cita de la licencia.** La frase que permite el uso se copia tal cual en «Notas» y, si la página puede cambiar, se guarda una copia de la página.
3. **Atribución.** Si la fuente pide crédito, se añade también a la pantalla de créditos del juego y a `docs/creditos-modelos.md`.
4. **Animación propia.** Los clips hechos a mano para el juego se listan en una sección «Propias» sin licencia externa.
5. **Fuentes secundarias.** Una licencia confirmada solo por foros o blogs se marca «sin verificar» y no deja entrar clips hasta confirmarla en la página oficial.

## Fuentes previstas

| Fuente | Licencia | Estado de verificación |
|---|---|---|
| Quaternius Universal Animation Library 1 y 2 | CC0 | Verificada en la página oficial; falta confirmar el contenido exacto de la versión gratuita |
| Quaternius vía ActionForge (51 clips ya exportados) | CC0 según ActionForge | Falta confirmar en la página de ActionForge |
| Base de captura de CMU (BVH) | «puede copiarse, modificarse o redistribuirse sin permiso»; pide crédito | Verificada en las preguntas frecuentes oficiales |
| Mixamo | Prohíbe redistribuir el archivo como recurso suelto | **Excluida**: no se añaden clips nuevos |
