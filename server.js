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
//        RECOMENDADOS
// ==============================

// GET /recomendados - Obtener todos los recomendados
app.get('/recomendados', async (req, res) => {
  try {
    const connection = await getDbConnection();
    const [rows] = await connection.execute(
      'SELECT identificacion, nombre, apellido, celular, email FROM recomendados'
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /recomendados/:cedula - Obtener recomendado por cédula
app.get('/recomendados/:cedula', async (req, res) => {
  try {
    const connection = await getDbConnection();
    const [rows] = await connection.execute(
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
    
    const connection = await getDbConnection();
    
    // Verificar si ya existe
    const [existing] = await connection.execute(
      'SELECT COUNT(*) as count FROM recomendados WHERE identificacion = ?',
      [identificacion]
    );
    
    if (existing[0].count > 0) {
      return res.status(400).json({ error: 'El recomendado ya existe' });
    }
    
    // Insertar nuevo recomendado
    await connection.execute(
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
  const connection = await getDbConnection();
  try {
    const oldId = req.params.old_id;
    const { 
      original_identificacion = oldId,
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
      [original_identificacion]
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
      [newId, nombre.toUpperCase(), apellido.toUpperCase(), celular.toUpperCase(), email.toUpperCase(), original_identificacion]
    );
    
    // Si cambió el ID, actualizar referencias en líderes
    if (original_identificacion !== newId) {
      await connection.execute(
        'UPDATE lideres SET recomendado_identificacion = ? WHERE recomendado_identificacion = ?',
        [newId, original_identificacion]
      );
    }
    
    await connection.commit();
    res.json({ message: 'Recomendado y líderes asociados actualizados con éxito' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  }
});

// DELETE /recomendados/:identificacion - Eliminar recomendado
app.delete('/recomendados/:identificacion', async (req, res) => {
  try {
    const { identificacion } = req.params;
    
    const connection = await getDbConnection();
    
    // Verificar que existe
    const [existing] = await connection.execute(
      'SELECT COUNT(*) as count FROM recomendados WHERE identificacion = ?',
      [identificacion]
    );
    
    if (existing[0].count === 0) {
      return res.status(404).json({ error: 'El recomendado no existe' });
    }
    
    // Verificar líderes asociados
    const [leaders] = await connection.execute(
      'SELECT * FROM lideres WHERE recomendado_identificacion = ?',
      [identificacion]
    );
    
    if (leaders.length > 0) {
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
    
    res.json({ message: 'Recomendado eliminado con éxito' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /lideres/por-recomendado - Obtener líderes por recomendado
app.get('/lideres/por-recomendado', async (req, res) => {
  try {
    const { recomendado } = req.query;
    
    if (!recomendado) {
      return res.status(400).json({ error: 'Se requiere la cédula del recomendado' });
    }
    
    const connection = await getDbConnection();
    const [rows] = await connection.execute(
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

// ==============================
//          LÍDERES
// ==============================

// GET /lideres - Obtener todos los líderes
app.get('/lideres', async (req, res) => {
  try {
    const connection = await getDbConnection();
    const [rows] = await connection.execute(
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

// GET /lideres/:cedula - Obtener líder por cédula
app.get('/lideres/:cedula', async (req, res) => {
  try {
    const connection = await getDbConnection();
    const [rows] = await connection.execute(
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
    
    const connection = await getDbConnection();
    
    // Verificar si ya existe
    const [existing] = await connection.execute(
      'SELECT COUNT(*) as count FROM lideres WHERE identificacion = ?',
      [identificacion]
    );
    
    if (existing[0].count > 0) {
      return res.status(400).json({ error: 'El líder ya existe' });
    }
    
    // Insertar nuevo líder
    await connection.execute(
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
  const connection = await getDbConnection();
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
    
    // Si cambió el ID, actualizar referencias en votantes
    if (oldId !== newId) {
      await connection.execute(
        'UPDATE votantes SET lider_identificacion = ? WHERE lider_identificacion = ?',
        [newId, oldId]
      );
    }
    
    await connection.commit();
    res.json({ message: 'Líder y votantes asociados actualizados con éxito' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  }
});

// DELETE /lideres/:cedula - Eliminar líder
app.delete('/lideres/:cedula', async (req, res) => {
  try {
    const connection = await getDbConnection();
    const [result] = await connection.execute(
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

// GET /lideres/distribution - Distribución de líderes
app.get('/lideres/distribution', async (req, res) => {
  try {
    const connection = await getDbConnection();
    const [rows] = await connection.execute(
      'SELECT lider_identificacion, COUNT(*) AS total_votantes FROM votantes GROUP BY lider_identificacion'
    );
    res.json(rows);
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
    
    const connection = await getDbConnection();
    
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
    
    const connection = await getDbConnection();
    
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
    
    const connection = await getDbConnection();
    
    // Verificar que existe
    const [existing] = await connection.execute(
      'SELECT COUNT(*) as count FROM votantes WHERE identificacion = ?',
      [identificacion]
    );
    
    if (existing[0].count === 0) {
      return res.status(404).json({ error: 'El votante no existe' });
    }
    
    // Actualizar votante
    await connection.execute(
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
    const connection = await getDbConnection();
    const [result] = await connection.execute(
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

// GET /votantes/por-lider - Obtener votantes por líder
app.get('/votantes/por-lider', async (req, res) => {
  try {
    const { lider } = req.query;
    
    const connection = await getDbConnection();
    
    // Obtener votantes del líder
    const [votantes] = await connection.execute(
      `SELECT identificacion, nombre, apellido, direccion, celular
       FROM votantes
       WHERE lider_identificacion = ?`,
      [lider]
    );
    
    if (votantes.length === 0) {
      // Verificar si el líder existe
      const [liderInfo] = await connection.execute(
        'SELECT identificacion, nombre, apellido FROM lideres WHERE identificacion = ?',
        [lider]
      );
      
      if (liderInfo.length > 0) {
        return res.json({ lider: liderInfo[0], votantes: [] });
      } else {
        return res.status(404).json({ error: 'No se encontró un líder con esa identificación.' });
      }
    }
    
    // Obtener información del líder
    const [liderInfo] = await connection.execute(
      'SELECT identificacion, nombre, apellido FROM lideres WHERE identificacion = ?',
      [lider]
    );
    
    res.json({ lider: liderInfo[0], votantes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /votantes/por-lider-detalle - Obtener votantes por líder con detalles
app.get('/votantes/por-lider-detalle', async (req, res) => {
  try {
    const { lider } = req.query;
    
    const connection = await getDbConnection();
    
    // Obtener información del líder
    const [liderInfo] = await connection.execute(
      'SELECT nombre, apellido, identificacion FROM lideres WHERE identificacion = ?',
      [lider]
    );
    
    if (liderInfo.length === 0) {
      return res.status(404).json({ error: 'No se encontró un líder con esa identificación' });
    }
    
    // Obtener votantes del líder
    const [votantes] = await connection.execute(
      `SELECT 
        identificacion AS votante_identificacion,
        nombre AS votante_nombre,
        apellido AS votante_apellido,
        direccion,
        celular
       FROM votantes
       WHERE lider_identificacion = ?`,
      [lider]
    );
    
    res.json({ lider: liderInfo[0], votantes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /votantes/upload_csv - Cargar votantes desde Excel
app.post('/votantes/upload_csv', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se envió ningún archivo' });
    }
    
    if (!req.file.filename.endsWith('.xlsx') && !req.file.filename.endsWith('.xls')) {
      return res.status(400).json({ error: 'El archivo debe tener una extensión .xlsx o .xls' });
    }
    
    // Leer archivo Excel
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    const requiredColumns = ['Cedula', 'Nombres', 'Apellidos', 'Celular', 'Direccion', 'Lider'];
    const firstRow = data[0] || {};
    const hasRequiredColumns = requiredColumns.every(col => col in firstRow);
    
    if (!hasRequiredColumns) {
      return res.status(400).json({ error: 'El archivo Excel no tiene las columnas requeridas' });
    }
    
    let inserted = 0;
    const duplicados = [];
    
    const connection = await getDbConnection();
    
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
    
    // Eliminar archivo temporal
    fs.unlinkSync(req.file.path);
    
    res.status(201).json({
      message: 'Carga completada',
      insertados: inserted,
      duplicados: duplicados
    });
  } catch (error) {
    res.status(500).json({ error: `Error al procesar el archivo: ${error.message}` });
  }
});

// ==============================
//    DASHBOARD Y REPORTES
// ==============================

// GET /votantes/total - Total de votantes
app.get('/votantes/total', async (req, res) => {
  try {
    const connection = await getDbConnection();
    const [rows] = await connection.execute('SELECT COUNT(*) as total FROM votantes');
    
    res.json({
      total: rows[0].total,
      trend: 'equal' // Placeholder para lógica de tendencia
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /lideres/total - Total de líderes
app.get('/lideres/total', async (req, res) => {
  try {
    const connection = await getDbConnection();
    const [rows] = await connection.execute('SELECT COUNT(*) as total FROM lideres');
    
    res.json({
      total: rows[0].total,
      trend: 'equal' // Placeholder para lógica de tendencia
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /recomendados/total - Total de recomendados
app.get('/recomendados/total', async (req, res) => {
  try {
    const connection = await getDbConnection();
    const [rows] = await connection.execute('SELECT COUNT(*) as total FROM recomendados');
    
    res.json({
      total: rows[0].total,
      trend: 'equal' // Placeholder para lógica de tendencia
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /votantes/promedio_lider - Promedio de votantes por líder
app.get('/votantes/promedio_lider', async (req, res) => {
  try {
    const connection = await getDbConnection();
    
    // Contar votantes totales
    const [votantesResult] = await connection.execute('SELECT COUNT(*) as total_votantes FROM votantes');
    const totalVotantes = votantesResult[0].total_votantes;
    
    // Contar líderes totales
    const [lideresResult] = await connection.execute('SELECT COUNT(*) as total_lideres FROM lideres');
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
    const connection = await getDbConnection();
    
    // Nota: Asumiendo que existe una columna 'created_at' en la tabla votantes
    // Si no existe, necesitarás ajustar esta consulta o crear la columna
    const [rows] = await connection.execute(`
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
    message: process.env.NODE_ENV === 'development' ? error.message : 'Error interno'
  });
});

// Manejo de rutas no encontradas
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Ruta no encontrada',
    path: req.originalUrl 
  });
});

// Manejar el cierre graceful del pool de conexiones
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