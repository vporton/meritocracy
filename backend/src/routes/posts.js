const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/posts - Get all posts
router.get('/', async (req, res) => {
  try {
    const { published } = req.query;
    const posts = await prisma.post.findMany({
      where: published !== undefined ? { published: published === 'true' } : {},
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    res.json(posts);
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// GET /api/posts/:id - Get post by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const post = await prisma.post.findUnique({
      where: { id: parseInt(id) },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json(post);
  } catch (error) {
    console.error('Error fetching post:', error);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

// POST /api/posts - Create new post
router.post('/', async (req, res) => {
  try {
    const { title, content, published, authorId } = req.body;

    if (!title || !authorId) {
      return res.status(400).json({ error: 'Title and authorId are required' });
    }

    const post = await prisma.post.create({
      data: {
        title,
        content: content || null,
        published: published || false,
        authorId: parseInt(authorId),
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.status(201).json(post);
  } catch (error) {
    console.error('Error creating post:', error);
    if (error.code === 'P2003') {
      return res.status(400).json({ error: 'Author not found' });
    }
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// PUT /api/posts/:id - Update post
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, published } = req.body;

    const post = await prisma.post.update({
      where: { id: parseInt(id) },
      data: {
        ...(title && { title }),
        ...(content !== undefined && { content }),
        ...(published !== undefined && { published }),
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.json(post);
  } catch (error) {
    console.error('Error updating post:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// DELETE /api/posts/:id - Delete post
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.post.delete({
      where: { id: parseInt(id) },
    });

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting post:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

module.exports = router;
