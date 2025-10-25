# Changelog - Migración a Estructura N:M

## Resumen de Cambios

Se migró el backend de Node.js para reflejar la nueva estructura de base de datos con:
- Relación N:M entre votantes y líderes
- Soft-delete en todas las entidades principales
- Sistema completo de auditoría (logs)
- Gestión de incidencias automáticas

---

## 1. MIDDLEWARE

### Nuevo: Middleware de sesión MySQL
- **Archivo**: `server.js` (líneas 17-38)
- **Función**: Setea automáticamente `@current_user_id` en MySQL para auditoría
- **Headers soportados**:
  - `x-user-id`: ID del usuario en el header
  - `user_id`: ID del usuario en el body

---

## 2. ENDPOINTS DE VOTANTES

### Modificados

#### `GET /votantes`
- **Antes**: Retornaba `lider_identificacion` con JOIN directo
- **Ahora**: Retorna:
  - `first_lider_identificacion`: Primer líder asignado
  - `lideres_asignados`: Array de IDs de todos los líderes asignados
  - Incluye información del primer líder con `first_lider_nombre` y `first_lider_apellido`

#### `POST /votantes`
- **Antes**: Requería `lider_identificacion` para asignar líder y rechazaba votantes duplicados
- **Ahora**:
  - **ACEPTA** `lider_identificacion` opcional
  - Si el votante **NO existe**: Lo crea y opcionalmente lo asigna al líder
  - Si el votante **YA existe**:
    - Si se proporciona `lider_identificacion`, crea la asignación (permite N:M)
    - Si no se proporciona líder, retorna información del votante existente
  - **Importante**: Ahora permite registrar el mismo votante múltiples veces con diferentes líderes
  - Para asignar líder también se puede usar `POST /asignaciones`

#### `PUT /votantes/:identificacion`
- **Antes**: Permitía modificar `lider_identificacion`
- **Ahora**:
  - Ya NO modifica asignaciones de líderes
  - Solo actualiza datos del votante
  - Para modificar líderes, usar endpoints de `/asignaciones`

#### `DELETE /votantes/:identificacion`
- **Antes**: Hard delete
- **Ahora**:
  - **Soft-delete**: Mueve a `votantes_eliminados`
  - Acepta `delete_reason` en el body
  - Dispara trigger que registra en logs

#### `POST /votantes/upload_csv`
- **Antes**: Insertaba votantes con `lider_identificacion` directo y rechazaba duplicados
- **Ahora**:
  - Si el votante **NO existe**: Lo crea y crea asignación
  - Si el votante **YA existe**: Solo crea la asignación si no existe (permite N:M)
  - Crea asignación en `votante_lider` (trigger setea `first_lider` automáticamente)
  - Retorna `votantes_insertados`, `asignaciones_insertadas`, `duplicados` y `errores`
  - **Permite cargar mismo votante con diferentes líderes**

#### `GET /votantes/buscar`
- **Ahora**: Retorna `first_lider_identificacion` y `lideres_asignados`

#### `GET /votantes/por-lider`
- **Ahora**: Usa JOIN con `votante_lider` en lugar de `votantes.lider_identificacion`

#### `GET /votantes/por-lider-detalle`
- **Ahora**: Usa JOIN con `votante_lider`

### Deprecated

#### `PUT /votantes/reasignar`
- **Status**: HTTP 410 (Gone)
- **Mensaje**: Usar `POST /asignaciones` y `DELETE /asignaciones`

---

## 3. ENDPOINTS DE LÍDERES

### Modificados

#### `DELETE /lideres/:cedula`
- **Antes**: Hard delete
- **Ahora**:
  - **Soft-delete**: Mueve a `lideres_eliminados`
  - Acepta `delete_reason` en el body
  - Dispara trigger que registra en logs

#### `PUT /lideres/:old_id`
- **Ahora**: Actualiza también referencias en:
  - `votante_lider.lider_identificacion`
  - `votantes.first_lider_identificacion`

#### `GET /lideres/distribution`
- **Ahora**: Usa `votante_lider` para contar votantes por líder

---

## 4. ENDPOINTS DE RECOMENDADOS

### Modificados

#### `DELETE /recomendados/:identificacion`
- **Antes**: Hard delete (con validación de líderes asociados)
- **Ahora**:
  - **Soft-delete**: Mueve a `recomendados_eliminados`
  - Acepta `delete_reason` en el body
  - Dispara trigger que registra en logs

#### `DELETE /recomendados/bulk`
- **Ahora**: Soft-delete masivo con `delete_reason`

---

## 5. NUEVOS ENDPOINTS: ASIGNACIONES (N:M)

### `POST /asignaciones`
- **Función**: Asignar votante a líder
- **Body**: `{ votante_identificacion, lider_identificacion }`
- **Efectos**:
  - Inserta en `votante_lider`
  - Trigger setea `first_lider_identificacion` si es primera asignación
  - Trigger crea incidencia si es asignación adicional

### `GET /asignaciones`
- **Función**: Listar asignaciones con filtros
- **Query params**: `votante_id`, `lider_id`
- **Retorna**: Asignaciones con info completa de votante, líder y usuario asignador

### `DELETE /asignaciones`
- **Función**: Desasignar votante de líder
- **Body**: `{ votante_identificacion, lider_identificacion }`
- **Efectos**: Trigger registra log UNASSIGN

---

## 6. NUEVOS ENDPOINTS: INCIDENCIAS

### `GET /incidencias`
- **Función**: Listar todas las incidencias
- **Query params**:
  - `tipo`: DUPLICIDAD_LIDER | OTRO
  - `votante_id`
  - `lider_id`
  - `desde`, `hasta`: Filtro por fecha

### `GET /votantes/:id/incidencias`
- **Función**: Incidencias de un votante específico

### `POST /incidencias`
- **Función**: Crear incidencia manual (tipo OTRO)
- **Body**:
  ```json
  {
    "tipo": "OTRO",
    "votante_identificacion": "...",
    "lider_anterior_identificacion": "...",
    "lider_nuevo_identificacion": "...",
    "detalle": "..."
  }
  ```

---

## 7. NUEVOS ENDPOINTS: LOGS

### `GET /logs`
- **Función**: Obtener logs de auditoría
- **Query params**:
  - `entidad`: lider | votante | recomendado | asignacion | incidencia
  - `accion`: CREATE | UPDATE | DELETE | ASSIGN | UNASSIGN | INCIDENT
  - `user_id`
  - `desde`, `hasta`: Filtro por fecha
  - `limit` (default: 100)
  - `offset` (default: 0)
- **Retorna**: Logs con detalles JSON parseados

---

## 8. NUEVOS ENDPOINTS: ELIMINADOS

### `GET /lideres/eliminados`
- **Función**: Listar líderes eliminados (soft-deleted)
- **Incluye**: Fecha, usuario y motivo de eliminación

### `GET /recomendados/eliminados`
- **Función**: Listar recomendados eliminados

### `GET /votantes/eliminados`
- **Función**: Listar votantes eliminados
- **Incluye**: `first_lider_identificacion`

---

## 9. NUEVOS ENDPOINTS: RELACIONES

### `GET /lideres/:id/votantes`
- **Función**: Obtener todos los votantes asociados a un líder
- **Incluye**: Fecha de asignación (`assigned_at`)

### `GET /votantes/:id/lideres`
- **Función**: Obtener todos los líderes asociados a un votante
- **Incluye**:
  - `assigned_at`: Fecha de asignación
  - `es_primer_lider`: Flag booleano (1 o 0)

---

## 10. ESTRUCTURA DE DATOS ACTUALIZADA

### Votante (Response)
```json
{
  "identificacion": "...",
  "nombre": "...",
  "apellido": "...",
  "first_lider_identificacion": "...",
  "first_lider_nombre": "...",
  "first_lider_apellido": "...",
  "lideres_asignados": ["lid1", "lid2", "lid3"]
}
```

### Asignación (Response)
```json
{
  "id": 123,
  "votante_identificacion": "...",
  "lider_identificacion": "...",
  "assigned_at": "2025-10-10T12:00:00Z",
  "assigned_by_user_id": 5,
  "votante_nombre": "...",
  "lider_nombre": "...",
  "assigned_by": "username"
}
```

### Incidencia (Response)
```json
{
  "id": 456,
  "tipo": "DUPLICIDAD_LIDER",
  "votante_identificacion": "...",
  "lider_anterior_identificacion": "...",
  "lider_nuevo_identificacion": "...",
  "detalle": "...",
  "created_at": "2025-10-10T12:00:00Z",
  "created_by_user_id": 5
}
```

### Log (Response)
```json
{
  "id": 789,
  "user_id": 5,
  "accion": "ASSIGN",
  "entidad": "asignacion",
  "entidad_id": "votante123->lider456",
  "detalles": {
    "votante": "...",
    "lider": "..."
  },
  "created_at": "2025-10-10T12:00:00Z"
}
```

---

## 11. TRIGGERS DE BASE DE DATOS

Los siguientes triggers están implementados y son usados automáticamente:

### Votantes
- `tr_votantes_after_insert`: Log CREATE
- `tr_votantes_after_update`: Log UPDATE
- `tr_votantes_before_delete`: Mueve a `votantes_eliminados` + log DELETE

### Líderes
- `tr_lideres_after_insert`: Log CREATE
- `tr_lideres_after_update`: Log UPDATE
- `tr_lideres_before_delete`: Mueve a `lideres_eliminados` + log DELETE

### Recomendados
- `tr_recomendados_before_delete`: Mueve a `recomendados_eliminados` + log DELETE

### Votante-Líder (Asignaciones)
- `tr_vl_after_insert`:
  - Setea `first_lider_identificacion` si es primera asignación
  - Crea incidencia si es asignación adicional
  - Log ASSIGN + log INCIDENT (si aplica)
- `tr_vl_before_delete`: Log UNASSIGN

---

## 12. COMPATIBILIDAD Y BREAKING CHANGES

### Breaking Changes

1. **POST /votantes**: Ahora acepta `lider_identificacion` opcional y permite votantes duplicados
2. **PUT /votantes/:id**: Ya no modifica líderes
3. **GET /votantes**: Cambió estructura de response (incluye arrays)
4. **PUT /votantes/reasignar**: Endpoint deprecated (410)
5. **DELETE endpoints**: Ahora requieren conexión con permisos para soft-delete
6. **Comportamiento de duplicados**: Los endpoints ahora permiten registrar el mismo votante con diferentes líderes (N:M)

### Nuevos headers requeridos (opcional)

- `x-user-id`: Para auditoría de acciones

### Cambios de comportamiento

- Todos los DELETE son ahora soft-delete
- Las asignaciones generan incidencias automáticas
- Los logs se generan automáticamente para todas las operaciones

---

## 13. GUÍA DE MIGRACIÓN PARA FRONTEND

### Antes
```javascript
// Crear votante con líder (rechazaba duplicados)
POST /votantes
{
  "identificacion": "123",
  "nombre": "Juan",
  "lider_identificacion": "LID001"
}
```

### Ahora (Opción 1 - Recomendada)
```javascript
// Crear votante con líder (permite duplicados y crea asignación automática)
POST /votantes
{
  "identificacion": "123",
  "nombre": "Juan",
  "lider_identificacion": "LID001"
}

// Si el votante ya existe, este endpoint crea la asignación al nuevo líder
POST /votantes
{
  "identificacion": "123",  // Mismo votante
  "nombre": "Juan",
  "lider_identificacion": "LID002"  // Diferente líder
}
// Retorna: { message: "Votante ya existe. Nueva asignación de líder creada con éxito" }
```

### Ahora (Opción 2 - Manual)
```javascript
// 1. Crear votante sin líder
POST /votantes
{
  "identificacion": "123",
  "nombre": "Juan"
}

// 2. Asignar líder(es) manualmente
POST /asignaciones
{
  "votante_identificacion": "123",
  "lider_identificacion": "LID001"
}

POST /asignaciones
{
  "votante_identificacion": "123",
  "lider_identificacion": "LID002"
}
```

### Antes
```javascript
// Cambiar líder de votante
PUT /votantes/123
{
  "lider_identificacion": "LID002"
}
```

### Ahora
```javascript
// 1. Agregar nuevo líder (sin eliminar el anterior)
POST /asignaciones
{
  "votante_identificacion": "123",
  "lider_identificacion": "LID002"
}

// 2. O desasignar líder anterior y asignar nuevo
DELETE /asignaciones
{
  "votante_identificacion": "123",
  "lider_identificacion": "LID001"
}

POST /asignaciones
{
  "votante_identificacion": "123",
  "lider_identificacion": "LID002"
}
```

---

## 14. TESTING

### Endpoints a probar

1. **Asignaciones N:M**
   - [ ] POST /asignaciones (primera asignación)
   - [ ] POST /asignaciones (asignación adicional - debe crear incidencia)
   - [ ] GET /asignaciones
   - [ ] DELETE /asignaciones

2. **Soft-delete**
   - [ ] DELETE /votantes/:id
   - [ ] DELETE /lideres/:id
   - [ ] DELETE /recomendados/:id
   - [ ] Verificar tablas _eliminados

3. **Logs**
   - [ ] GET /logs
   - [ ] Verificar logs después de CREATE
   - [ ] Verificar logs después de UPDATE
   - [ ] Verificar logs después de DELETE
   - [ ] Verificar logs después de ASSIGN

4. **Incidencias**
   - [ ] GET /incidencias
   - [ ] GET /votantes/:id/incidencias
   - [ ] POST /incidencias
   - [ ] Verificar incidencia automática al asignar segundo líder

---

## 15. NOTAS IMPORTANTES

1. **Variables de sesión MySQL**:
   - Asegurarse de enviar `x-user-id` en headers o `user_id` en body
   - Si no se envía, las operaciones funcionan pero sin auditoría de usuario

2. **Soft-delete**:
   - Los registros eliminados NO aparecen en consultas normales
   - Usar endpoints `/eliminados` para ver registros borrados
   - Los triggers manejan automáticamente el movimiento a tablas _eliminados

3. **Incidencias automáticas**:
   - Se crean automáticamente cuando un votante es asignado a un segundo líder
   - El primer líder siempre queda registrado en `first_lider_identificacion`

4. **Performance**:
   - Las consultas con GROUP_CONCAT pueden ser lentas con muchos líderes
   - Considerar paginación en endpoints de listado si hay gran volumen de datos

---

## Fecha de migración
**10 de octubre de 2025**

---

## ACTUALIZACIÓN MAYOR - 25 de octubre de 2025

### Nueva Arquitectura: Sistema de Staging con Capturas y Variantes

**Motivación:**
Implementar un sistema robusto de captura de datos que permita:
1. Auditoría total de lo reportado por cada líder (datos crudos)
2. Detección automática de duplicados consigo mismo (mismo líder, distintas versiones)
3. Detección de duplicados entre líderes
4. Detección de conflictos de datos (variantes vs canónico)
5. Trazabilidad completa para calidad de datos

---

### **CAMBIO CRÍTICO: POST /votantes YA NO acepta lider_identificacion**

**❌ Comportamiento anterior (23 de octubre):**
```javascript
POST /votantes { identificacion: "123", nombre: "Juan", lider_identificacion: "LID_A" }
// Esto funcionaba y creaba asignación
```

**✅ Nuevo comportamiento (25 de octubre):**
```javascript
POST /votantes { identificacion: "123", nombre: "Juan", lider_identificacion: "LID_A" }
// ERROR 400: "lider_identificacion no está permitido en este endpoint"
```

**Razón del cambio:**
- `POST /votantes` ahora es solo para crear votantes canónicos (maestro limpio)
- Las asignaciones deben hacerse mediante:
  - `POST /asignaciones` (asignación directa)
  - `POST /capturas` (ingesta con staging, **RECOMENDADO**)

---

### Nuevas Tablas Implementadas

#### 1. `capturas_votante` (staging crudo)
Almacena exactamente lo que reporta cada líder, sin validar contra el canónico.

**Campos clave:**
- `lider_identificacion`: Quién reporta
- `identificacion_reportada`: Cédula reportada
- `nombre_reportado`, `apellido_reportado`, etc.: Datos tal cual los reportó el líder
- `hash_datos`: Hash MD5 para detectar duplicados exactos
- `canonical_identificacion`: FK al votante canónico (se llena automáticamente por trigger)
- `estado`: ENUM('nuevo','resuelto','rechazado','fusionado')

**UNIQUE constraint:** `(lider_identificacion, identificacion_reportada, hash_datos)`
- Impide que un líder reporte exactamente los mismos datos dos veces

#### 2. `votante_variantes` (foto consolidada por líder)
Foto de cómo cada líder ve a cada votante canónico.

**Campos clave:**
- `canonical_identificacion`: FK al votante canónico
- `lider_identificacion`: Líder que reportó esta versión
- `captura_id`: FK a la captura original
- Copia de todos los datos reportados
- `is_current`: Flag si es la variante actual (última reportada)

**UNIQUE constraint:** `(canonical_identificacion, lider_identificacion, hash_datos)`

#### 3. `incidencias` (ampliada)
Nuevos tipos de incidencias:
- `DUPLICIDAD_LIDER`: Votante asignado a múltiples líderes (ya existía)
- `DUPLICIDAD_CON_SI_MISMO`: ⭐ **NUEVO** - Líder reportó mismo votante con datos diferentes
- `CONFLICTO_DATOS`: ⭐ **NUEVO** - Datos reportados difieren del canónico
- `OTRO`: Incidencias manuales

---

### Nuevos Endpoints Implementados

#### **POST /capturas** (⭐ ENDPOINT PRINCIPAL para ingesta)
Ingesta de datos reportados por líderes con procesamiento automático.

**Request:**
```javascript
POST /capturas
{
  "lider_identificacion": "LID001",
  "identificacion_reportada": "123456",
  "nombre_reportado": "JUAN",
  "apellido_reportado": "PEREZ",
  "departamento_reportado": "CUNDINAMARCA",
  "ciudad_reportada": "BOGOTA",
  // ... más campos opcionales
}
```

**Response:**
```javascript
{
  "message": "Captura procesada con éxito",
  "captura_id": 45,
  "canonical_identificacion": "123456",
  "estado": "resuelto",
  "incidencias_generadas": [
    { "tipo": "DUPLICIDAD_CON_SI_MISMO", "detalle": "..." },
    { "tipo": "CONFLICTO_DATOS", "detalle": "..." }
  ]
}
```

**Procesamiento automático (trigger `tr_capturas_after_insert`):**
1. Crea votante canónico si no existe
2. Crea asignación N:M en `votante_lider`
3. Crea/actualiza variante en `votante_variantes`
4. Genera incidencias automáticas:
   - `DUPLICIDAD_CON_SI_MISMO`: Si líder ya reportó este votante con datos distintos
   - `DUPLICIDAD_LIDER`: Si votante ya está asignado a otro líder
   - `CONFLICTO_DATOS`: Si datos difieren del canónico

#### **GET /capturas**
Consultar capturas crudas con filtros.

**Query params:**
- `estado`: nuevo|resuelto|rechazado|fusionado
- `lider`: ID del líder
- `cc`: Cédula reportada
- `desde`, `hasta`: Rango de fechas
- `limit`, `offset`: Paginación

#### **GET /variantes**
Consultar variantes (foto por líder).

**Query params:**
- `cc`: Cédula canónica
- `lider`: ID del líder
- `current`: 0|1 (solo variantes actuales)
- `desde`, `hasta`: Rango de fechas

#### **GET /variantes/metricas**
Métricas de calidad de datos por líder.

**Response:**
```javascript
{
  "metricas_por_lider": [
    {
      "lider_identificacion": "LID001",
      "votantes_reales": 150,
      "total_variantes": 175,
      "duplicados_con_si_mismo": 25
    }
  ],
  "duplicados_entre_lideres": {
    "total": 30,
    "casos": [...]
  }
}
```

---

### Endpoints Modificados

#### **POST /votantes**
- ❌ **YA NO acepta** `lider_identificacion`
- ✅ Solo crea votante canónico
- Rechaza con error 400 si se envía `lider_identificacion`
- Mensaje de error incluye endpoints válidos para asignaciones

#### **POST /votantes/upload_csv**
- ⭐ **Ahora usa `capturas_votante`** en lugar de insertar directo
- Aprovecha triggers automáticos para procesar
- Detecta duplicados exactos por líder
- Genera incidencias automáticas
- Retorna métricas de calidad de datos

**Response actualizado:**
```javascript
{
  "message": "Carga masiva procesada con éxito usando sistema de capturas (staging)",
  "total_filas": 1000,
  "capturas_insertadas": 980,
  "duplicados_exactos": 15,
  "errores": 5,
  "nota": "Consulte GET /incidencias para ver duplicidades y conflictos detectados"
}
```

---

### Flujo de Trabajo Recomendado

#### **Opción A: Ingesta con Staging (RECOMENDADO)**
```javascript
// Cada líder reporta sus datos tal cual
POST /capturas {
  lider_identificacion: "LID001",
  identificacion_reportada: "123",
  nombre_reportado: "JUAN CARLOS",  // Como lo conoce el líder
  apellido_reportado: "PEREZ GOMEZ",
  // ...
}

// El sistema automáticamente:
// 1. Crea/actualiza canónico
// 2. Crea asignación N:M
// 3. Guarda variante por líder
// 4. Detecta y registra incidencias
```

#### **Opción B: Asignación Directa (para casos manuales)**
```javascript
// 1. Crear votante canónico (si no existe)
POST /votantes { identificacion: "123", nombre: "JUAN", apellido: "PEREZ" }

// 2. Asignar a líder
POST /asignaciones { votante_identificacion: "123", lider_identificacion: "LID001" }
```

---

### Beneficios de la Nueva Arquitectura

1. **Auditoría Total:** Todo lo reportado queda registrado en `capturas_votante`
2. **Calidad de Datos:** Detección automática de:
   - Duplicados exactos (mismo líder, mismos datos)
   - Duplicados con variación (mismo líder, datos distintos)
   - Duplicados entre líderes
   - Conflictos de datos (vs canónico)
3. **Métricas:** Conteo real de votantes por líder (descontando duplicados)
4. **Trazabilidad:** Historial completo de variantes y cambios
5. **Reversibilidad:** Staging permite análisis antes de consolidar

---

### Breaking Changes Resumen

| Endpoint | Antes (23 oct) | Ahora (25 oct) |
|----------|----------------|----------------|
| `POST /votantes` | Aceptaba `lider_identificacion` | ❌ Rechaza `lider_identificacion` |
| `POST /votantes/upload_csv` | Insertaba directo en `votantes` | ✅ Usa `capturas_votante` |
| `GET /incidencias` | Solo `DUPLICIDAD_LIDER` | ✅ Incluye `DUPLICIDAD_CON_SI_MISMO`, `CONFLICTO_DATOS` |

---

### Migración desde versión anterior

Si estaban usando:
```javascript
// ESTO YA NO FUNCIONA ❌
POST /votantes { identificacion: "123", nombre: "Juan", lider_identificacion: "LID001" }
```

Ahora deben usar:
```javascript
// OPCIÓN 1: Ingesta con staging (recomendado) ✅
POST /capturas {
  lider_identificacion: "LID001",
  identificacion_reportada: "123",
  nombre_reportado: "Juan",
  // ...
}

// OPCIÓN 2: Manual (dos pasos) ✅
POST /votantes { identificacion: "123", nombre: "Juan" }
POST /asignaciones { votante_identificacion: "123", lider_identificacion: "LID001" }
```
