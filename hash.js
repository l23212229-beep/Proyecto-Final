import bcrypt from 'bcrypt';

const run = async () => {
  const hash = await bcrypt.hash('tbd2025', 10);
  console.log(hash);
};

run();
