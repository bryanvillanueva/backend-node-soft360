# API Reference - Backend Soft360

## Tabla de Contenidos
1. [Autenticación y Headers](#autenticación-y-headers)
2. [Asignaciones (N:M)](#asignaciones-nm)
3. [Incidencias](#incidencias)
4. [Logs de Auditoría](#logs-de-auditoría)
5. [Registros Eliminados](#registros-eliminados)
6. [Relaciones](#relaciones)
7. [Ejemplos de Uso](#ejemplos-de-uso)

---

## Autenticación y Headers

### Header recomendado
```
x-user-id: <ID_USUARIO>
```

Este header es **opcional** pero **altamente recomendado** para:
- Auditoría completa en logs
- Rastreo de quién realizó cada acción
- Registrar quién asignó/desasignó votantes

---

## Asignaciones (N:M)

### Asignar votante a líder
```http
POST /asignaciones
Content-Type: application/json
x-user-id: 5

{
  "votante_identificacion": "123456789",
  "lider_identificacion": "LID001"
}
```

**Response 201:**
```json
{
  "message": "Asignación creada con éxito",
  "votante_identificacion": "123456789",
  "lider_identificacion": "LID001"
}
```

**Efectos automáticos:**
- Si es primera asignación: Setea `votantes.first_lider_identificacion`
- Si es asignación adicional: Crea incidencia de tipo `DUPLICIDAD_LIDER`
- Registra log de acción `ASSIGN`

---

### Listar asignaciones

```http
GET /asignaciones?votante_id=123456789
```

**Query params opcionales:**
- `votante_id`: Filtrar por votante
- `lider_id`: Filtrar por líder

**Response 200:**
```json
[
  {
    "id": 1,
    "votante_identificacion": "123456789",
    "lider_identificacion": "LID001",
    "assigned_at": "2025-10-10T10:30:00.000Z",
    "assigned_by_user_id": 5,
    "votante_nombre": "JUAN",
    "votante_apellido": "PEREZ",
    "lider_nombre": "MARIA",
    "lider_apellido": "GOMEZ",
    "assigned_by": "admin"
  }
]
```

---

### Desasignar votante de líder

```http
DELETE /asignaciones
Content-Type: application/json
x-user-id: 5

{
  "votante_identificacion": "123456789",
  "lider_identificacion": "LID001"
}
```

**Response 200:**
```json
{
  "message": "Asignación eliminada con éxito"
}
```

**Efectos automáticos:**
- Registra log de acción `UNASSIGN`

---

## Incidencias

### Listar incidencias

```http
GET /incidencias?tipo=DUPLICIDAD_LIDER&desde=2025-10-01
```

**Query params opcionales:**
- `tipo`: `DUPLICIDAD_LIDER` | `OTRO`
- `votante_id`: Filtrar por votante
- `lider_id`: Filtrar por líder (anterior o nuevo)
- `desde`: Fecha inicio (YYYY-MM-DD)
- `hasta`: Fecha fin (YYYY-MM-DD)

**Response 200:**
```json
[
  {
    "id": 1,
    "tipo": "DUPLICIDAD_LIDER",
    "votante_identificacion": "123456789",
    "lider_anterior_identificacion": "LID001",
    "lider_nuevo_identificacion": "LID002",
    "detalle": "Votante asociado a un nuevo líder además del primero.",
    "created_at": "2025-10-10T11:00:00.000Z",
    "created_by_user_id": 5,
    "votante_nombre": "JUAN",
    "votante_apellido": "PEREZ",
    "lider_anterior_nombre": "MARIA",
    "lider_anterior_apellido": "GOMEZ",
    "lider_nuevo_nombre": "PEDRO",
    "lider_nuevo_apellido": "LOPEZ",
    "created_by": "admin"
  }
]
```

---

### Incidencias de un votante

```http
GET /votantes/123456789/incidencias
```

**Response 200:**
```json
[
  {
    "id": 1,
    "tipo": "DUPLICIDAD_LIDER",
    "lider_anterior_identificacion": "LID001",
    "lider_nuevo_identificacion": "LID002",
    "detalle": "Votante asociado a un nuevo líder además del primero.",
    "created_at": "2025-10-10T11:00:00.000Z",
    "lider_anterior_nombre": "MARIA",
    "lider_anterior_apellido": "GOMEZ",
    "lider_nuevo_nombre": "PEDRO",
    "lider_nuevo_apellido": "LOPEZ"
  }
]
```

---

### Crear incidencia manual

```http
POST /incidencias
Content-Type: application/json
x-user-id: 5

{
  "tipo": "OTRO",
  "votante_identificacion": "123456789",
  "lider_anterior_identificacion": "LID001",
  "lider_nuevo_identificacion": "LID002",
  "detalle": "El votante reportó error en su registro"
}
```

**Response 201:**
```json
{
  "message": "Incidencia creada con éxito"
}
```

---

## Logs de Auditoría

### Listar logs

```http
GET /logs?entidad=votante&accion=CREATE&limit=50&offset=0
```

**Query params opcionales:**
- `entidad`: `lider` | `votante` | `recomendado` | `asignacion` | `incidencia`
- `accion`: `CREATE` | `UPDATE` | `DELETE` | `ASSIGN` | `UNASSIGN` | `INCIDENT`
- `user_id`: Filtrar por usuario
- `desde`: Fecha inicio
- `hasta`: Fecha fin
- `limit`: Cantidad de registros (default: 100)
- `offset`: Offset para paginación (default: 0)

**Response 200:**
```json
[
  {
    "id": 1,
    "user_id": 5,
    "accion": "CREATE",
    "entidad": "votante",
    "entidad_id": "123456789",
    "detalles": {
      "nombre": "JUAN",
      "apellido": "PEREZ"
    },
    "ip": null,
    "user_agent": null,
    "created_at": "2025-10-10T10:00:00.000Z",
    "username": "admin"
  },
  {
    "id": 2,
    "user_id": 5,
    "accion": "ASSIGN",
    "entidad": "asignacion",
    "entidad_id": "123456789->LID001",
    "detalles": {
      "votante": "123456789",
      "lider": "LID001"
    },
    "ip": null,
    "user_agent": null,
    "created_at": "2025-10-10T10:30:00.000Z",
    "username": "admin"
  }
]
```

---

## Registros Eliminados

### Líderes eliminados

```http
GET /lideres/eliminados
```

**Response 200:**
```json
[
  {
    "identificacion": "LID999",
    "nombre": "CARLOS",
    "apellido": "MARTINEZ",
    "departamento": "ATLÁNTICO",
    "ciudad": "BARRANQUILLA",
    "barrio": "CENTRO",
    "direccion": "CALLE 50 #30-20",
    "celular": "3001234567",
    "email": "CARLOS@EXAMPLE.COM",
    "recomendado_identificacion": "REC001",
    "objetivo": 100,
    "deleted_at": "2025-10-10T12:00:00.000Z",
    "deleted_by": 5,
    "deleted_reason": "Duplicado",
    "deleted_by_username": "admin"
  }
]
```

---

### Recomendados eliminados

```http
GET /recomendados/eliminados
```

**Response 200:**
```json
[
  {
    "identificacion": "REC999",
    "nombre": "ANA",
    "apellido": "GARCIA",
    "departamento": "ATLÁNTICO",
    "ciudad": "BARRANQUILLA",
    "barrio": "NORTE",
    "direccion": "CALLE 80 #40-10",
    "celular": "3009876543",
    "email": "ANA@EXAMPLE.COM",
    "grupo_id": 1,
    "deleted_at": "2025-10-10T12:30:00.000Z",
    "deleted_by": 5,
    "deleted_reason": "Error de registro",
    "deleted_by_username": "admin"
  }
]
```

---

### Votantes eliminados

```http
GET /votantes/eliminados
```

**Response 200:**
```json
[
  {
    "identificacion": "123456789",
    "nombre": "LUIS",
    "apellido": "RODRIGUEZ",
    "departamento": "ATLÁNTICO",
    "ciudad": "BARRANQUILLA",
    "barrio": "SUR",
    "direccion": "CALLE 30 #20-15",
    "zona": "ZONA 1",
    "puesto": "PUESTO 5",
    "mesa": "MESA 10",
    "direccion_puesto": "COLEGIO ABC",
    "celular": "3005551234",
    "email": "LUIS@EXAMPLE.COM",
    "first_lider_identificacion": "LID001",
    "deleted_at": "2025-10-10T13:00:00.000Z",
    "deleted_by": 5,
    "deleted_reason": "Fallecido",
    "deleted_by_username": "admin"
  }
]
```

---

## Relaciones

### Votantes de un líder

```http
GET /lideres/LID001/votantes
```

**Response 200:**
```json
[
  {
    "identificacion": "123456789",
    "nombre": "JUAN",
    "apellido": "PEREZ",
    "departamento": "ATLÁNTICO",
    "ciudad": "BARRANQUILLA",
    "barrio": "CENTRO",
    "direccion": "CALLE 50 #30-20",
    "celular": "3001234567",
    "email": "JUAN@EXAMPLE.COM",
    "assigned_at": "2025-10-10T10:30:00.000Z"
  }
]
```

---

### Líderes de un votante

```http
GET /votantes/123456789/lideres
```

**Response 200:**
```json
[
  {
    "identificacion": "LID001",
    "nombre": "MARIA",
    "apellido": "GOMEZ",
    "departamento": "ATLÁNTICO",
    "ciudad": "BARRANQUILLA",
    "barrio": "NORTE",
    "celular": "3009876543",
    "email": "MARIA@EXAMPLE.COM",
    "objetivo": 50,
    "assigned_at": "2025-10-10T10:30:00.000Z",
    "es_primer_lider": 1
  },
  {
    "identificacion": "LID002",
    "nombre": "PEDRO",
    "apellido": "LOPEZ",
    "departamento": "ATLÁNTICO",
    "ciudad": "BARRANQUILLA",
    "barrio": "SUR",
    "celular": "3005551234",
    "email": "PEDRO@EXAMPLE.COM",
    "objetivo": 75,
    "assigned_at": "2025-10-10T11:00:00.000Z",
    "es_primer_lider": 0
  }
]
```

**Nota:** `es_primer_lider` es `1` si es el primer líder asignado, `0` si no.

---

## Ejemplos de Uso

### Escenario 1: Crear votante y asignarle un líder

```bash
# 1. Crear votante
curl -X POST http://localhost:3000/votantes \
  -H "Content-Type: application/json" \
  -H "x-user-id: 5" \
  -d '{
    "identificacion": "987654321",
    "nombre": "Ana",
    "apellido": "Martinez",
    "departamento": "Atlántico",
    "ciudad": "Barranquilla",
    "barrio": "Centro",
    "direccion": "Calle 50 #30-20",
    "celular": "3001234567",
    "email": "ana@example.com"
  }'

# 2. Asignar líder
curl -X POST http://localhost:3000/asignaciones \
  -H "Content-Type: application/json" \
  -H "x-user-id: 5" \
  -d '{
    "votante_identificacion": "987654321",
    "lider_identificacion": "LID001"
  }'
```

---

### Escenario 2: Asignar segundo líder (genera incidencia automática)

```bash
# Asignar segundo líder
curl -X POST http://localhost:3000/asignaciones \
  -H "Content-Type: application/json" \
  -H "x-user-id: 5" \
  -d '{
    "votante_identificacion": "987654321",
    "lider_identificacion": "LID002"
  }'

# Verificar incidencias del votante
curl http://localhost:3000/votantes/987654321/incidencias
```

---

### Escenario 3: Ver todos los líderes de un votante

```bash
curl http://localhost:3000/votantes/987654321/lideres
```

---

### Escenario 4: Ver todos los votantes de un líder

```bash
curl http://localhost:3000/lideres/LID001/votantes
```

---

### Escenario 5: Eliminar votante (soft-delete)

```bash
curl -X DELETE http://localhost:3000/votantes/987654321 \
  -H "Content-Type: application/json" \
  -H "x-user-id: 5" \
  -d '{
    "delete_reason": "Duplicado"
  }'

# Verificar en eliminados
curl http://localhost:3000/votantes/eliminados
```

---

### Escenario 6: Auditar acciones de un usuario

```bash
# Ver todas las acciones del usuario 5
curl "http://localhost:3000/logs?user_id=5&limit=100"

# Ver solo asignaciones realizadas hoy
curl "http://localhost:3000/logs?accion=ASSIGN&desde=2025-10-10"
```

---

### Escenario 7: Buscar incidencias de duplicidad

```bash
# Ver todas las incidencias de duplicidad de líder
curl "http://localhost:3000/incidencias?tipo=DUPLICIDAD_LIDER"

# Ver incidencias de un líder específico
curl "http://localhost:3000/incidencias?lider_id=LID001"
```

---

## Códigos de Estado HTTP

- **200 OK**: Solicitud exitosa
- **201 Created**: Recurso creado exitosamente
- **400 Bad Request**: Error en parámetros enviados
- **404 Not Found**: Recurso no encontrado
- **410 Gone**: Endpoint deprecated
- **500 Internal Server Error**: Error del servidor

---

## Notas Importantes

1. **Soft-delete**: Todos los DELETE son reversibles ya que mueven a tablas `_eliminados`
2. **Incidencias automáticas**: Se crean automáticamente al asignar segundo líder
3. **Logs automáticos**: Todas las operaciones CUD generan logs automáticos
4. **First leader**: El primer líder asignado queda registrado permanentemente en `first_lider_identificacion`
5. **Headers**: Aunque `x-user-id` es opcional, es muy recomendado para auditoría completa
