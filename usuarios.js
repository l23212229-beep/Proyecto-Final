import bcrypt from 'bcrypt';

async function crearUsuarios() {
  console.log('Generando contraseñas...');
  
  // Contraseñas de prueba
  const usuarios = [
    { username: 'admin', password: 'admin123', tipo: 'admin', nombre: 'Administrador', email: 'admin@hospital.com' },
    { username: 'doctor', password: 'doctor123', tipo: 'medico', nombre: 'Dr. Juan Pérez', email: 'doctor@hospital.com' },
    { username: 'paciente', password: 'paciente123', tipo: 'paciente', nombre: 'María González', email: 'maria@email.com' },
    { username: 'emiliano', password: 'emiliano123', tipo: 'admin', nombre: 'Emiliano Rodriguez', email: 'emiliano@gmail.com' }
  ];

  for (const usuario of usuarios) {
    const hash = await bcrypt.hash(usuario.password, 10);
    console.log(`\nUsuario: ${usuario.username}`);
    console.log(`Contraseña: ${usuario.password}`);
    console.log(`Hash: ${hash}`);
    console.log(`SQL: INSERT INTO usuarios (username, password, tipo_usuario, nombre_completo, email) VALUES ('${usuario.username}', '${hash}', '${usuario.tipo}', '${usuario.nombre}', '${usuario.email}');`);
  }
}

crearUsuarios();
