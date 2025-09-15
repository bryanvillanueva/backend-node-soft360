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

// Obtener estructura completa de un grupo (recomendados, líderes y votantes)
app.get('/grupos/:id/completo', async (req, res) => {
  const grupoId = req.params.id;
  const [rows] = await db.execute(
    `SELECT 
        r.identificacion AS recomendado_id, r.nombre AS recomendado_nombre,
        l.identificacion AS lider_id, l.nombre AS lider_nombre, l.apellido AS lider_apellido,
        v.identificacion AS votante_id, v.nombre AS votante_nombre, v.apellido AS votante_apellido
     FROM recomendados r
     LEFT JOIN lideres l ON l.recomendado_identificacion = r.identificacion
     LEFT JOIN votantes v ON v.lider_identificacion = l.identificacion
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
      'SELECT identificacion, nombre, apellido, celular, email FROM recomendados'
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
    const { identificacion, nombre = '', apellido = '', celular = '', email = '' } = req.body;
    
    // Verificar si ya existe
    const [existing] = await db.execute(
      'SELECT COUNT(*) as count FROM recomendados WHERE identificacion = ?',
      [identificacion]
    );

    if (existing[0].count > 0) {
      return res.status(400).json({ error: 'El recomendado ya existe' });
    }

    // Insertar nuevo recomendado
    await db.execute(
      'INSERT INTO recomendados (identificacion, nombre, apellido, celular, email) VALUES (?, ?, ?, ?, ?)',
      [identificacion, nombre.toUpperCase(), apellido.toUpperCase(), celular.toUpperCase(), email.toUpperCase()]
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
      celular = '',
      email = ''
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
    
    // Actualizar recomendado
    await connection.execute(
      `UPDATE recomendados 
       SET identificacion = ?, nombre = ?, apellido = ?, celular = ?, email = ? 
       WHERE identificacion = ?`,
      [newId, nombre.toUpperCase(), apellido.toUpperCase(), celular.toUpperCase(), email.toUpperCase(), oldId]
    );

    // Si también existe como líder, actualizar sus datos
    await connection.execute(
      `UPDATE lideres
       SET identificacion = ?, nombre = ?, apellido = ?, celular = ?, email = ?
       WHERE identificacion = ?`,
      [newId, nombre.toUpperCase(), apellido.toUpperCase(), celular.toUpperCase(), email.toUpperCase(), oldId]
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

// DELETE /recomendados/:identificacion - Eliminar recomendado
app.delete('/recomendados/:identificacion', async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { identificacion } = req.params;

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

    // Verificar líderes asociados
    const [leaders] = await connection.execute(
      'SELECT * FROM lideres WHERE recomendado_identificacion = ?',
      [identificacion]
    );

    if (leaders.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        error: 'No se puede eliminar, existen líderes asociados a este recomendado',
        leaders: leaders
      });
    }

    // Eliminar recomendado
    await connection.execute(
      'DELETE FROM recomendados WHERE identificacion = ?',
      [identificacion]
    );

    await connection.commit();
    res.json({ message: 'Recomendado eliminado con éxito' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// DELETE /recomendados/bulk - Borrado masivo de recomendados
app.delete('/recomendados/bulk', async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Se requiere un array "ids" con al menos un ID' });
  }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Desasociar en líderes
    await connection.query(
      'UPDATE lideres SET recomendado_identificacion = NULL WHERE recomendado_identificacion IN (?)',
      [ids]
    );

    // Eliminar recomendados
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

// GET 1) /lideres - Obtener todos los líderes
app.get('/lideres', async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT
        l.identificacion AS lider_identificacion,
        l.nombre AS lider_nombre,
        l.apellido AS lider_apellido,
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

// GET 4) /lideres/distribution - Distribución de líderes
app.get('/lideres/distribution', async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT lider_identificacion, COUNT(*) AS total_votantes FROM votantes GROUP BY lider_identificacion'
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

    // Insertar nuevo líder
    await db.execute(
      `INSERT INTO lideres
       (identificacion, nombre, apellido, celular, email, recomendado_identificacion, objetivo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        identificacion,
        nombre.toUpperCase(),
        apellido.toUpperCase(),
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
    
    // Actualizar líder
    await connection.execute(
      `UPDATE lideres
       SET identificacion = ?, nombre = ?, apellido = ?, celular = ?, email = ?, 
           recomendado_identificacion = ?, objetivo = ?
       WHERE identificacion = ?`,
      [
        newId,
        nombre.toUpperCase(),
        apellido.toUpperCase(),
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

    // Si cambió el ID, actualizar referencias en votantes
    if (oldId !== newId) {
      await connection.execute(
        'UPDATE votantes SET lider_identificacion = ? WHERE lider_identificacion = ?',
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

// DELETE /lideres/:cedula - Eliminar líder
app.delete('/lideres/:cedula', async (req, res) => {
  try {
    const [result] = await db.execute(
      'DELETE FROM lideres WHERE identificacion = ?',
      [req.params.cedula]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Líder no encontrado' });
    }
    res.json({ message: 'Líder eliminado con éxito' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ==============================
//          VOTANTES
// ==============================

// PUT /votantes/reasignar - Reasignar votante
app.put('/votantes/reasignar', async (req, res) => {
  try {
    const {
      votante_identificacion,
      old_lider_identificacion,
      new_lider_identificacion,
      lider_intentado,
      nombre_intentado = '',
      apellido_intentado = '',
      direccion_intentado = '',
      celular_intentado = ''
    } = req.body;
    
    if (!votante_identificacion || !old_lider_identificacion || !new_lider_identificacion) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos' });
    }
    
    const connection = await db.getConnection();
    
    if (new_lider_identificacion === old_lider_identificacion) {
      // Mantener líder actual
      const logLeaderId = lider_intentado && lider_intentado !== old_lider_identificacion 
        ? lider_intentado 
        : old_lider_identificacion;
      
      const logMessage = `Duplicado detectado: se mantuvo el líder actual (${old_lider_identificacion}) para el votante (ID ${votante_identificacion}). Información de Excel ignorada.\n`;
      
      await connection.execute(
        'UPDATE lideres SET duplicados_log = CONCAT(IFNULL(duplicados_log, \'\'), ?) WHERE identificacion = ?',
        [logMessage, logLeaderId]
      );
    } else {
      // Reasignar votante
      await connection.execute(
        `UPDATE votantes 
         SET lider_identificacion = ?, nombre = ?, apellido = ?, direccion = ?, celular = ?
         WHERE identificacion = ? AND lider_identificacion = ?`,
        [
          new_lider_identificacion,
          nombre_intentado.toUpperCase(),
          apellido_intentado.toUpperCase(),
          direccion_intentado.toUpperCase(),
          celular_intentado.toUpperCase(),
          votante_identificacion,
          old_lider_identificacion
        ]
      );
      
      const logMessage = `Duplicado con reasignación: se reasignó el registro de votante (ID ${votante_identificacion}) del líder ${old_lider_identificacion} al líder ${new_lider_identificacion} con actualización de información.\n`;
      
      await connection.execute(
        'UPDATE lideres SET duplicados_log = CONCAT(IFNULL(duplicados_log, \'\'), ?) WHERE identificacion = ?',
        [logMessage, old_lider_identificacion]
      );
    }
    
    res.json({ message: 'Operación de reasignación completada con éxito' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /votantes - Obtener todos los votantes (con info básica del líder)
app.get('/votantes', async (req, res) => {
  try {
    const { lider_id } = req.query; // filtro opcional

    let sql = `
      SELECT v.identificacion, v.nombre, v.apellido,
             v.departamento, v.ciudad, v.barrio, v.direccion,
             v.zona, v.puesto, v.mesa, v.direccion_puesto,
             v.celular, v.email,
             v.lider_identificacion,
             l.nombre AS lider_nombre, l.apellido AS lider_apellido
      FROM votantes v
      LEFT JOIN lideres l ON l.identificacion = v.lider_identificacion
    `;
    const params = [];

    if (lider_id) {
      sql += " WHERE v.lider_identificacion = ?";
      params.push(lider_id);
    }

    sql += " ORDER BY v.identificacion";

    const [rows] = await db.execute(sql, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// GET /votantes/por-lider - Obtener votantes por líder (con info básica del líder)
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

    // Obtener votantes del líder
    const [votantes] = await db.execute(
      `SELECT identificacion, nombre, apellido, direccion, celular
       FROM votantes
       WHERE lider_identificacion = ?`,
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

// GET /votantes/por-lider-detalle - Igual que el anterior, pero podría incluir más detalle del líder
app.get('/votantes/por-lider-detalle', async (req, res) => {
  try {
    const { lider } = req.query;

    const [liderInfo] = await db.execute(
      'SELECT nombre, apellido, identificacion, celular FROM lideres WHERE identificacion = ?',
      [lider]
    );

    if (liderInfo.length === 0) {
      return res.status(404).json({ error: 'No se encontró un líder con esa identificación' });
    }

    const [votantes] = await db.execute(
      `SELECT identificacion, nombre, apellido, direccion, celular
       FROM votantes
       WHERE lider_identificacion = ?`,
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


// GET /votantes/buscar?query=texto - Buscar votantes por cualquier campo
app.get('/votantes/buscar', async (req, res) => {
  const query = `%${req.query.query}%`;
  try {
    const [rows] = await db.execute(
      `SELECT v.identificacion, v.nombre, v.apellido, v.direccion, v.celular, v.email,
              v.lider_identificacion, l.nombre AS lider_nombre, l.apellido AS lider_apellido
       FROM votantes v
       LEFT JOIN lideres l ON l.identificacion = v.lider_identificacion
       WHERE v.identificacion LIKE ?
          OR v.nombre LIKE ?
          OR v.apellido LIKE ?
          OR v.celular LIKE ?
          OR v.email LIKE ?
          OR v.direccion LIKE ?`,
      [query, query, query, query, query, query]
    );
    res.json(rows);
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

// POST /votantes/upload_csv - Cargar votantes desde CSV/Excel
app.post('/votantes/upload_csv', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }

    // Leer el archivo Excel
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    // Verificar columnas requeridas
    const requiredColumns = ['Cedula', 'Nombres', 'Apellidos', 'Direccion', 'Celular', 'Lider'];
    const hasRequiredColumns = requiredColumns.every(col =>
      data.length > 0 && data[0].hasOwnProperty(col)
    );

    if (!hasRequiredColumns) {
      return res.status(400).json({ error: 'El archivo Excel no tiene las columnas requeridas' });
    }

    let inserted = 0;
    const duplicados = [];

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      for (const row of data) {
        const cedula = String(row.Cedula || 0).trim();
        const nombres = String(row.Nombres || '').toUpperCase().trim();
        const apellidos = String(row.Apellidos || '').toUpperCase().trim();
        const direccion = String(row.Direccion || '').toUpperCase().trim();
        const celular = String(row.Celular || '0').toUpperCase().trim();
        const lider = String(row.Lider || 0).trim();

        // Verificar si ya existe
        const [existing] = await connection.execute(
          'SELECT * FROM votantes WHERE identificacion = ?',
          [cedula]
        );

        if (existing.length > 0) {
          const existingVotante = existing[0];
          let leaderNombre = null;

          if (existingVotante.lider_identificacion) {
            const [leaderInfo] = await connection.execute(
              'SELECT nombre FROM lideres WHERE identificacion = ?',
              [existingVotante.lider_identificacion]
            );
            leaderNombre = leaderInfo.length > 0 ? leaderInfo[0].nombre : null;
          }

          duplicados.push({
            identificacion: cedula,
            nombre: existingVotante.nombre,
            apellido: existingVotante.apellido,
            direccion: existingVotante.direccion,
            celular: existingVotante.celular,
            lider_identificacion: existingVotante.lider_identificacion,
            lider_nombre: leaderNombre,
            nombre_intentado: nombres,
            apellido_intentado: apellidos,
            direccion_intentado: direccion,
            celular_intentado: celular,
            lider_intentado: lider
          });
        } else {
          // Verificar que el líder existe
          const [leaderExists] = await connection.execute(
            'SELECT COUNT(*) as count FROM lideres WHERE identificacion = ?',
            [lider]
          );

          if (leaderExists[0].count === 0) {
            duplicados.push({
              identificacion: cedula,
              nombre: nombres,
              apellido: apellidos,
              direccion: direccion,
              celular: celular,
              error: `Líder con identificación ${lider} no existe`
            });
          } else {
            // Insertar nuevo votante
            await connection.execute(
              `INSERT INTO votantes
               (identificacion, nombre, apellido, direccion, celular, email, lider_identificacion)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [cedula, nombres, apellidos, direccion, celular, null, lider]
            );
            inserted++;
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
      message: 'Carga completada',
      insertados: inserted,
      duplicados: duplicados
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

// POST /votantes - Crear nuevo votante
app.post('/votantes', async (req, res) => {
  try {
    const {
      identificacion,
      nombre = '',
      apellido = '',
      direccion = '',
      celular = '',
      email = '',
      lider_identificacion
    } = req.body;
    
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Verificar si ya existe (con información del líder)
      const [existing] = await connection.execute(
        `SELECT v.*, l.nombre AS lider_nombre, l.apellido AS lider_apellido
         FROM votantes v
         LEFT JOIN lideres l ON v.lider_identificacion = l.identificacion
         WHERE v.identificacion = ?`,
        [identificacion]
      );

      if (existing.length > 0) {
        const existingVotante = existing[0];

        // Si no tiene nombre del líder pero sí tiene lider_identificacion
        if (!existingVotante.lider_nombre && existingVotante.lider_identificacion) {
          const [leaderInfo] = await connection.execute(
            'SELECT nombre FROM lideres WHERE identificacion = ?',
            [existingVotante.lider_identificacion]
          );
          if (leaderInfo.length > 0) {
            existingVotante.lider_nombre = leaderInfo[0].nombre;
          }
        }

        await connection.rollback();
        return res.status(400).json({
          error: 'El votante ya existe',
          duplicado: true,
          votante: existingVotante
        });
      }

      // Insertar nuevo votante
      await connection.execute(
        `INSERT INTO votantes
         (identificacion, nombre, apellido, direccion, celular, email, lider_identificacion)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          identificacion,
          nombre.toUpperCase(),
          apellido.toUpperCase(),
          direccion.toUpperCase(),
          celular.toUpperCase(),
          email.toUpperCase(),
          lider_identificacion
        ]
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    
    res.status(201).json({ message: 'Votante creado con éxito' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /votantes - Actualizar votante
app.put('/votantes', async (req, res) => {
  try {
    const {
      identificacion,
      nombre = '',
      apellido = '',
      direccion = '',
      celular = '',
      email = '',
      lider_identificacion
    } = req.body;
    
    // Verificar que existe
    const [existing] = await db.execute(
      'SELECT COUNT(*) as count FROM votantes WHERE identificacion = ?',
      [identificacion]
    );

    if (existing[0].count === 0) {
      return res.status(404).json({ error: 'El votante no existe' });
    }

    // Actualizar votante
    await db.execute(
      `UPDATE votantes
       SET nombre = ?, apellido = ?, direccion = ?, celular = ?, email = ?, lider_identificacion = ?
       WHERE identificacion = ?`,
      [
        nombre.toUpperCase(),
        apellido.toUpperCase(),
        direccion.toUpperCase(),
        celular.toUpperCase(),
        email.toUpperCase(),
        lider_identificacion,
        identificacion
      ]
    );
    
    res.json({ message: 'Votante actualizado con éxito' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /votantes/:identificacion - Eliminar votante
app.delete('/votantes/:identificacion', async (req, res) => {
  try {
    const [result] = await db.execute(
      'DELETE FROM votantes WHERE identificacion = ?',
      [req.params.identificacion]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'El votante no existe' });
    }
    
    res.json({ message: 'Votante eliminado con éxito' });
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
