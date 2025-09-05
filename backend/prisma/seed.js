const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // Create sample users
  const user1 = await prisma.user.upsert({
    where: { email: 'john@example.com' },
    update: {},
    create: {
      email: 'john@example.com',
      name: 'John Doe',
    },
  });

  const user2 = await prisma.user.upsert({
    where: { email: 'jane@example.com' },
    update: {},
    create: {
      email: 'jane@example.com',
      name: 'Jane Smith',
    },
  });

  // Create sample posts
  const post1 = await prisma.post.upsert({
    where: { id: 1 },
    update: {},
    create: {
      title: 'First Post',
      content: 'This is the content of the first post.',
      published: true,
      authorId: user1.id,
    },
  });

  const post2 = await prisma.post.upsert({
    where: { id: 2 },
    update: {},
    create: {
      title: 'Second Post',
      content: 'This is the content of the second post.',
      published: false,
      authorId: user2.id,
    },
  });

  console.log('Database seeded successfully!');
  console.log({ user1, user2, post1, post2 });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
