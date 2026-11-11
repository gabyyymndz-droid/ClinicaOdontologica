# SmileCare Manager

Sistema de gestión para clínica odontológica: HTML5, Bootstrap 5, JavaScript nativo (ES Modules) y Firebase (Auth + Firestore, SDK v9+ modular).

## Estructura

```
smilecare/
├── index.html            # Panel (SPA con router por hash): dashboard, pacientes, expediente, citas
├── login.html            # Inicio de sesión + recuperación de contraseña
├── firestore.rules       # Reglas de seguridad por rol (la barrera real)
├── css/
│   └── styles.css        # Tema (variables CSS), layout, odontograma, línea de tiempo
└── js/
    ├── firebase-config.js  # initializeApp, auth, db y datos de la clínica
    ├── auth.js             # login/logout, perfil y rol, permisos, guardias de navegación
    ├── patients.js         # CRUD pacientes, búsqueda (.filter/.includes), consultas
    ├── appointments.js     # CRUD citas, cálculo de tiempo restante, URL de WhatsApp
    └── app.js              # Router, eventos (delegación), renderizado, toasts, spinners
```

## Puesta en marcha

1. **Crea el proyecto en Firebase** y registra una app web. Copia la configuración en `js/firebase-config.js`.
2. **Authentication → Método de acceso:** habilita *Correo electrónico/contraseña*.
3. **Firestore Database:** créala y publica el contenido de `firestore.rules` (en la consola, pestaña *Reglas*, o con `firebase deploy --only firestore:rules`).
4. **Crea los usuarios** en Authentication. Por cada uno, crea en Firestore el documento `users/{UID}`:
   ```json
   { "nombre": "Dr. Juan Martínez", "email": "doctor@smilecare.com", "rol": "doctor" }
   { "nombre": "Ana Rivas", "email": "recepcion@smilecare.com", "rol": "secretaria" }
   ```
   Una cuenta sin documento `users/{UID}` o con un rol desconocido no puede entrar.
5. **Sirve el proyecto por HTTP.** Los ES Modules no funcionan abriendo el archivo con `file://`:
   ```bash
   npx serve .          # o la extensión Live Server de VS Code
   ```
   Para producción: `firebase init hosting` y `firebase deploy`.

## Modelo de datos (Firestore)

| Colección | Campos principales |
|---|---|
| `users/{uid}` | `nombre`, `email`, `rol` (`doctor` \| `secretaria`) |
| `patients/{id}` | `nombre`, `dui`, `fechaNacimiento`, `genero`, `telefono`, `email`, `direccion`, `alergias`, `antecedentes`, `creadoPor`, `creadoEn`, `actualizadoEn` |
| `patients/{id}/consultations/{id}` | `fecha` (YYYY-MM-DD), `piezaDental` (FDI o `General`), `tratamiento`, `costo`, `notas`, `doctorId`, `doctorNombre`, `creadoEn` |
| `appointments/{id}` | `pacienteId`, `pacienteNombre`, `telefono`, `fecha`, `hora`, `motivo`, `notas`, `estado` (`programada` \| `completada` \| `cancelada`), `recordatorioEnviado`, `recordatorioFecha` |

Todas las consultas usan índices de un solo campo, que Firestore crea automáticamente; no hace falta configurar índices compuestos.

## Permisos por rol

| Acción | Doctor Principal | Secretaria |
|---|:---:|:---:|
| Ver pacientes, expediente e historial | ✅ | ✅ (solo lectura) |
| Registrar paciente | ✅ | ✅ |
| Editar / eliminar ficha clínica | ✅ | ❌ |
| Registrar / eliminar consultas | ✅ | ❌ |
| Agendar citas, completar / cancelar | ✅ | ✅ |
| Eliminar citas | ✅ | ❌ |
| Enviar recordatorio WhatsApp | ✅ | ✅ |

Los permisos se aplican en tres capas: la interfaz oculta lo que el rol no puede usar (`data-permission`), cada función de los módulos llama a `assertPermission()`, y `firestore.rules` bloquea la escritura en el servidor.

## Notas

- **WhatsApp:** a un número local de 8 dígitos se le antepone el código `503` (configurable en `CLINIC_CONFIG.codigoPais`). La ventana se abre antes de cualquier `await` para que el navegador no la bloquee. El mensaje queda listo en WhatsApp y el personal lo envía con un clic.
- **Seguridad XSS:** todo texto que viene de Firestore pasa por `escapeHTML()` antes de insertarse en el DOM.
- **Eliminar paciente:** borra también sus consultas y citas en un solo `writeBatch`, con un límite de 500 operaciones.
