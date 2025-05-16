import { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { User, insertUserSchema } from "@shared/schema";
import { z } from 'zod';
import { createHash } from 'crypto';

// Simple password hashing using SHA-256
function hashPassword(password: string): string {
  console.log('Hashing password:', password);
  const hash = createHash('sha256').update(password).digest('hex');
  console.log('Hashed result:', hash);
  return hash;
}

// Create a session token for a user
function createSessionToken(userId: number): string {
  const token = createHash('sha256')
    .update(`${userId}-${Date.now()}-${Math.random()}`)
    .digest('hex');
  return token;
}

// In-memory session storage for development
export const sessions: Record<string, { userId: number; expires: Date }> = {};

// Login schema
const loginSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
});

// Register schema - extends login schema
const registerSchema = loginSchema.extend({
  displayName: z.string().min(2),
  avatar: z.string().url().optional(),
  description: z.string().optional(),
});

// Middleware to check if user is authenticated
function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token || !sessions[token] || sessions[token].expires < new Date()) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  
  // Add userId to request
  (req as any).userId = sessions[token].userId;
  next();
}

export function setupAuth(app: Express) {
  // Register endpoint
  app.post('/api/register', async (req, res) => {
    try {
      const validatedData = registerSchema.parse(req.body);
      
      // Check if username already exists
      const existingUser = await storage.getUserByUsername(validatedData.username);
      if (existingUser) {
        return res.status(400).json({ message: 'Username already exists' });
      }
      
      // Create user with hashed password
      const user = await storage.createUser({
        username: validatedData.username,
        password: hashPassword(validatedData.password),
        displayName: validatedData.displayName,
        avatar: validatedData.avatar || 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=48&h=48&q=80',
        description: validatedData.description || '',
      });
      
      // Create session
      const token = createSessionToken(user.id);
      sessions[token] = {
        userId: user.id,
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      };
      
      // Return user without password
      const { password, ...userWithoutPassword } = user;
      res.status(201).json({
        ...userWithoutPassword,
        token,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid data', errors: error.errors });
      }
      console.error('Registration error:', error);
      res.status(500).json({ message: 'Failed to register user' });
    }
  });
  
  // Login endpoint
  app.post('/api/login', async (req, res) => {
    try {
      const validatedData = loginSchema.parse(req.body);
      
      // Find user
      const user = await storage.getUserByUsername(validatedData.username);
      if (!user || user.password !== hashPassword(validatedData.password)) {
        return res.status(401).json({ message: 'Invalid username or password' });
      }
      
      // Create session
      const token = createSessionToken(user.id);
      sessions[token] = {
        userId: user.id,
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      };
      
      // Return user without password
      const { password, ...userWithoutPassword } = user;
      res.json({
        ...userWithoutPassword,
        token,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: 'Invalid data', errors: error.errors });
      }
      console.error('Login error:', error);
      res.status(500).json({ message: 'Failed to login' });
    }
  });
  
  // Logout endpoint
  app.post('/api/logout', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      delete sessions[token];
    }
    res.sendStatus(200);
  });
  
  // Get current user
  app.get('/api/user', isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).userId;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      // Return user without password
      const { password, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({ message: 'Failed to get user' });
    }
  });
}
