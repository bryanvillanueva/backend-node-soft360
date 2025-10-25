const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mysql = require('mysql2/promise');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware para setear variables de sesión MySQL
app.use(async (req, res, next) => {
  try {
    // Obtener user_id del header o body (ajustar según tu autenticación)
    const userId = req.headers['x-user-id'] || req.body.user_id || null;

    // Guardar en req para uso posterior
    req.userId = userId;

    // Setear variable de sesión MySQL si existe userId
    if (userId) {
      await db.execute('SET @current_user_id = ?', [userId]);
    } else {
      await db.execute('SET @current_user_id = NULL');
    }

    next();
  } catch (error) {
    console.error('Error en middleware de sesión:', error);
    next(); // Continuar aunque falle (para mantener compatibilidad)
  }
});

// Configuración de multer para uploads
const uploadDir = process.env.UPLOAD_DIR || 'data';
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage: storage });

// Configuración de la base de datos principal usando variables de entorno
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
};

const db = mysql.createPool(dbConfig);

// ==============================
//        GRUPOS
// ==============================


// Crear un nuevo grupo
app.post('/grupos', async (req, res) => {
  const { nombre, descripcion = null } = req.body;
  try {
    const [result] = await db.execute(
      'INSERT INTO grupos (nombre, descripcion) VALUES (?, ?)',
      [nombre, descripcion]
    );
    res.json({ id: result.insertId, nombre, descripcion });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// listar los grupos
app.get('/grupos', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, nombre, descripcion, created_at, updated_at
       FROM grupos
       ORDER BY id DESC`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener total de grupos - MOVER AQUÍ
app.get('/grupos/total', async (req, res) => {
  const [rows] = await db.execute('SELECT COUNT(*) AS total FROM grupos');
  res.json(rows[0]);
});

// ver detalles de un grupo específico - DESPUÉS de las rutas específicas
app.get('/grupos/:id', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, nombre, descripcion, created_at, updated_at
       FROM grupos
       WHERE id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Grupo no encontrado' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// eliminar un grupo sin eliminar sus recomendados
app.delete('/grupos/:id', async (req, res) => {
  try {
    const [result] = await db.execute('DELETE FROM grupos WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Grupo no encontrado' });
    res.json({ message: 'Grupo eliminado con éxito' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar nombre o descripción de un grupo
app.put('/grupos/:id', async (req, res) => {
  const { nombre, descripcion } = req.body;
  await db.execute(
    `UPDATE grupos SET nombre = ?, descripcion = ? WHERE id = ?`,
    [nombre, descripcion, req.params.id]
  );
  res.json({ message: 'Grupo actualizado con éxito' });
});

// Obtener recomendados de un grupo
app.get('/grupos/:id/recomendados', async (req, res) => {
  const grupoId = req.params.id;
  const [rows] = await db.execute(
    `SELECT r.identificacion, r.nombre, r.apellido, r.celular, r.email
     FROM recomendados r
     WHERE r.grupo_id = ?`,
    [grupoId]
  );
  res.json(rows);
});

// Agregar un recomendado a un grupo
app.post('/grupos/:id/recomendados', async (req, res) => {
  const grupoId = req.params.id;
  const { recomendado_identificacion } = req.body;

  await db.execute(
    `UPDATE recomendados SET grupo_id = ? WHERE identificacion = ?`,
    [grupoId, recomendado_identificacion]
  );

  res.json({ message: 'Recomendado agregado al grupo' });
});


// Eliminar un recomendado de un grupo
app.delete('/grupos/:id/recomendados/:recomendadoId', async (req, res) => {
  const { id, recomendadoId } = req.params;

  await db.execute(
    `UPDATE recomendados SET grupo_id = NULL WHERE grupo_id = ? AND identificacion = ?`,
    [id, recomendadoId]
  );

  res.json({ message: 'Recomendado eliminado del grupo' });
});

// Obtener recomendados con sus líderes de un grupo
app.get('/grupos/:id/recomendados-lideres', async (req, res) => {
  const grupoId = req.params.id;
  const [rows] = await db.execute(
    `SELECT r.identificacion AS recomendado_id, r.nombre AS recomendado_nombre,
            l.identificacion AS lider_id, l.nombre AS lider_nombre, l.apellido AS lider_apellido
     FROM recomendados r
     LEFT JOIN lideres l ON l.recomendado_identificacion = r.identificacion
     WHERE r.grupo_id = ?
     ORDER BY r.identificacion`,
    [grupoId]
  );
  res.json(rows);
});

// Obtener estructura completa de un grupo (recomendados, líderes y votantes) - con nueva estructura N:M
app.get('/grupos/:id/completo', async (req, res) => {
  const grupoId = req.params.id;
  const [rows] = await db.execute(
    `SELECT
        r.identificacion AS recomendado_id, r.nombre AS recomendado_nombre,
        l.identificacion AS lider_id, l.nombre AS lider_nombre, l.apellido AS lider_apellido,
        v.identificacion AS votante_id, v.nombre AS votante_nombre, v.apellido AS votante_apellido
     FROM recomendados r
     LEFT JOIN lideres l ON l.recomendado_identificacion = r.identificacion
     LEFT JOIN votante_lider vl ON vl.lider_identificacion = l.identificacion
     LEFT JOIN votantes v ON v.identificacion = vl.votante_identificacion
     WHERE r.grupo_id = ?
     ORDER BY r.identificacion, l.identificacion, v.identificacion`,
    [grupoId]
  );
  res.json(rows);
});

// ==============================
//        RECOMENDADOS
// ==============================

// GET /recomendados - Obtener todos los recomendados
app.get('/recomendados', async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT identificacion, nombre, apellido, departamento, ciudad, barrio, direccion, celular, email FROM recomendados'
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /recomendados/total - Obtener total de recomendados
app.get('/recomendados/total', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT COUNT(*) as total FROM recomendados');

    res.json({
      total: rows[0].total,
      trend: 'equal' // Placeholder para lógica de tendencia
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// obtener recomendados por búsqueda (cualquier campo)
app.get('/recomendados/buscar', async (req, res) => {
  const query = `%${req.query.query}%`;
  const [rows] = await db.execute(
    `SELECT identificacion, nombre, apellido, celular, email, grupo_id
     FROM recomendados
     WHERE identificacion LIKE ? OR nombre LIKE ? OR apellido LIKE ? OR celular LIKE ? OR email LIKE ?`,
    [query, query, query, query, query]
  );
  res.json(rows);
});


// GET /recomendados/:cedula - Obtener recomendado por cédula
app.get('/recomendados/:cedula', async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT identificacion, nombre, apellido FROM recomendados WHERE identificacion = ?',
      [req.params.cedula]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Recomendado no encontrado' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// POST /recomendados - Crear nuevo recomendado
app.post('/recomendados', async (req, res) => {
  try {
    const { 
      identificacion, 
      nombre = '', 
      apellido = '', 
      departamento = '',
      ciudad = '',
      barrio = '',
      direccion = '',
      celular = '', 
      email = '', 
      grupo_id = null 
    } = req.body;
    
    // Verificar si ya existe
    const [existing] = await db.execute(
      'SELECT COUNT(*) as count FROM recomendados WHERE identificacion = ?',
      [identificacion]
    );

    if (existing[0].count > 0) {
      return res.status(400).json({ error: 'El recomendado ya existe' });
    }

    // Insertar nuevo recomendado con todos los campos
    await db.execute(
      'INSERT INTO recomendados (identificacion, nombre, apellido, departamento, ciudad, barrio, direccion, celular, email, grupo_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        identificacion, 
        nombre.toUpperCase(), 
        apellido.toUpperCase(), 
        departamento.toUpperCase(),
        ciudad.toUpperCase(),
        barrio.toUpperCase(),
        direccion.toUpperCase(),
        celular.toUpperCase(), 
        email.toUpperCase(),
        grupo_id
      ]
    );
    
    res.status(201).json({ message: 'Recomendado creado con éxito' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /recomendados/:old_id - Actualizar recomendado
app.put('/recomendados/:old_id', async (req, res) => {
  const connection = await db.getConnection();
  try {
    const oldId = req.params.old_id;
    const { 
      identificacion: newId,
      nombre = '',
      apellido = '',
      departamento = '',
      ciudad = '',
      barrio = '',
      celular = '',
      direccion = '',
      email = '',
      grupo_id = null
    } = req.body;
    
    await connection.beginTransaction();

    // Verificar que existe
    const [existing] = await connection.execute(
      'SELECT COUNT(*) as count FROM recomendados WHERE identificacion = ?',
      [oldId]
    );
    
    if (existing[0].count === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'El recomendado no existe' });
    }
    
    // Actualizar recomendado con todos los campos
    await connection.execute(
      `UPDATE recomendados 
       SET identificacion = ?, nombre = ?, apellido = ?, departamento = ?, ciudad = ?, barrio = ?, direccion = ?,
           celular = ?, email = ?, grupo_id = ?
       WHERE identificacion = ?`,
      [
        newId, 
        nombre.toUpperCase(), 
        apellido.toUpperCase(), 
        departamento.toUpperCase(),
        ciudad.toUpperCase(),
        barrio.toUpperCase(),
        direccion.toUpperCase(),
        celular.toUpperCase(), 
        email.toUpperCase(),
        grupo_id,
        oldId
      ]
    );

    // Si también existe como líder, actualizar sus datos
    await connection.execute(
      `UPDATE lideres
       SET identificacion = ?, nombre = ?, apellido = ?, departamento = ?, ciudad = ?, barrio = ?, direccion = ?,
           celular = ?, email = ?
       WHERE identificacion = ?`,
      [
        newId, 
        nombre.toUpperCase(), 
        apellido.toUpperCase(), 
        departamento.toUpperCase(),
        ciudad.toUpperCase(),
        barrio.toUpperCase(),
        direccion.toUpperCase(),
        celular.toUpperCase(), 
        email.toUpperCase(), 
        oldId
      ]
    );

    // Si cambió el ID, actualizar referencias en líderes
    if (oldId !== newId) {
      await connection.execute(
        'UPDATE lideres SET recomendado_identificacion = ? WHERE recomendado_identificacion = ?',
        [newId, oldId]
      );
    }

    await connection.commit();
    res.json({ message: 'Recomendado (y líder si aplica) actualizado con éxito' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// DELETE /recomendados/:identificacion - Eliminar recomendado (soft-delete)
app.delete('/recomendados/:identificacion', async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { identificacion } = req.params;
    const { delete_reason } = req.body;

    await connection.beginTransaction();

    // Verificar que existe
    const [existing] = await connection.execute(
      'SELECT COUNT(*) as count FROM recomendados WHERE identificacion = ?',
      [identificacion]
    );

    if (existing[0].count === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'El recomendado no existe' });
    }

    // Setear variable de sesión para el motivo de eliminación
    await connection.execute('SET @delete_reason = ?', [delete_reason || 'Sin motivo especificado']);

    // Soft-delete: el trigger se encargará de mover a recomendados_eliminados
    await connection.execute(
      'DELETE FROM recomendados WHERE identificacion = ?',
      [identificacion]
    );

    await connection.commit();
    res.json({ message: 'Recomendado eliminado con éxito (soft-delete)' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// DELETE /recomendados/bulk - Borrado masivo de recomendados (soft-delete)
app.delete('/recomendados/bulk', async (req, res) => {
  const { ids, delete_reason } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Se requiere un array "ids" con al menos un ID' });
  }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Setear variable de sesión para el motivo de eliminación
    await connection.execute('SET @delete_reason = ?', [delete_reason || 'Eliminación masiva']);

    // Soft-delete: el trigger se encargará de mover a recomendados_eliminados
    const [result] = await connection.query(
      'DELETE FROM recomendados WHERE identificacion IN (?)',
      [ids]
    );

    await connection.commit();
    res.json({ deleted: result.affectedRows });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});


// ==============================
//          LÍDERES
// ==============================

// GET /lideres - Obtener todos los líderes
app.get('/lideres', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT
        l.identificacion AS lider_identificacion,
        l.nombre AS lider_nombre,
        l.apellido AS lider_apellido,
        l.departamento AS lider_departamento,
        l.ciudad AS lider_ciudad,
        l.barrio AS lider_barrio,
        l.direccion AS lider_direccion,
        l.celular AS lider_celular,
        l.email AS lider_email,
        l.objetivo AS lider_objetivo,
        r.identificacion AS recomendado_identificacion,
        r.nombre AS recomendado_nombre,
        r.apellido AS recomendado_apellido
       FROM lideres l
       LEFT JOIN recomendados r ON l.recomendado_identificacion = r.identificacion`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET 2) /lideres/buscar?query=texto - Buscar líderes por cualquier campo
app.get('/lideres/buscar', async (req, res) => {
  const query = `%${req.query.query}%`;
  try {
    const [rows] = await db.execute(
      `SELECT l.identificacion, l.nombre, l.apellido, l.celular, l.email,
              l.recomendado_identificacion, r.nombre AS recomendado_nombre
       FROM lideres l
       LEFT JOIN recomendados r ON r.identificacion = l.recomendado_identificacion
       WHERE l.identificacion LIKE ?
          OR l.nombre LIKE ?
          OR l.apellido LIKE ?
          OR l.celular LIKE ?
          OR l.email LIKE ?`,
      [query, query, query, query, query]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET 3) /lideres/por-recomendado - Obtener líderes por recomendado
app.get('/lideres/por-recomendado', async (req, res) => {
  try {
    const { recomendado } = req.query;
    if (!recomendado) {
      return res.status(400).json({ error: 'Se requiere la cédula del recomendado' });
    }
    const [rows] = await db.execute(
      `SELECT identificacion AS lider_identificacion,
              nombre AS lider_nombre,
              apellido AS lider_apellido,
              celular AS lider_celular,
              email AS lider_email
       FROM lideres
       WHERE recomendado_identificacion = ?`,
      [recomendado]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET 4) /lideres/distribution - Distribución de líderes (usa nueva estructura N:M)
app.get('/lideres/distribution', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT vl.lider_identificacion, l.nombre, l.apellido, COUNT(*) AS total_votantes
       FROM votante_lider vl
       LEFT JOIN lideres l ON l.identificacion = vl.lider_identificacion
       GROUP BY vl.lider_identificacion, l.nombre, l.apellido
       ORDER BY total_votantes DESC`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET 5) /lideres/total - Total de líderes
app.get('/lideres/total', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT COUNT(*) as total FROM lideres');
    res.json({
      total: rows[0].total,
      trend: 'equal' // Placeholder para lógica de tendencia
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET 6) /lideres/:cedula - Obtener líder por cédula
// Sugerencia (opcional para blindar): si tus IDs son numéricos, usa '/lideres/:cedula(\\d+)' para evitar choques.
app.get('/lideres/:cedula', async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT identificacion, nombre, apellido FROM lideres WHERE identificacion = ?',
      [req.params.cedula]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Líder no encontrado' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /lideres - Crear nuevo líder
app.post('/lideres', async (req, res) => {
  try {
    const { 
      identificacion,
      nombre = '',
      apellido = '',
      departamento = '',
      ciudad = '',
      barrio = '',
      direccion = '',
      celular = '',
      email = '',
      recomendado_identificacion,
      objetivo
    } = req.body;
    
    // Verificar si ya existe
    const [existing] = await db.execute(
      'SELECT COUNT(*) as count FROM lideres WHERE identificacion = ?',
      [identificacion]
    );
    if (existing[0].count > 0) {
      return res.status(400).json({ error: 'El líder ya existe' });
    }

    // Insertar nuevo líder con todos los campos
    await db.execute(
      `INSERT INTO lideres
       (identificacion, nombre, apellido, departamento, ciudad, barrio, direccion, celular, email, recomendado_identificacion, objetivo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        identificacion,
        nombre.toUpperCase(),
        apellido.toUpperCase(),
        departamento.toUpperCase(),
        ciudad.toUpperCase(),
        barrio.toUpperCase(),
        direccion.toUpperCase(),
        celular.toUpperCase(),
        email.toUpperCase(),
        recomendado_identificacion,
        objetivo
      ]
    );
    res.status(201).json({ message: 'Líder creado con éxito' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /lideres/:old_id - Actualizar líder
app.put('/lideres/:old_id', async (req, res) => {
  const connection = await db.getConnection();
  try {
    const oldId = req.params.old_id;
    const {
      identificacion: newId,
      nombre = '',
      apellido = '',
      departamento = '',
      ciudad = '',
      barrio = '',
      direccion = '',
      celular = '',
      email = '',
      recomendado_identificacion,
      objetivo
    } = req.body;
    
    await connection.beginTransaction();
    
    // Verificar que existe
    const [existing] = await connection.execute(
      'SELECT COUNT(*) as count FROM lideres WHERE identificacion = ?',
      [oldId]
    );
    if (existing[0].count === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Líder no encontrado' });
    }
    
    // Actualizar líder con todos los campos
    await connection.execute(
      `UPDATE lideres
       SET identificacion = ?, nombre = ?, apellido = ?, departamento = ?, ciudad = ?, barrio = ?, 
           direccion = ?, celular = ?, email = ?, recomendado_identificacion = ?, objetivo = ?
       WHERE identificacion = ?`,
      [
        newId,
        nombre.toUpperCase(),
        apellido.toUpperCase(),
        departamento.toUpperCase(),
        ciudad.toUpperCase(),
        barrio.toUpperCase(),
        direccion.toUpperCase(),
        celular.toUpperCase(),
        email.toUpperCase(),
        recomendado_identificacion,
        objetivo,
        oldId
      ]
    );

    // Si también existe como recomendado, actualizar sus datos
    await connection.execute(
      `UPDATE recomendados
       SET identificacion = ?, nombre = ?, apellido = ?, celular = ?, email = ?
       WHERE identificacion = ?`,
      [newId, nombre.toUpperCase(), apellido.toUpperCase(), celular.toUpperCase(), email.toUpperCase(), oldId]
    );

    // Si cambió el ID, actualizar referencias en votante_lider y first_lider
    if (oldId !== newId) {
      await connection.execute(
        'UPDATE votante_lider SET lider_identificacion = ? WHERE lider_identificacion = ?',
        [newId, oldId]
      );

      await connection.execute(
        'UPDATE votantes SET first_lider_identificacion = ? WHERE first_lider_identificacion = ?',
        [newId, oldId]
      );
    }

    await connection.commit();
    res.json({ message: 'Líder (y recomendado si aplica) actualizado con éxito' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// DELETE /lideres/:cedula - Eliminar líder (soft-delete)
app.delete('/lideres/:cedula', async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { delete_reason } = req.body;

    await connection.beginTransaction();

    // Verificar que existe
    const [existing] = await connection.execute(
      'SELECT COUNT(*) as count FROM lideres WHERE identificacion = ?',
      [req.params.cedula]
    );

    if (existing[0].count === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Líder no encontrado' });
    }

    // Setear variable de sesión para el motivo de eliminación
    await connection.execute('SET @delete_reason = ?', [delete_reason || 'Sin motivo especificado']);

    // Soft-delete: el trigger se encargará de mover a lideres_eliminados
    await connection.execute(
      'DELETE FROM lideres WHERE identificacion = ?',
      [req.params.cedula]
    );

    await connection.commit();
    res.json({ message: 'Líder eliminado con éxito (soft-delete)' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});


// ==============================
//          VOTANTES
// ==============================

// DEPRECATED: Reasignación ahora se hace con endpoints de /asignaciones
// Mantener temporalmente para compatibilidad hacia atrás
app.put('/votantes/reasignar', async (req, res) => {
  res.status(410).json({
    error: 'Este endpoint está deprecated',
    message: 'Use POST /asignaciones para asignar votante a nuevo líder, y DELETE /asignaciones para desasignar',
    nueva_estructura: {
      asignar: 'POST /asignaciones con { votante_identificacion, lider_identificacion }',
      desasignar: 'DELETE /asignaciones con { votante_identificacion, lider_identificacion }'
    }
  });
});

// GET /votantes - Obtener todos los votantes (con first_lider y líderes asignados)
app.get('/votantes', async (req, res) => {
  try {
    const { lider_id } = req.query; // filtro opcional

    let sql = `
      SELECT v.identificacion, v.nombre, v.apellido,
             v.departamento, v.ciudad, v.barrio, v.direccion,
             v.zona, v.puesto, v.mesa, v.direccion_puesto,
             v.celular, v.email,
             v.first_lider_identificacion,
             fl.nombre AS first_lider_nombre, fl.apellido AS first_lider_apellido,
             GROUP_CONCAT(DISTINCT vl.lider_identificacion ORDER BY vl.assigned_at SEPARATOR ',') AS lideres_asignados
      FROM votantes v
      LEFT JOIN lideres fl ON fl.identificacion = v.first_lider_identificacion
      LEFT JOIN votante_lider vl ON vl.votante_identificacion = v.identificacion
    `;
    const params = [];

    if (lider_id) {
      sql += " WHERE vl.lider_identificacion = ? OR v.first_lider_identificacion = ?";
      params.push(lider_id, lider_id);
    }

    sql += " GROUP BY v.identificacion ORDER BY v.identificacion";

    const [rows] = await db.execute(sql, params);

    // Convertir lideres_asignados de string a array
    const votantes = rows.map(row => ({
      ...row,
      lideres_asignados: row.lideres_asignados ? row.lideres_asignados.split(',') : []
    }));

    res.json(votantes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// GET /votantes/por-lider - Obtener votantes por líder (usa nueva estructura N:M)
app.get('/votantes/por-lider', async (req, res) => {
  try {
    const { lider } = req.query;

    // Buscar líder
    const [liderInfo] = await db.execute(
      'SELECT nombre, apellido, identificacion FROM lideres WHERE identificacion = ?',
      [lider]
    );

    if (liderInfo.length === 0) {
      return res.status(404).json({ error: 'No se encontró un líder con esa identificación' });
    }

    // Obtener votantes del líder desde la tabla votante_lider
    const [votantes] = await db.execute(
      `SELECT v.identificacion, v.nombre, v.apellido, v.direccion, v.celular
       FROM votante_lider vl
       INNER JOIN votantes v ON v.identificacion = vl.votante_identificacion
       WHERE vl.lider_identificacion = ?`,
      [lider]
    );

    const leader = liderInfo[0];
    const leaderName = `${leader.nombre} ${leader.apellido}`;

    res.json({
      lider: {
        nombre: leaderName,
        identificacion: leader.identificacion,
        total_votantes: votantes.length
      },
      votantes
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /votantes/por-lider-detalle - Igual que el anterior, con más detalle del líder (usa nueva estructura N:M)
app.get('/votantes/por-lider-detalle', async (req, res) => {
  try {
    const { lider } = req.query;

    const [liderInfo] = await db.execute(
      'SELECT nombre, apellido, identificacion, celular, direccion FROM lideres WHERE identificacion = ?',
      [lider]
    );

    if (liderInfo.length === 0) {
      return res.status(404).json({ error: 'No se encontró un líder con esa identificación' });
    }

    const [votantes] = await db.execute(
      `SELECT v.identificacion, v.nombre, v.apellido, v.direccion, v.celular
       FROM votante_lider vl
       INNER JOIN votantes v ON v.identificacion = vl.votante_identificacion
       WHERE vl.lider_identificacion = ?`,
      [lider]
    );

    const leader = liderInfo[0];
    const leaderName = `${leader.nombre} ${leader.apellido}`;

    res.json({
      lider: {
        nombre: leaderName,
        identificacion: leader.identificacion,
        direccion: leader.direccion,
        celular: leader.celular,
        total_votantes: votantes.length
      },
      votantes
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// GET /votantes/total - Total de votantes
app.get('/votantes/total', async (req, res) => {
  try {
    const [rows] = await db.execute('SELECT COUNT(*) as total FROM votantes');

    res.json({
      total: rows[0].total,
      trend: 'equal' // Placeholder para lógica de tendencia
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// GET /votantes/buscar?query=texto - Buscar votantes por cualquier campo (con nueva estructura)
app.get('/votantes/buscar', async (req, res) => {
  const query = `%${req.query.query}%`;
  try {
    const [rows] = await db.execute(
      `SELECT v.identificacion, v.nombre, v.apellido, v.direccion, v.celular, v.email,
              v.first_lider_identificacion,
              fl.nombre AS first_lider_nombre, fl.apellido AS first_lider_apellido,
              GROUP_CONCAT(DISTINCT vl.lider_identificacion ORDER BY vl.assigned_at SEPARATOR ',') AS lideres_asignados
       FROM votantes v
       LEFT JOIN lideres fl ON fl.identificacion = v.first_lider_identificacion
       LEFT JOIN votante_lider vl ON vl.votante_identificacion = v.identificacion
       WHERE v.identificacion LIKE ?
          OR v.nombre LIKE ?
          OR v.apellido LIKE ?
          OR v.celular LIKE ?
          OR v.email LIKE ?
          OR v.direccion LIKE ?
       GROUP BY v.identificacion`,
      [query, query, query, query, query, query]
    );

    // Convertir lideres_asignados de string a array
    const votantes = rows.map(row => ({
      ...row,
      lideres_asignados: row.lideres_asignados ? row.lideres_asignados.split(',') : []
    }));

    res.json(votantes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// GET /votantes/promedio_lider - Promedio de votantes por líder
app.get('/votantes/promedio_lider', async (req, res) => {
  try {
    // Contar votantes totales
    const [votantesResult] = await db.execute('SELECT COUNT(*) as total_votantes FROM votantes');
    const totalVotantes = votantesResult[0].total_votantes;

    // Contar líderes totales
    const [lideresResult] = await db.execute('SELECT COUNT(*) as total_lideres FROM lideres');
    const totalLideres = lideresResult[0].total_lideres;

    const promedio = totalLideres === 0 ? 0 : Math.round((totalVotantes / totalLideres) * 100) / 100;

    res.json({
      promedio: promedio,
      trend: 'equal' // Placeholder para lógica de tendencia
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /votantes/tendencia_mensual - Tendencia mensual de votantes
app.get('/votantes/tendencia_mensual', async (req, res) => {
  try {
    // Nota: Asumiendo que existe una columna 'created_at' en la tabla votantes
    // Si no existe, necesitarás ajustar esta consulta o crear la columna
    const [rows] = await db.execute(`
      SELECT DATE(created_at) AS fecha, COUNT(*) AS conteo
      FROM votantes
      WHERE created_at >= CURDATE() - INTERVAL 30 DAY
      GROUP BY DATE(created_at)
      ORDER BY fecha ASC
    `);

    const tendencia = rows.map(row => ({
      date: row.fecha.toISOString().split('T')[0],
      count: row.conteo
    }));

    res.json(tendencia);
  } catch (error) {
    // Si la columna created_at no existe, retornar array vacío
    if (error.message.includes('created_at')) {
      res.json([]);
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// POST /votantes/upload_csv - Cargar votantes desde CSV/Excel usando sistema de capturas (staging)
// IMPORTANTE: Ahora usa capturas_votante para aprovechar triggers y detección automática de incidencias
app.post('/votantes/upload_csv', upload.single('file'), async (req, res) => {
  const crypto = require('crypto');

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    // Leer el archivo Excel
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    // Verificar columnas requeridas
    const requiredColumns = ['Cedula', 'Nombres', 'Apellidos', 'Lider'];
    const hasRequiredColumns = requiredColumns.every(col =>
      data.length > 0 && data[0].hasOwnProperty(col)
    );

    if (!hasRequiredColumns) {
      return res.status(400).json({
        error: 'El archivo Excel no tiene las columnas mínimas requeridas',
        columnas_requeridas: requiredColumns,
        columnas_opcionales: ['Departamento', 'Ciudad', 'Barrio', 'Direccion', 'Celular', 'Email', 'Zona', 'Puesto', 'Mesa', 'DireccionPuesto']
      });
    }

    let capturasInsertadas = 0;
    const duplicadosExactos = [];
    const errores = [];

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      for (const row of data) {
        const cedula = String(row.Cedula || 0).trim();
        const nombres = String(row.Nombres || '').trim();
        const apellidos = String(row.Apellidos || '').trim();
        const departamento = String(row.Departamento || '').trim();
        const ciudad = String(row.Ciudad || '').trim();
        const barrio = String(row.Barrio || '').trim();
        const direccion = String(row.Direccion || '').trim();
        const zona = String(row.Zona || '').trim();
        const puesto = String(row.Puesto || '').trim();
        const mesa = String(row.Mesa || '').trim();
        const direccionPuesto = String(row.DireccionPuesto || '').trim();
        const celular = String(row.Celular || '').trim();
        const email = String(row.Email || '').trim();
        const lider = String(row.Lider || 0).trim();

        // Verificar que el líder existe
        const [leaderExists] = await connection.execute(
          'SELECT COUNT(*) as count FROM lideres WHERE identificacion = ?',
          [lider]
        );

        if (leaderExists[0].count === 0) {
          errores.push({
            fila: data.indexOf(row) + 2, // +2 porque Excel empieza en 1 y tiene header
            identificacion: cedula,
            nombre: nombres,
            apellido: apellidos,
            error: `Líder con identificación ${lider} no existe`
          });
          continue;
        }

        // Calcular hash de datos para detección de duplicados exactos
        const datosParaHash = [
          nombres,
          apellidos,
          departamento,
          ciudad,
          barrio,
          direccion,
          celular,
          email
        ].join('|').toUpperCase();

        const hash_datos = crypto.createHash('md5').update(datosParaHash).digest('hex');

        try {
          // Insertar en capturas_votante (el trigger procesará todo automáticamente)
          await connection.execute(
            `INSERT INTO capturas_votante (
              lider_identificacion,
              identificacion_reportada,
              nombre_reportado,
              apellido_reportado,
              departamento_reportado,
              ciudad_reportada,
              barrio_reportado,
              direccion_reportada,
              zona_reportada,
              puesto_reportado,
              mesa_reportada,
              direccion_puesto_reportada,
              celular_reportado,
              email_reportado,
              hash_datos,
              created_by_user_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              lider,
              cedula,
              nombres.toUpperCase(),
              apellidos.toUpperCase(),
              departamento.toUpperCase(),
              ciudad.toUpperCase(),
              barrio.toUpperCase(),
              direccion.toUpperCase(),
              zona.toUpperCase(),
              puesto.toUpperCase(),
              mesa.toUpperCase(),
              direccionPuesto.toUpperCase(),
              celular.toUpperCase(),
              email.toUpperCase(),
              hash_datos,
              req.userId
            ]
          );

          capturasInsertadas++;
        } catch (capturaError) {
          // Manejo de duplicados exactos (mismo líder, misma cédula, mismos datos)
          if (capturaError.code === 'ER_DUP_ENTRY') {
            duplicadosExactos.push({
              fila: data.indexOf(row) + 2,
              identificacion: cedula,
              nombre: nombres,
              apellido: apellidos,
              lider,
              mensaje: 'Duplicado exacto: este líder ya reportó estos datos para este votante'
            });
          } else {
            errores.push({
              fila: data.indexOf(row) + 2,
              identificacion: cedula,
              nombre: nombres,
              apellido: apellidos,
              error: capturaError.message
            });
          }
        }
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    // Eliminar archivo temporal
    fs.unlinkSync(req.file.path);

    res.status(201).json({
      message: 'Carga masiva procesada con éxito usando sistema de capturas (staging)',
      total_filas: data.length,
      capturas_insertadas: capturasInsertadas,
      duplicados_exactos: duplicadosExactos.length,
      errores: errores.length,
      detalles: {
        duplicados_exactos: duplicadosExactos,
        errores: errores
      },
      nota: 'Los triggers automáticos han procesado: canónicos, asignaciones N:M, variantes e incidencias. Consulte GET /incidencias para ver duplicidades y conflictos detectados.'
    });
  } catch (error) {
    // Limpiar archivo en caso de error
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error('Error eliminando archivo temporal:', unlinkError.message);
      }
    }
    res.status(500).json({ error: error.message });
  }
});

// POST /votantes - Crear nuevo votante canónico (SIN asignar líder directamente)
// Para asignar líder: usar POST /asignaciones o POST /capturas
app.post('/votantes', async (req, res) => {
  try {
    const {
      identificacion,
      nombre = '',
      apellido = '',
      departamento = '',
      ciudad = '',
      barrio = '',
      direccion = '',
      celular = '',
      email = '',
      lider_identificacion // Se rechaza si se envía
    } = req.body;

    // IMPORTANTE: Rechazar lider_identificacion según nueva arquitectura
    if (lider_identificacion !== undefined) {
      return res.status(400).json({
        error: 'lider_identificacion no está permitido en este endpoint',
        mensaje: 'Para asociar votantes a líderes, use POST /asignaciones o POST /capturas',
        endpoints_validos: {
          asignacion_directa: 'POST /asignaciones con { votante_identificacion, lider_identificacion }',
          ingesta_con_staging: 'POST /capturas con todos los datos reportados por el líder'
        }
      });
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Verificar si ya existe
      const [existing] = await connection.execute(
        'SELECT * FROM votantes WHERE identificacion = ?',
        [identificacion]
      );

      if (existing.length > 0) {
        await connection.rollback();
        return res.status(400).json({
          error: 'El votante ya existe en el sistema canónico',
          duplicado: true,
          votante: existing[0],
          nota: 'Use PUT /votantes/:identificacion para actualizar datos, o POST /capturas para reportar variantes por líder'
        });
      }

      // Insertar nuevo votante canónico (sin lider_identificacion)
      await connection.execute(
        `INSERT INTO votantes
         (identificacion, nombre, apellido, departamento, ciudad, barrio, direccion, celular, email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          identificacion,
          nombre.toUpperCase(),
          apellido.toUpperCase(),
          departamento.toUpperCase(),
          ciudad.toUpperCase(),
          barrio.toUpperCase(),
          direccion.toUpperCase(),
          celular.toUpperCase(),
          email.toUpperCase()
        ]
      );

      await connection.commit();
      res.status(201).json({
        message: 'Votante canónico creado con éxito',
        identificacion,
        nota: 'Para asignar líderes, use POST /asignaciones o POST /capturas'
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Función auxiliar para parsear la dirección concatenada
function parseAddressString(addressString) {
  const result = {
    departamento: '',
    ciudad: '',
    barrio: '',
    direccion: ''
  };

  if (!addressString || typeof addressString !== 'string') {
    return result;
  }

  // Dividir por comas
  const parts = addressString.split(',').map(part => part.trim());

  for (const part of parts) {
    if (part.toLowerCase().startsWith('departamento:')) {
      result.departamento = part.replace(/^departamento:\s*/i, '').trim();
    } else if (part.toLowerCase().startsWith('municipio:')) {
      result.ciudad = part.replace(/^municipio:\s*/i, '').trim();
    } else if (part.toLowerCase().startsWith('barrio:')) {
      result.barrio = part.replace(/^barrio:\s*/i, '').trim();
    } else if (part.toLowerCase().startsWith('dirección:') || part.toLowerCase().startsWith('direccion:')) {
      result.direccion = part.replace(/^direcci[oó]n:\s*/i, '').trim();
    }
  }

  return result;
}

// PUT /votantes/:identificacion - Actualizar votante (sin modificar asignaciones de líderes)
app.put('/votantes/:identificacion', async (req, res) => {
  try {
    const identificacion = req.params.identificacion;

    // Validar que la identificación no esté vacía
    if (!identificacion || identificacion.trim() === '') {
      return res.status(400).json({ error: 'La identificación es requerida' });
    }

    const {
      nombre = '',
      apellido = '',
      departamento = '',
      ciudad = '',
      barrio = '',
      direccion = '',
      celular = '',
      email = ''
    } = req.body;

    // Validar y limpiar datos
    let cleanNombre = (nombre || '').toString();
    let cleanApellido = (apellido || '').toString();
    let cleanDepartamento = (departamento || '').toString();
    let cleanCiudad = (ciudad || '').toString();
    let cleanBarrio = (barrio || '').toString();
    let cleanDireccion = (direccion || '').toString();
    let cleanCelular = (celular || '').toString();
    let cleanEmail = (email || '').toString();

    // Si la dirección viene en formato concatenado, parsearla
    if (cleanDireccion && cleanDireccion.includes('Departamento:')) {
      const parsedData = parseAddressString(cleanDireccion);
      cleanDepartamento = parsedData.departamento || cleanDepartamento;
      cleanCiudad = parsedData.ciudad || cleanCiudad;
      cleanBarrio = parsedData.barrio || cleanBarrio;
      cleanDireccion = parsedData.direccion || cleanDireccion;
    }

    // Verificar que existe
    const [existing] = await db.execute(
      'SELECT COUNT(*) as count FROM votantes WHERE identificacion = ?',
      [identificacion]
    );

    if (existing[0].count === 0) {
      return res.status(404).json({ error: 'El votante no existe' });
    }

    // Actualizar votante (sin tocar asignaciones de líderes)
    await db.execute(
      `UPDATE votantes
       SET nombre = ?, apellido = ?, departamento = ?, ciudad = ?, barrio = ?,
           direccion = ?, celular = ?, email = ?
       WHERE identificacion = ?`,
      [
        cleanNombre.toUpperCase(),
        cleanApellido.toUpperCase(),
        cleanDepartamento.toUpperCase(),
        cleanCiudad.toUpperCase(),
        cleanBarrio.toUpperCase(),
        cleanDireccion.toUpperCase(),
        cleanCelular.toUpperCase(),
        cleanEmail.toUpperCase(),
        identificacion
      ]
    );

    res.json({
      message: 'Votante actualizado con éxito',
      nota: 'Para modificar asignaciones de líderes, usar endpoints de /asignaciones'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /votantes/:identificacion - Eliminar votante (soft-delete)
app.delete('/votantes/:identificacion', async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { delete_reason } = req.body;

    await connection.beginTransaction();

    // Verificar que existe
    const [existing] = await connection.execute(
      'SELECT COUNT(*) as count FROM votantes WHERE identificacion = ?',
      [req.params.identificacion]
    );

    if (existing[0].count === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'El votante no existe' });
    }

    // Setear variable de sesión para el motivo de eliminación
    await connection.execute('SET @delete_reason = ?', [delete_reason || 'Sin motivo especificado']);

    // Soft-delete: el trigger se encargará de mover a votantes_eliminados
    await connection.execute(
      'DELETE FROM votantes WHERE identificacion = ?',
      [req.params.identificacion]
    );

    await connection.commit();
    res.json({ message: 'Votante eliminado con éxito (soft-delete)' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// DELETE /votantes/bulk - Borrado masivo de votantes
app.delete('/votantes/bulk', async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Se requiere un array "ids" con al menos un ID' });
  }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Eliminar votantes
    const [result] = await connection.query(
      'DELETE FROM votantes WHERE cedula IN (?)',
      [ids]
    );

    await connection.commit();
    res.json({ deleted: result.affectedRows });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});


// ==============================
//    CAPTURAS (STAGING CRUDO)
// ==============================

// POST /capturas - Ingesta de datos reportados por líderes (staging)
// El trigger tr_capturas_after_insert se encargará automáticamente de:
// - Crear votante canónico si no existe
// - Crear asignación N:M en votante_lider
// - Crear variante en votante_variantes
// - Generar incidencias (DUPLICIDAD_CON_SI_MISMO, DUPLICIDAD_LIDER, CONFLICTO_DATOS)
app.post('/capturas', async (req, res) => {
  const connection = await db.getConnection();
  try {
    const {
      lider_identificacion,
      identificacion_reportada,
      nombre_reportado = '',
      apellido_reportado = '',
      departamento_reportado = '',
      ciudad_reportada = '',
      barrio_reportado = '',
      direccion_reportada = '',
      zona_reportada = '',
      puesto_reportado = '',
      mesa_reportada = '',
      direccion_puesto_reportada = '',
      celular_reportado = '',
      email_reportado = ''
    } = req.body;

    // Validaciones básicas
    if (!lider_identificacion) {
      return res.status(400).json({ error: 'lider_identificacion es requerido' });
    }
    if (!identificacion_reportada) {
      return res.status(400).json({ error: 'identificacion_reportada es requerido' });
    }

    await connection.beginTransaction();

    // Verificar que el líder existe
    const [liderExists] = await connection.execute(
      'SELECT COUNT(*) as count FROM lideres WHERE identificacion = ?',
      [lider_identificacion]
    );

    if (liderExists[0].count === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Líder no encontrado' });
    }

    // Calcular hash de datos para detección de duplicados exactos
    const datosParaHash = [
      nombre_reportado,
      apellido_reportado,
      departamento_reportado,
      ciudad_reportada,
      barrio_reportado,
      direccion_reportada,
      celular_reportado,
      email_reportado
    ].join('|').toUpperCase();

    const crypto = require('crypto');
    const hash_datos = crypto.createHash('md5').update(datosParaHash).digest('hex');

    // Insertar captura (el trigger se encargará de todo el procesamiento automático)
    const [result] = await connection.execute(
      `INSERT INTO capturas_votante (
        lider_identificacion,
        identificacion_reportada,
        nombre_reportado,
        apellido_reportado,
        departamento_reportado,
        ciudad_reportada,
        barrio_reportado,
        direccion_reportada,
        zona_reportada,
        puesto_reportado,
        mesa_reportada,
        direccion_puesto_reportada,
        celular_reportado,
        email_reportado,
        hash_datos,
        created_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lider_identificacion,
        identificacion_reportada,
        nombre_reportado.toUpperCase(),
        apellido_reportado.toUpperCase(),
        departamento_reportado.toUpperCase(),
        ciudad_reportada.toUpperCase(),
        barrio_reportado.toUpperCase(),
        direccion_reportada.toUpperCase(),
        zona_reportada.toUpperCase(),
        puesto_reportado.toUpperCase(),
        mesa_reportada.toUpperCase(),
        direccion_puesto_reportada.toUpperCase(),
        celular_reportado.toUpperCase(),
        email_reportado.toUpperCase(),
        hash_datos,
        req.userId
      ]
    );

    const capturaId = result.insertId;

    // Obtener información de la captura procesada y posibles incidencias generadas
    const [capturaInfo] = await connection.execute(
      `SELECT estado, canonical_identificacion FROM capturas_votante WHERE id = ?`,
      [capturaId]
    );

    const [incidenciasGeneradas] = await connection.execute(
      `SELECT tipo, detalle FROM incidencias
       WHERE votante_identificacion = ?
       AND created_at >= NOW() - INTERVAL 5 SECOND
       ORDER BY created_at DESC`,
      [identificacion_reportada]
    );

    await connection.commit();

    res.status(201).json({
      message: 'Captura procesada con éxito',
      captura_id: capturaId,
      lider_identificacion,
      identificacion_reportada,
      canonical_identificacion: capturaInfo[0]?.canonical_identificacion,
      estado: capturaInfo[0]?.estado,
      incidencias_generadas: incidenciasGeneradas.length > 0 ? incidenciasGeneradas : null,
      nota: 'El trigger automático ha procesado: creación de canónico (si aplica), asignación N:M, variante y detección de incidencias'
    });
  } catch (error) {
    await connection.rollback();

    // Manejo especial para duplicados exactos (UNIQUE constraint)
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({
        error: 'Captura duplicada exacta',
        mensaje: 'Este líder ya reportó exactamente los mismos datos para este votante',
        tipo_incidencia: 'DUPLICIDAD_CON_SI_MISMO'
      });
    }

    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// GET /capturas - Consultar capturas con filtros
app.get('/capturas', async (req, res) => {
  try {
    const { estado, lider, cc, desde, hasta, limit = 100, offset = 0 } = req.query;

    let sql = `
      SELECT c.id, c.lider_identificacion, c.identificacion_reportada,
             c.nombre_reportado, c.apellido_reportado,
             c.departamento_reportado, c.ciudad_reportada, c.barrio_reportado,
             c.direccion_reportada, c.celular_reportado, c.email_reportado,
             c.canonical_identificacion, c.estado, c.created_at,
             l.nombre AS lider_nombre, l.apellido AS lider_apellido,
             u.username AS created_by
      FROM capturas_votante c
      LEFT JOIN lideres l ON l.identificacion = c.lider_identificacion
      LEFT JOIN usuarios u ON u.id = c.created_by_user_id
      WHERE 1=1
    `;
    const params = [];

    if (estado) {
      sql += ' AND c.estado = ?';
      params.push(estado);
    }

    if (lider) {
      sql += ' AND c.lider_identificacion = ?';
      params.push(lider);
    }

    if (cc) {
      sql += ' AND c.identificacion_reportada = ?';
      params.push(cc);
    }

    if (desde) {
      sql += ' AND c.created_at >= ?';
      params.push(desde);
    }

    if (hasta) {
      sql += ' AND c.created_at <= ?';
      params.push(hasta);
    }

    sql += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [rows] = await db.execute(sql, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /variantes - Consultar variantes (foto por líder de cada votante canónico)
app.get('/variantes', async (req, res) => {
  try {
    const { cc, lider, desde, hasta, current, limit = 100, offset = 0 } = req.query;

    let sql = `
      SELECT vv.id, vv.canonical_identificacion, vv.lider_identificacion,
             vv.captura_id, vv.nombre_reportado, vv.apellido_reportado,
             vv.departamento_reportado, vv.ciudad_reportada, vv.barrio_reportado,
             vv.direccion_reportada, vv.celular_reportado, vv.email_reportado,
             vv.is_current, vv.created_at,
             v.nombre AS canonical_nombre, v.apellido AS canonical_apellido,
             l.nombre AS lider_nombre, l.apellido AS lider_apellido,
             u.username AS created_by
      FROM votante_variantes vv
      LEFT JOIN votantes v ON v.identificacion = vv.canonical_identificacion
      LEFT JOIN lideres l ON l.identificacion = vv.lider_identificacion
      LEFT JOIN usuarios u ON u.id = vv.created_by_user_id
      WHERE 1=1
    `;
    const params = [];

    if (cc) {
      sql += ' AND vv.canonical_identificacion = ?';
      params.push(cc);
    }

    if (lider) {
      sql += ' AND vv.lider_identificacion = ?';
      params.push(lider);
    }

    if (current !== undefined) {
      sql += ' AND vv.is_current = ?';
      params.push(parseInt(current));
    }

    if (desde) {
      sql += ' AND vv.created_at >= ?';
      params.push(desde);
    }

    if (hasta) {
      sql += ' AND vv.created_at <= ?';
      params.push(hasta);
    }

    sql += ' ORDER BY vv.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [rows] = await db.execute(sql, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /variantes/metricas - Métricas de calidad de datos por líder
app.get('/variantes/metricas', async (req, res) => {
  try {
    const { lider } = req.query;

    // Métricas generales
    let sql = `
      SELECT
        lider_identificacion,
        COUNT(DISTINCT canonical_identificacion) AS votantes_reales,
        COUNT(*) AS total_variantes,
        COUNT(*) - COUNT(DISTINCT canonical_identificacion) AS duplicados_con_si_mismo,
        l.nombre AS lider_nombre,
        l.apellido AS lider_apellido
      FROM votante_variantes vv
      LEFT JOIN lideres l ON l.identificacion = vv.lider_identificacion
    `;
    const params = [];

    if (lider) {
      sql += ' WHERE vv.lider_identificacion = ?';
      params.push(lider);
    }

    sql += ' GROUP BY lider_identificacion, l.nombre, l.apellido';
    sql += ' ORDER BY votantes_reales DESC';

    const [metricas] = await db.execute(sql, params);

    // Votantes duplicados entre líderes
    const [duplicadosEntreLideres] = await db.execute(`
      SELECT canonical_identificacion,
             COUNT(DISTINCT lider_identificacion) AS num_lideres,
             GROUP_CONCAT(DISTINCT lider_identificacion ORDER BY lider_identificacion) AS lideres
      FROM votante_variantes
      ${lider ? 'WHERE lider_identificacion = ?' : ''}
      GROUP BY canonical_identificacion
      HAVING COUNT(DISTINCT lider_identificacion) > 1
      ORDER BY num_lideres DESC
      LIMIT 100
    `, lider ? [lider] : []);

    res.json({
      metricas_por_lider: metricas,
      duplicados_entre_lideres: {
        total: duplicadosEntreLideres.length,
        casos: duplicadosEntreLideres
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==============================
//        ASIGNACIONES (N:M)
// ==============================

// POST /asignaciones - Asignar votante a líder
app.post('/asignaciones', async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { votante_identificacion, lider_identificacion } = req.body;

    if (!votante_identificacion || !lider_identificacion) {
      return res.status(400).json({ error: 'Se requieren votante_identificacion y lider_identificacion' });
    }

    await connection.beginTransaction();

    // Verificar que el votante existe
    const [votante] = await connection.execute(
      'SELECT COUNT(*) as count FROM votantes WHERE identificacion = ?',
      [votante_identificacion]
    );

    if (votante[0].count === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Votante no encontrado' });
    }

    // Verificar que el líder existe
    const [lider] = await connection.execute(
      'SELECT COUNT(*) as count FROM lideres WHERE identificacion = ?',
      [lider_identificacion]
    );

    if (lider[0].count === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Líder no encontrado' });
    }

    // Verificar si ya existe la asignación
    const [existing] = await connection.execute(
      'SELECT COUNT(*) as count FROM votante_lider WHERE votante_identificacion = ? AND lider_identificacion = ?',
      [votante_identificacion, lider_identificacion]
    );

    if (existing[0].count > 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'La asignación ya existe' });
    }

    // Insertar asignación (el trigger se encargará de setear first_lider y crear incidencia si aplica)
    await connection.execute(
      'INSERT INTO votante_lider (votante_identificacion, lider_identificacion, assigned_by_user_id) VALUES (?, ?, ?)',
      [votante_identificacion, lider_identificacion, req.userId]
    );

    await connection.commit();
    res.status(201).json({
      message: 'Asignación creada con éxito',
      votante_identificacion,
      lider_identificacion
    });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// GET /asignaciones - Obtener todas las asignaciones con filtros opcionales
app.get('/asignaciones', async (req, res) => {
  try {
    const { votante_id, lider_id } = req.query;

    let sql = `
      SELECT vl.id, vl.votante_identificacion, vl.lider_identificacion,
             vl.assigned_at, vl.assigned_by_user_id,
             v.nombre AS votante_nombre, v.apellido AS votante_apellido,
             l.nombre AS lider_nombre, l.apellido AS lider_apellido,
             u.username AS assigned_by
      FROM votante_lider vl
      LEFT JOIN votantes v ON v.identificacion = vl.votante_identificacion
      LEFT JOIN lideres l ON l.identificacion = vl.lider_identificacion
      LEFT JOIN usuarios u ON u.id = vl.assigned_by_user_id
      WHERE 1=1
    `;
    const params = [];

    if (votante_id) {
      sql += ' AND vl.votante_identificacion = ?';
      params.push(votante_id);
    }

    if (lider_id) {
      sql += ' AND vl.lider_identificacion = ?';
      params.push(lider_id);
    }

    sql += ' ORDER BY vl.assigned_at DESC';

    const [rows] = await db.execute(sql, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /asignaciones - Desasignar votante de líder
app.delete('/asignaciones', async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { votante_identificacion, lider_identificacion } = req.body;

    if (!votante_identificacion || !lider_identificacion) {
      return res.status(400).json({ error: 'Se requieren votante_identificacion y lider_identificacion' });
    }

    await connection.beginTransaction();

    // Verificar que existe la asignación
    const [existing] = await connection.execute(
      'SELECT COUNT(*) as count FROM votante_lider WHERE votante_identificacion = ? AND lider_identificacion = ?',
      [votante_identificacion, lider_identificacion]
    );

    if (existing[0].count === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'La asignación no existe' });
    }

    // Eliminar asignación (el trigger registrará el log UNASSIGN)
    await connection.execute(
      'DELETE FROM votante_lider WHERE votante_identificacion = ? AND lider_identificacion = ?',
      [votante_identificacion, lider_identificacion]
    );

    await connection.commit();
    res.json({ message: 'Asignación eliminada con éxito' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// ==============================
//        INCIDENCIAS
// ==============================

// GET /incidencias - Obtener todas las incidencias con filtros
app.get('/incidencias', async (req, res) => {
  try {
    const { tipo, votante_id, lider_id, desde, hasta } = req.query;

    let sql = `
      SELECT i.id, i.tipo, i.votante_identificacion, i.lider_anterior_identificacion,
             i.lider_nuevo_identificacion, i.detalle, i.created_at, i.created_by_user_id,
             v.nombre AS votante_nombre, v.apellido AS votante_apellido,
             la.nombre AS lider_anterior_nombre, la.apellido AS lider_anterior_apellido,
             ln.nombre AS lider_nuevo_nombre, ln.apellido AS lider_nuevo_apellido,
             u.username AS created_by
      FROM incidencias i
      LEFT JOIN votantes v ON v.identificacion = i.votante_identificacion
      LEFT JOIN lideres la ON la.identificacion = i.lider_anterior_identificacion
      LEFT JOIN lideres ln ON ln.identificacion = i.lider_nuevo_identificacion
      LEFT JOIN usuarios u ON u.id = i.created_by_user_id
      WHERE 1=1
    `;
    const params = [];

    if (tipo) {
      sql += ' AND i.tipo = ?';
      params.push(tipo);
    }

    if (votante_id) {
      sql += ' AND i.votante_identificacion = ?';
      params.push(votante_id);
    }

    if (lider_id) {
      sql += ' AND (i.lider_anterior_identificacion = ? OR i.lider_nuevo_identificacion = ?)';
      params.push(lider_id, lider_id);
    }

    if (desde) {
      sql += ' AND i.created_at >= ?';
      params.push(desde);
    }

    if (hasta) {
      sql += ' AND i.created_at <= ?';
      params.push(hasta);
    }

    sql += ' ORDER BY i.created_at DESC';

    const [rows] = await db.execute(sql, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /votantes/:id/incidencias - Obtener incidencias de un votante específico
app.get('/votantes/:id/incidencias', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT i.id, i.tipo, i.lider_anterior_identificacion, i.lider_nuevo_identificacion,
              i.detalle, i.created_at,
              la.nombre AS lider_anterior_nombre, la.apellido AS lider_anterior_apellido,
              ln.nombre AS lider_nuevo_nombre, ln.apellido AS lider_nuevo_apellido
       FROM incidencias i
       LEFT JOIN lideres la ON la.identificacion = i.lider_anterior_identificacion
       LEFT JOIN lideres ln ON ln.identificacion = i.lider_nuevo_identificacion
       WHERE i.votante_identificacion = ?
       ORDER BY i.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /incidencias - Crear incidencia manual (tipo OTRO)
app.post('/incidencias', async (req, res) => {
  try {
    const {
      tipo = 'OTRO',
      votante_identificacion,
      lider_anterior_identificacion = null,
      lider_nuevo_identificacion = null,
      detalle = ''
    } = req.body;

    if (!votante_identificacion) {
      return res.status(400).json({ error: 'Se requiere votante_identificacion' });
    }

    await db.execute(
      `INSERT INTO incidencias
       (tipo, votante_identificacion, lider_anterior_identificacion, lider_nuevo_identificacion, detalle, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tipo, votante_identificacion, lider_anterior_identificacion, lider_nuevo_identificacion, detalle, req.userId]
    );

    res.status(201).json({ message: 'Incidencia creada con éxito' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==============================
//        LOGS
// ==============================

// GET /logs - Obtener logs de acciones con filtros
app.get('/logs', async (req, res) => {
  try {
    const { entidad, accion, user_id, desde, hasta, limit = 100, offset = 0 } = req.query;

    let sql = `
      SELECT l.id, l.user_id, l.accion, l.entidad, l.entidad_id,
             l.detalles, l.ip, l.user_agent, l.created_at,
             u.username
      FROM logs_acciones l
      LEFT JOIN usuarios u ON u.id = l.user_id
      WHERE 1=1
    `;
    const params = [];

    if (entidad) {
      sql += ' AND l.entidad = ?';
      params.push(entidad);
    }

    if (accion) {
      sql += ' AND l.accion = ?';
      params.push(accion);
    }

    if (user_id) {
      sql += ' AND l.user_id = ?';
      params.push(user_id);
    }

    if (desde) {
      sql += ' AND l.created_at >= ?';
      params.push(desde);
    }

    if (hasta) {
      sql += ' AND l.created_at <= ?';
      params.push(hasta);
    }

    sql += ' ORDER BY l.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [rows] = await db.execute(sql, params);

    // Parsear detalles JSON
    const logs = rows.map(row => ({
      ...row,
      detalles: row.detalles ? JSON.parse(row.detalles) : null
    }));

    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==============================
//    TABLAS DE ELIMINADOS
// ==============================

// GET /lideres/eliminados - Obtener líderes eliminados
app.get('/lideres/eliminados', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT identificacion, nombre, apellido, departamento, ciudad, barrio,
              direccion, celular, email, recomendado_identificacion, objetivo,
              deleted_at, deleted_by, deleted_reason,
              u.username AS deleted_by_username
       FROM lideres_eliminados le
       LEFT JOIN usuarios u ON u.id = le.deleted_by
       ORDER BY le.deleted_at DESC`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /recomendados/eliminados - Obtener recomendados eliminados
app.get('/recomendados/eliminados', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT identificacion, nombre, apellido, departamento, ciudad, barrio,
              direccion, celular, email, grupo_id,
              deleted_at, deleted_by, deleted_reason,
              u.username AS deleted_by_username
       FROM recomendados_eliminados re
       LEFT JOIN usuarios u ON u.id = re.deleted_by
       ORDER BY re.deleted_at DESC`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /votantes/eliminados - Obtener votantes eliminados
app.get('/votantes/eliminados', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT identificacion, nombre, apellido, departamento, ciudad, barrio,
              direccion, zona, puesto, mesa, direccion_puesto, celular, email,
              first_lider_identificacion,
              deleted_at, deleted_by, deleted_reason,
              u.username AS deleted_by_username
       FROM votantes_eliminados ve
       LEFT JOIN usuarios u ON u.id = ve.deleted_by
       ORDER BY ve.deleted_at DESC`
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==============================
//    ENDPOINTS DE RELACIONES
// ==============================

// GET /lideres/:id/votantes - Obtener votantes asociados a un líder
app.get('/lideres/:id/votantes', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT DISTINCT v.identificacion, v.nombre, v.apellido, v.departamento,
              v.ciudad, v.barrio, v.direccion, v.celular, v.email,
              vl.assigned_at
       FROM votante_lider vl
       INNER JOIN votantes v ON v.identificacion = vl.votante_identificacion
       WHERE vl.lider_identificacion = ?
       ORDER BY vl.assigned_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /votantes/:id/lideres - Obtener líderes asociados a un votante
app.get('/votantes/:id/lideres', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT l.identificacion, l.nombre, l.apellido, l.departamento,
              l.ciudad, l.barrio, l.celular, l.email, l.objetivo,
              vl.assigned_at,
              CASE WHEN v.first_lider_identificacion = l.identificacion THEN 1 ELSE 0 END AS es_primer_lider
       FROM votante_lider vl
       INNER JOIN lideres l ON l.identificacion = vl.lider_identificacion
       INNER JOIN votantes v ON v.identificacion = vl.votante_identificacion
       WHERE vl.votante_identificacion = ?
       ORDER BY vl.assigned_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==============================
//    DASHBOARD Y REPORTES
// ==============================

// Ruta de prueba
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Backend Node.js funcionando correctamente',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});


// Manejo de errores global
app.use((error, req, res, next) => {
  console.error('Error no manejado:', error);
  res.status(500).json({
    error: 'Error interno del servidor',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Algo salió mal'
  });
});

// Ruta 404 para rutas no encontradas
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Ruta no encontrada',
    message: `La ruta ${req.method} ${req.originalUrl} no existe`
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Cerrando pool de conexiones...');
  await db.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Cerrando pool de conexiones...');
  await db.end();
  process.exit(0);
});

// Iniciar servidor
app.listen(port, () => {
  console.log(`🚀 Servidor corriendo en puerto:${port}`);
  console.log(`💾 Pool de conexiones configurado con ${dbConfig.connectionLimit} conexiones máximas`);
});

module.exports = app;
