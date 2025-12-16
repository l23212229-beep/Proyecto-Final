import express from 'express';
import session from 'express-session';
import bcrypt from 'bcrypt';
import mysql from 'mysql2/promise';
import path from 'path';
import dotenv from 'dotenv';
import multer from 'multer';
import XLSX from 'xlsx';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Para simular __dirname en ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'tech-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    maxAge: 24 * 60 * 60 * 1000 // 24 horas
  }
}));

// Configuración de multer para subir archivos
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB máximo
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.ms-excel' || 
        file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.originalname.match(/\.(xlsx|xls)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos Excel (.xlsx, .xls)'), false);
    }
  }
});

// Crear carpeta uploads si no existe
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Conexión a MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'sistema_biomedico',
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z'
});

// ===== FUNCIONES Y MIDDLEWARE =====
function requireLogin(req, res, next) {
  if (!req.session.usuario) {
    return res.redirect('/login.html');
  }
  next();
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    const usuario = req.session.usuario;
    if (!usuario) {
      return res.redirect('/login.html');
    }
    
    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    if (!roles.includes(usuario.tipo)) {
      return res.status(403).send(`
        <div class="tech-message">
          <div class="tech-message-icon"></div>
          <h2>Acceso Denegado</h2>
          <p>No tienes permisos para acceder a esta sección.</p>
          <p><strong>Tu rol:</strong> <span class="tech-badge badge-${usuario.tipo}">${usuario.tipo}</span></p>
          <p><strong>Roles permitidos:</strong> ${roles.join(', ')}</p>
          <div class="tech-actions">
            <a href="/index.html" class="tech-btn tech-btn-primary">
              <span class="tech-btn-icon">←</span> Volver al Inicio
            </a>
          </div>
        </div>
      `);
    }
    next();
  };
}

// Función para generar respuestas HTML con diseño tecnológico
function generateTechHTML(title, message, icon = '', redirectUrl = '/index.html', buttonText = 'Volver al Inicio') {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - Sistema Biomédico Tech</title>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      <nav class="tech-navbar">
        <div class="tech-nav-container">
          <div class="tech-brand">
            <div class="tech-logo">BIO-TECH</div>
            <div class="tech-tagline">Sistema Biomédico Inteligente</div>
          </div>
        </div>
      </nav>
      
      <div class="tech-container">
        <div class="tech-message">
          <div class="tech-message-icon">${icon}</div>
          <h2>${title}</h2>
          <p>${message}</p>
          <p>Redirigiendo en 3 segundos...</p>
          <div class="tech-actions">
            <a href="${redirectUrl}" class="tech-btn tech-btn-primary">
              <span class="tech-btn-icon">←</span> ${buttonText}
            </a>
          </div>
        </div>
      </div>
      
      <script>
        setTimeout(function() {
          window.location.href = '${redirectUrl}';
        }, 3000);
      </script>
    </body>
    </html>
  `;
}

// ===== RUTAS BÁSICAS =====
app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.get('/navbar.html', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'navbar.html'));
});

// ===== AUTENTICACIÓN =====
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  console.log('Intentando login para:', username);
  
  try {
    const connection = await pool.getConnection();
    console.log('Conexión a MySQL exitosa');
    connection.release();

    let [rows] = await pool.query(
      `SELECT id, username, password, tipo_usuario, nombre_completo 
       FROM usuarios 
       WHERE username = ? OR email = ?`,
      [username, username]
    );
    
    console.log(`Usuarios encontrados: ${rows.length}`);
    
    if (rows.length === 0) {
      return res.send(generateTechHTML(
        'Usuario No Encontrado',
        'El nombre de usuario o email no está registrado en el sistema.',
        '',
        '/login.html',
        'Volver al Login'
      ));
    }

    const usuario = rows[0];
    
    // Verificar si el usuario tiene contraseña
    if (!usuario.password) {
      return res.send(generateTechHTML(
        'Error de Configuración',
        'Este usuario no tiene contraseña configurada. Contacta al administrador.',
        '',
        '/login.html',
        'Volver al Login'
      ));
    }
    
    // Comparar contraseñas
    let valido = false;
    try {
      valido = await bcrypt.compare(password, usuario.password);
    } catch (bcryptErr) {
      console.error('Error bcrypt:', bcryptErr.message);
      valido = (password === usuario.password);
    }
    
    if (!valido) {
      return res.send(generateTechHTML(
        'Contraseña Incorrecta',
        'La contraseña ingresada no es válida.',
        '',
        '/login.html',
        'Volver al Login'
      ));
    }

    // Crear sesión
    req.session.usuario = {
      id: usuario.id,
      username: usuario.username,
      tipo: usuario.tipo_usuario,
      nombre: usuario.nombre_completo
    };

    console.log(`Login exitoso: ${usuario.username} (${usuario.tipo_usuario})`);
    
    res.redirect('/index.html');
  } catch (err) {
    console.error('ERROR en login:', err.message);
    
    let errorMessage = 'Error en el servidor durante el login';
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      errorMessage = 'Error de acceso a la base de datos';
    } else if (err.code === 'ER_NO_SUCH_TABLE') {
      errorMessage = 'La tabla de usuarios no existe';
    }
    
    res.send(generateTechHTML(
      'Error del Sistema',
      errorMessage,
      '',
      '/login.html',
      'Volver al Login'
    ));
  }
});

// ===== REGISTRO =====
app.post('/registro', async (req, res) => {
  const { username, password, tipo_usuario, nombre_completo, email } = req.body;

  try {
    const [existingUser] = await pool.query(
      'SELECT id FROM usuarios WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existingUser.length > 0) {
      return res.send(generateTechHTML(
        'Usuario Existente',
        'El nombre de usuario o email ya está registrado en el sistema.',
        '',
        '/registro.html',
        'Volver al Registro'
      ));
    }

    const hash = await bcrypt.hash(password, 10);
    
    await pool.query(
      `INSERT INTO usuarios (username, password, tipo_usuario, nombre_completo, email) 
       VALUES (?, ?, ?, ?, ?)`,
      [username, hash, tipo_usuario, nombre_completo, email]
    );

    res.send(generateTechHTML(
      'Registro Exitoso',
      'Tu cuenta ha sido creada exitosamente. Ahora puedes iniciar sesión.',
      '',
      '/login.html',
      'Ir al Login'
    ));
  } catch (err) {
    console.error('Error en registro:', err);
    res.send(generateTechHTML(
      'Error en Registro',
      'Hubo un problema al crear tu cuenta. Inténtalo nuevamente.',
      '',
      '/registro.html',
      'Volver al Registro'
    ));
  }
});

// ===== SESIÓN Y AUTENTICACIÓN =====
app.get('/api/session', (req, res) => {
  if (!req.session.usuario) {
    return res.json({ loggedIn: false });
  }
  res.json({
    loggedIn: true,
    tipo: req.session.usuario.tipo,
    username: req.session.usuario.username,
    nombre: req.session.usuario.nombre
  });
});

app.get('/auth/status', (req, res) => {
  if (req.session.usuario) {
    res.json({ 
      authenticated: true, 
      user: req.session.usuario 
    });
  } else {
    res.json({ authenticated: false });
  }
});

app.get('/tipo-usuario', (req, res) => {
  if (!req.session.usuario) {
    return res.json({ tipo_usuario: null });
  }
  res.json({ tipo_usuario: req.session.usuario.tipo });
});

// ===== RUTAS PARA PACIENTES (MEJORADAS) =====
app.get('/buscar-pacientes', requireLogin, async (req, res) => {
  const { q } = req.query;
  
  try {
    let query = `
      SELECT 
        p.id,
        u.nombre_completo as nombre,
        u.username as email,
        p.historial_clinico,
        p.grupo_sanguineo
      FROM pacientes p
      LEFT JOIN usuarios u ON p.usuario_id = u.id
      WHERE 1=1
    `;
    const params = [];
    
    if (q && q.trim() !== '') {
      query += ' AND (u.nombre_completo LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR p.id = ? OR p.historial_clinico LIKE ?)';
      const searchTerm = `%${q}%`;
      params.push(searchTerm, searchTerm, searchTerm, isNaN(q) ? 0 : parseInt(q), searchTerm);
    }
    
    // Si es paciente, solo puede ver su propia información
    if (req.session.usuario.tipo === 'paciente') {
      query += ' AND u.id = ?';
      params.push(req.session.usuario.id);
    }
    
    query += ' ORDER BY p.id DESC LIMIT 50';
    
    const [pacientes] = await pool.query(query, params);
    res.json(pacientes);
  } catch (err) {
    console.error('Error en búsqueda de pacientes:', err);
    res.status(500).json({ error: 'Error en la búsqueda', details: err.message });
  }
});

// ===== NUEVO: OBTENER DATOS DE PACIENTE POR ID =====
app.get('/paciente/:id', requireLogin, async (req, res) => {
  try {
    const [paciente] = await pool.query(`
      SELECT 
        p.*,
        u.nombre_completo,
        u.username,
        u.email,
        u.tipo_usuario
      FROM pacientes p
      LEFT JOIN usuarios u ON p.usuario_id = u.id
      WHERE p.id = ?
    `, [req.params.id]);
    
    if (paciente.length === 0) {
      return res.status(404).json({ error: 'Paciente no encontrado' });
    }
    
    // Verificar permisos
    if (req.session.usuario.tipo === 'paciente' && paciente[0].usuario_id !== req.session.usuario.id) {
      return res.status(403).json({ error: 'No tienes permisos para ver este paciente' });
    }
    
    res.json(paciente[0]);
  } catch (err) {
    console.error('Error al obtener paciente:', err);
    res.status(500).json({ error: 'Error al obtener paciente' });
  }
});

app.post('/submit-data', requireLogin, requireRole(['medico', 'admin']), async (req, res) => {
  const { name, age, heart_rate, email, grupo_sanguineo, alergias, enfermedades_cronicas } = req.body;
  
  try {
    const tempPassword = await bcrypt.hash('temp123', 10);
    const [usuarioResult] = await pool.query(
      'INSERT INTO usuarios (username, password, tipo_usuario, email, nombre_completo) VALUES (?, ?, ?, ?, ?)',
      [email || `paciente_${Date.now()}`, tempPassword, 'paciente', email || null, name || 'Paciente sin nombre']
    );
    
    const usuarioId = usuarioResult.insertId;
    
    await pool.query(
      `INSERT INTO pacientes (
        usuario_id, 
        historial_clinico, 
        grupo_sanguineo,
        alergias,
        enfermedades_cronicas
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        usuarioId,
        `Registro inicial - Nombre: ${name}, Edad: ${age}, Frecuencia cardíaca: ${heart_rate}`,
        grupo_sanguineo || 'O+',
        alergias || 'No especificadas',
        enfermedades_cronicas || 'No especificadas'
      ]
    );

    res.send(generateTechHTML(
      'Paciente Registrado',
      'El paciente ha sido registrado exitosamente en el sistema.',
      '',
      '/index.html',
      'Volver al Inicio'
    ));
  } catch (err) {
    console.error('Error al guardar paciente:', err);
    res.send(generateTechHTML(
      'Error al Guardar',
      'Hubo un error al registrar el paciente: ' + err.message,
      '',
      '/index.html',
      'Volver al Inicio'
    ));
  }
});

// ===== RUTAS PARA ENSAYOS CLÍNICOS (AJUSTADAS A TU BASE DE DATOS) =====
app.get('/api/ensayos', requireLogin, requireRole(['admin', 'medico', 'investigador']), async (req, res) => {
  try {
    const [ensayos] = await pool.query(`
      SELECT e.*, u.username as creado_por, u.nombre_completo
      FROM ensayos_clinicos e
      LEFT JOIN usuarios u ON e.usuario_id = u.id
      ORDER BY e.creado_en DESC
    `);
    res.json(ensayos);
  } catch (err) {
    console.error('Error al obtener ensayos:', err);
    res.status(500).json({ error: 'Error al obtener ensayos' });
  }
});

app.post('/api/ensayos', requireLogin, requireRole(['admin', 'medico']), async (req, res) => {
  try {
    const { titulo, description, fecha_inicio, fecha_fin, estado } = req.body;
    
    const [result] = await pool.query(
      `INSERT INTO ensayos_clinicos 
       (titulo, description, fecha_inicio, fecha_fin, estado, usuario_id) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [titulo, description, fecha_inicio, fecha_fin, estado || 'activo', req.session.usuario.id]
    );
    
    res.json({ 
      success: true, 
      message: 'Ensayo creado exitosamente',
      id: result.insertId 
    });
  } catch (err) {
    console.error('Error al crear ensayo:', err);
    res.status(500).json({ error: 'Error al crear ensayo' });
  }
});

app.put('/api/ensayos/:id', requireLogin, requireRole(['admin', 'medico']), async (req, res) => {
  try {
    const { titulo, description, fecha_inicio, fecha_fin, estado } = req.body;
    
    await pool.query(
      `UPDATE ensayos_clinicos 
       SET titulo = ?, description = ?, fecha_inicio = ?, fecha_fin = ?, estado = ?
       WHERE id = ?`,
      [titulo, description, fecha_inicio, fecha_fin, estado, req.params.id]
    );
    
    res.json({ success: true, message: 'Ensayo actualizado exitosamente' });
  } catch (err) {
    console.error('Error al actualizar ensayo:', err);
    res.status(500).json({ error: 'Error al actualizar ensayo' });
  }
});

app.delete('/api/ensayos/:id', requireLogin, requireRole(['admin']), async (req, res) => {
  try {
    await pool.query('DELETE FROM ensayos_clinicos WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Ensayo eliminado exitosamente' });
  } catch (err) {
    console.error('Error al eliminar ensayo:', err);
    res.status(500).json({ error: 'Error al eliminar ensayo' });
  }
});

// ===== RUTAS PARA SUBIR/DESCARGAR EXCEL =====
app.post('/upload-excel', requireLogin, requireRole(['admin', 'medico']), upload.single('excelFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se subió ningún archivo' });
    }
    
    const filePath = req.file.path;
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`Archivo Excel procesado: ${data.length} registros encontrados`);
    
    // Procesar cada registro
    let registrosExitosos = 0;
    let errores = [];
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      try {
        // Verificar si el usuario ya existe
        const [existingUser] = await pool.query(
          'SELECT id FROM usuarios WHERE username = ? OR email = ?',
          [row.usuario || row.email, row.email]
        );
        
        if (existingUser.length > 0) {
          errores.push(`Fila ${i + 2}: Usuario ${row.usuario || row.email} ya existe`);
          continue;
        }
        
        // Crear usuario
        const tempPassword = await bcrypt.hash('temp123', 10);
        const [usuarioResult] = await pool.query(
          'INSERT INTO usuarios (username, password, tipo_usuario, email, nombre_completo) VALUES (?, ?, ?, ?, ?)',
          [
            row.usuario || row.email || `paciente_${Date.now()}_${i}`,
            tempPassword,
            'paciente',
            row.email || null,
            row.nombre || 'Paciente sin nombre'
          ]
        );
        
        // Crear paciente
        await pool.query(
          `INSERT INTO pacientes (
            usuario_id, 
            historial_clinico, 
            grupo_sanguineo,
            alergias,
            enfermedades_cronicas,
            medicamentos_actuales,
            contacto_emergencia,
            telefono_emergencia
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            usuarioResult.insertId,
            row.historial_clinico || `Importado desde Excel - ${new Date().toLocaleDateString()}`,
            row.grupo_sanguineo || 'O+',
            row.alergias || 'No especificadas',
            row.enfermedades_cronicas || 'No especificadas',
            row.medicamentos || 'No especificados',
            row.contacto_emergencia || 'No especificado',
            row.telefono_emergencia || 'No especificado'
          ]
        );
        
        registrosExitosos++;
      } catch (error) {
        errores.push(`Fila ${i + 2}: ${error.message}`);
      }
    }
    
    // Eliminar archivo temporal
    fs.unlinkSync(filePath);
    
    res.json({
      success: true,
      message: `Procesamiento completado: ${registrosExitosos} registros exitosos, ${errores.length} errores`,
      registrosExitosos,
      errores
    });
    
  } catch (err) {
    console.error('Error al procesar Excel:', err);
    res.status(500).json({ 
      error: 'Error al procesar el archivo Excel',
      details: err.message 
    });
  }
});

app.get('/download-excel', requireLogin, requireRole(['admin', 'medico']), async (req, res) => {
  try {
    const [pacientes] = await pool.query(`
      SELECT 
        p.id as paciente_id,
        u.nombre_completo as nombre,
        u.email,
        u.username,
        p.grupo_sanguineo,
        p.alergias,
        p.enfermedades_cronicas,
        p.medicamentos_actuales,
        p.contacto_emergencia,
        p.telefono_emergencia,
        p.historial_clinico
      FROM pacientes p
      LEFT JOIN usuarios u ON p.usuario_id = u.id
      ORDER BY p.id DESC
    `);
    
    // Crear workbook de Excel
    const workbook = XLSX.utils.book_new();
    
    // Convertir datos a worksheet
    const worksheet = XLSX.utils.json_to_sheet(pacientes);
    
    // Agregar worksheet al workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Pacientes');
    
    // Generar buffer de Excel
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    // Configurar headers para descarga
    res.setHeader('Content-Disposition', 'attachment; filename=pacientes.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    
    // Enviar archivo
    res.send(excelBuffer);
    
  } catch (err) {
    console.error('Error al generar Excel:', err);
    res.status(500).json({ error: 'Error al generar archivo Excel' });
  }
});

// ===== RUTAS ADMIN =====
app.get('/ver-usuarios', requireLogin, requireRole('admin'), async (req, res) => {
  try {
    const [usuarios] = await pool.query(`
      SELECT id, username, tipo_usuario, nombre_completo, email, fecha_registro 
      FROM usuarios 
      ORDER BY fecha_registro DESC
    `);
    
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Usuarios del Sistema - Bio-Tech</title>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      <nav class="tech-navbar">
        <div class="tech-nav-container">
          <div class="tech-brand">
            <div class="tech-logo">BIO-TECH</div>
            <div class="tech-tagline">Gestión de Usuarios</div>
          </div>
          <ul class="tech-nav-menu">
            <li class="tech-nav-item">
              <a href="/index.html" class="tech-nav-link">
                <span class="tech-nav-icon">Inicio</span>
              </a>
            </li>
          </ul>
        </div>
      </nav>
      
      <div class="tech-container">
        <div class="tech-hero">
          <h1>Gestión de Usuarios</h1>
          <p>Administra todos los usuarios del sistema biomédico</p>
          <p><strong>Usuario actual:</strong> ${req.session.usuario.username} 
            <span class="tech-badge badge-${req.session.usuario.tipo}">${req.session.usuario.tipo}</span>
          </p>
        </div>
        
        <div class="tech-table-container">
          <table class="tech-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Nombre Completo</th>
                <th>Email</th>
                <th>Fecha Registro</th>
              </tr>
            </thead>
            <tbody>
    `;
    
    usuarios.forEach(u => {
      html += `
        <tr>
          <td>${u.id}</td>
          <td><strong>${u.username}</strong></td>
          <td><span class="tech-badge badge-${u.tipo_usuario}">${u.tipo_usuario}</span></td>
          <td>${u.nombre_completo || 'No especificado'}</td>
          <td>${u.email || 'No tiene'}</td>
          <td>${new Date(u.fecha_registro).toLocaleDateString('es-MX', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })}</td>
        </tr>
      `;
    });
    
    html += `
            </tbody>
          </table>
        </div>
        
        <div class="tech-actions">
          <a href="/index.html" class="tech-btn tech-btn-primary">
            <span class="tech-btn-icon">←</span> Volver al Inicio
          </a>
          <a href="/registro.html" class="tech-btn tech-btn-accent">
            <span class="tech-btn-icon">+</span> Agregar Nuevo Usuario
          </a>
        </div>
      </div>
    </body>
    </html>
    `;
    
    res.send(html);
  } catch (err) {
    console.error('Error al obtener usuarios:', err);
    res.status(500).send(generateTechHTML(
      'Error del Sistema',
      'No se pudieron obtener los datos de usuarios.',
      '',
      '/index.html',
      'Volver al Inicio'
    ));
  }
});

// ===== VER PACIENTES (Solo médicos y admin) =====
app.get('/ver-pacientes', requireLogin, requireRole(['medico', 'admin']), async (req, res) => {
  try {
    const [pacientes] = await pool.query(`
      SELECT 
        p.id,
        p.usuario_id,
        COALESCE(p.historial_clinico, 'Sin historial') as historial_clinico,
        COALESCE(p.grupo_sanguineo, 'No especificado') as grupo_sanguineo,
        COALESCE(p.alergias, 'No especificadas') as alergias,
        COALESCE(p.enfermedades_cronicas, 'No especificadas') as enfermedades_cronicas,
        COALESCE(p.medicamentos_actuales, 'No especificados') as medicamentos_actuales,
        COALESCE(p.contacto_emergencia, 'No especificado') as contacto_emergencia,
        COALESCE(p.telefono_emergencia, 'No especificado') as telefono_emergencia,
        u.username as usuario_asociado,
        COALESCE(u.email, 'No tiene email') as email_usuario,
        u.nombre_completo
      FROM pacientes p
      LEFT JOIN usuarios u ON p.usuario_id = u.id
      ORDER BY p.id DESC
    `);
    
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Pacientes - Bio-Tech</title>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      <nav class="tech-navbar">
        <div class="tech-nav-container">
          <div class="tech-brand">
            <div class="tech-logo">BIO-TECH</div>
            <div class="tech-tagline">Registros de Pacientes</div>
          </div>
          <ul class="tech-nav-menu">
            <li class="tech-nav-item">
              <a href="/index.html" class="tech-nav-link">
                <span class="tech-nav-icon">Inicio</span>
              </a>
            </li>
          </ul>
        </div>
      </nav>
      
      <div class="tech-container">
        <div class="tech-hero">
          <h1>Registro de Pacientes</h1>
          <p>Visualiza y gestiona los registros médicos de pacientes</p>
          <p><strong>Usuario actual:</strong> ${req.session.usuario.username} 
            <span class="tech-badge badge-${req.session.usuario.tipo}">${req.session.usuario.tipo}</span>
          </p>
          <p><strong>Total de pacientes:</strong> ${pacientes.length}</p>
        </div>
    `;
    
    if (pacientes.length === 0) {
      html += `
        <div class="tech-message">
          <div class="tech-message-icon"></div>
          <h2>No hay pacientes registrados</h2>
          <p>No se encontraron registros de pacientes en el sistema.</p>
          <div class="tech-actions">
            <a href="/index.html" class="tech-btn tech-btn-primary">
              <span class="tech-btn-icon">←</span> Volver al Inicio
            </a>
          </div>
        </div>
      `;
    } else {
      html += `
        <div class="tech-table-container">
          <table class="tech-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Nombre</th>
                <th>Email</th>
                <th>Grupo Sanguíneo</th>
                <th>Historial Clínico</th>
              </tr>
            </thead>
            <tbody>
      `;
      
      pacientes.forEach(p => {
        html += `
          <tr>
            <td><strong>#${p.id}</strong></td>
            <td>${p.nombre_completo || 'Sin nombre'}</td>
            <td>${p.email_usuario}</td>
            <td><span class="tech-badge">${p.grupo_sanguineo}</span></td>
            <td>${p.historial_clinico.substring(0, 50)}${p.historial_clinico.length > 50 ? '...' : ''}</td>
          </tr>
        `;
      });
      
      html += `
            </tbody>
          </table>
        </div>
      `;
    }
    
    html += `
        <div class="tech-actions">
          <a href="/index.html" class="tech-btn tech-btn-primary">
            <span class="tech-btn-icon">←</span> Volver al Inicio
          </a>
          <a href="/submit-data.html" class="tech-btn tech-btn-accent">
            <span class="tech-btn-icon">+</span> Agregar Nuevo Paciente
          </a>
          <a href="/download-excel" class="tech-btn tech-btn-success">
            <span class="tech-btn-icon">↓</span> Descargar Excel
          </a>
        </div>
      </div>
    </body>
    </html>
    `;
    
    res.send(html);
  } catch (err) {
    console.error('Error en /ver-pacientes:', err.message);
    res.send(generateTechHTML(
      'Error del Sistema',
      'No se pudieron obtener los datos de pacientes.',
      '',
      '/index.html',
      'Volver al Inicio'
    ));
  }
});

// ===== ENSAYOS CLÍNICOS (Solo médicos, admin e investigadores) =====
app.get('/ensayos', requireLogin, requireRole(['admin', 'medico', 'investigador']), async (req, res) => {
  try {
    const [ensayos] = await pool.query(`
      SELECT e.*, u.username as creado_por 
      FROM ensayos_clinicos e
      LEFT JOIN usuarios u ON e.usuario_id = u.id
      ORDER BY e.creado_en DESC
    `);
    
    let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Ensayos Clínicos - Bio-Tech</title>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      <nav class="tech-navbar">
        <div class="tech-nav-container">
          <div class="tech-brand">
            <div class="tech-logo">BIO-TECH</div>
            <div class="tech-tagline">Investigación Clínica</div>
          </div>
          <ul class="tech-nav-menu">
            <li class="tech-nav-item">
              <a href="/index.html" class="tech-nav-link">
                <span class="tech-nav-icon">Inicio</span>
              </a>
            </li>
          </ul>
        </div>
      </nav>
      
      <div class="tech-container">
        <div class="tech-hero">
          <h1>Ensayos Clínicos</h1>
          <p>Gestiona y monitorea estudios de investigación médica</p>
          <p><strong>Usuario actual:</strong> ${req.session.usuario.username} 
            <span class="tech-badge badge-${req.session.usuario.tipo}">${req.session.usuario.tipo}</span>
          </p>
        </div>
        
        <div class="tech-card-grid">
    `;
    
    ensayos.forEach(ensayo => {
      const estadoColor = ensayo.estado === 'activo' ? 'tech-btn-accent' : 
                         ensayo.estado === 'completado' ? 'tech-btn-primary' : 'tech-btn-secondary';
      
      html += `
        <div class="tech-card">
          <div class="tech-card-icon">E</div>
          <h3>${ensayo.titulo}</h3>
          <p>${ensayo.description || 'Sin descripción'}</p>
          <div style="margin: 1rem 0;">
            <span class="${estadoColor} tech-btn" style="padding: 5px 15px; font-size: 0.9rem;">
              ${ensayo.estado.toUpperCase()}
            </span>
          </div>
          <p><small><strong>Fecha inicio:</strong> ${ensayo.fecha_inicio || 'No definida'}</
