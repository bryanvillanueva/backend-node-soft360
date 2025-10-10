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
- **Antes**: Requería `lider_identificacion` para asignar líder
- **Ahora**:
  - Ya NO acepta `lider_identificacion`
  - Crear votante SIN asignar líder
  - Para asignar líder, usar `POST /asignaciones`

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
- **Antes**: Insertaba votantes con `lider_identificacion` directo
- **Ahora**:
  - Crea votante sin `lider_identificacion`
  - Crea asignación en `votante_lider` (trigger setea `first_lider` automáticamente)
  - Retorna `votantes_insertados` y `asignaciones_insertadas`

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

1. **POST /votantes**: Ya no acepta `lider_identificacion`
2. **PUT /votantes/:id**: Ya no modifica líderes
3. **GET /votantes**: Cambió estructura de response (incluye arrays)
4. **PUT /votantes/reasignar**: Endpoint deprecated (410)
5. **DELETE endpoints**: Ahora requieren conexión con permisos para soft-delete

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
// Crear votante con líder
POST /votantes
{
  "identificacion": "123",
  "nombre": "Juan",
  "lider_identificacion": "LID001"
}
```

### Ahora
```javascript
// 1. Crear votante
POST /votantes
{
  "identificacion": "123",
  "nombre": "Juan"
}

// 2. Asignar líder
POST /asignaciones
{
  "votante_identificacion": "123",
  "lider_identificacion": "LID001"
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
