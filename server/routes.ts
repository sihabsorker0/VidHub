import express, { type Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCommentSchema, insertVideoSchema, insertFeedbackSchema } from "@shared/schema";
import { setupAuth } from "./auth";
import { sessions } from "./auth";
import { advertisements } from '../shared/schema'; //This line is needed

// Import sessions from auth.ts for token-based authentication
function checkAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token || !sessions[token] || sessions[token].expires < new Date()) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  // Add userId to request
  (req as any).userId = sessions[token].userId;
  next();
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup authentication routes
  setupAuth(app);

  // Ad Network Routes
  app.post('/api/advertisements/:id/impression', async (req, res) => {
    try {
      const adId = parseInt(req.params.id);
      const ad = await storage.getAdById(adId);
      console.log('Processing ad impression:', adId);

      if (!ad) {
        return res.status(404).json({ message: 'Advertisement not found' });
      }

      const videoId = req.query.videoId ? parseInt(req.query.videoId as string) : null;
      const userId = req.query.userId ? parseInt(req.query.userId as string) : null;
      
      console.log('Video ID:', videoId, 'User ID:', userId);
      
      // Only process impression once per video
      if (videoId && !isNaN(videoId)) {
        await storage.updateAdStats(adId, 1, 0); // Increment impressions by 1
        
        // Set fixed revenue per view (5 cents) 
        const revenueInCents = 5;
        
        try {
          // Get video and validate
          const video = await storage.getVideo(videoId);
          if (!video) {
            return res.status(404).json({ message: 'Video not found' });
          }

        // Update video revenue and stats immediately with logging
          console.log(`Updating video ${videoId} with revenue: ${revenueInCents} cents`);
          // Only update revenue and impressions once, passing revenueInCents
          await storage.incrementVideoRevenue(videoId, revenueInCents, true);

          if (video.userId) {
            console.log(`Updated revenue for video ${videoId} and user ${video.userId}: ${revenueInCents} cents`);
          }
          console.log(`Updated ad impressions for video ${videoId}`);
          // Remove duplicate user revenue update since it's handled in incrementVideoRevenue

          // Return updated stats
          const updatedVideo = await storage.getVideo(videoId);
          res.json({ 
          success: true,
            video: updatedVideo,
            revenueAdded: revenueInCents / 100, // Convert to dollars
            adImpressions: updatedVideo?.adImpressions || 0
          });
          
          // Log the revenue update
          console.log(`Ad impression for video ${videoId}:`);
          console.log(`- Revenue added: ${revenueInCents} cents`);
          console.log(`- User ID: ${video.userId}`);
          console.log(`- Updated video revenue: ${updatedVideo?.ad_revenue} cents`);
        } catch (error) {
          console.error('Error updating video stats:', error);
          // Still return success since the ad impression was recorded
          res.json({ success: true, message: 'Ad impression recorded but video stats update failed' });
        }
      } else {
        // If no video ID or invalid, just return success for the ad impression
        res.json({ success: true });
      }
    } catch (error) {
      console.error('Error tracking impression:', error);
      res.status(500).json({ message: 'Failed to track impression' });
    }
  });

  app.post('/api/advertisements/:id/click', async (req, res) => {
    try {
      const adId = parseInt(req.params.id);
      const ad = await storage.getAdById(adId);

      if (!ad) {
        return res.status(404).json({ message: 'Advertisement not found' });
      }

      await storage.updateAdStats(adId, 0, 1); // Increment clicks by 1
      res.json({ success: true });
    } catch (error) {
      console.error('Error tracking click:', error);
      res.status(500).json({ message: 'Failed to track click' });
    }
  });

  app.get('/api/advertisements', async (req, res) => {
    try {
      const allAds = await storage.getAds();
      res.json(allAds);
    } catch (error) {
      console.error('Error fetching ads:', error);
      res.status(500).json({
        message: 'Failed to fetch advertisements',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Update ad network settings
  app.post('/api/advertisements/settings', async (req, res) => {
    try {
      const { defaultCpm, minimumBudget, revenuePerView, categories } = req.body;

      // Validate required fields
      if (typeof defaultCpm !== 'number' || typeof minimumBudget !== 'number' || 
          typeof revenuePerView !== 'number' || !Array.isArray(categories)) {
        return res.status(400).json({ message: 'Invalid settings values' });
      }

      // Update all settings
      await storage.updateAdSettings({
        defaultCpm,
        minimumBudget,
        revenuePerView,
        categories
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Error updating settings:', error);
      res.status(500).json({ message: 'Failed to update settings' });
    }
  });

  app.post('/api/advertisements', async (req, res) => {
    try {
      if (!req.body || !req.body.name || !req.body.type) {
        return res.status(400).json({
          message: 'Missing required fields: name and type are required'
        });
      }

      const adData = req.body;
      const newAd = await storage.createAd(adData);
      res.status(201).json(newAd);
    } catch (error) {
      console.error('Error creating ad:', error);
      res.status(500).json({
        message: 'Failed to create advertisement',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get all users
  // Update user location
  app.post('/api/users/location', checkAuth, async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { latitude, longitude } = req.body;

      const user = await storage.getUser(userId);
      const now = new Date();
      
      // Only update if 7 days have passed or no previous update
      if (!user.lastLocationUpdate || 
          (now.getTime() - new Date(user.lastLocationUpdate).getTime()) > 7 * 24 * 60 * 60 * 1000) {
        
        await storage.updateUser(userId, {
          latitude,
          longitude,
          lastLocationUpdate: now
        });

        res.json({ success: true });
      } else {
        res.status(429).json({ 
          message: 'Location can only be updated every 7 days',
          nextUpdate: new Date(new Date(user.lastLocationUpdate).getTime() + 7 * 24 * 60 * 60 * 1000)
        });
      }
    } catch (error) {
      console.error('Error updating location:', error);
      res.status(500).json({ message: 'Failed to update location' });
    }
  });

  app.get('/api/users', checkAuth, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users.map(user => ({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        subscribers: user.subscribers,
        description: user.description,
        createdAt: user.createdAt,
        status: user.status || 'active',
        role: user.role
      })));
    } catch (error) {
      console.error('Error fetching users:', error);
      res.status(500).json({ message: 'Failed to fetch users' });
    }
  });

  // Get all videos
  app.get('/api/videos', async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
      const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string) : undefined;

      const videos = await storage.getVideos(limit, offset, categoryId);

      // Add user data to each video
      const videosWithUser = await Promise.all(videos.map(async (video) => {
        const user = await storage.getUser(video.userId);
        return {
          ...video,
          user: user ? {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatar: user.avatar,
            subscribers: user.subscribers
          } : null
        };
      }));

      res.json(videosWithUser);
    } catch (error) {
      console.error('Error fetching videos:', error);
      res.status(500).json({ message: 'Failed to fetch videos' });
    }
  });

  // Get single video
  // Promote video
  app.post('/api/videos/:id/promote', checkAuth, async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      const userId = (req as any).userId;
      
      // Check if user owns the video
      const video = await storage.getVideo(videoId);
      if (!video || video.userId !== userId) {
        return res.status(403).json({ message: 'Unauthorized' });
      }
      
      // Set promotion pending
      await storage.updateVideo(videoId, { promotionPending: true });
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error promoting video:', error);
      res.status(500).json({ message: 'Failed to promote video' });
    }
  });

  // Archive video
  app.post('/api/videos/:id/archive', checkAuth, async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      const userId = (req as any).userId;
      
      // Check if user owns the video
      const video = await storage.getVideo(videoId);
      if (!video || video.userId !== userId) {
        return res.status(403).json({ message: 'Unauthorized' });
      }
      
      // Toggle archive status
      await storage.updateVideo(videoId, { isArchived: !video.isArchived });
      
      res.json({ success: true });
    } catch (error) {
      console.error('Error archiving video:', error);
      res.status(500).json({ message: 'Failed to archive video' });
    }
  });

  // Delete video (move to trash)
  // Admin video management endpoints
  app.get('/api/videos/admin', checkAuth, async (req, res) => {
    try {
      const userId = (req as any).userId;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: 'Unauthorized' });
      }
      
      const videos = await storage.getAllVideosForAdmin();
      res.json(videos);
    } catch (error) {
      console.error('Error fetching admin videos:', error);
      res.status(500).json({ message: 'Failed to fetch videos' });
    }
  });

  app.post('/api/videos/:id/approve-promotion', checkAuth, async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      const userId = (req as any).userId;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: 'Unauthorized' });
      }
      
      await storage.updateVideo(videoId, { promotionPending: false, isPromoted: true });
      res.json({ success: true });
    } catch (error) {
      console.error('Error approving promotion:', error);
      res.status(500).json({ message: 'Failed to approve promotion' });
    }
  });

  app.post('/api/videos/:id/permanent-delete', checkAuth, async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      const userId = (req as any).userId;
      const user = await storage.getUser(userId);
      
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ message: 'Unauthorized' });
      }
      
      await storage.permanentlyDeleteVideo(videoId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error permanently deleting video:', error);
      res.status(500).json({ message: 'Failed to delete video' });
    }
  });

  app.post('/api/videos/:id/restore', checkAuth, async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      const userId = (req as any).userId;
      const user = await storage.getUser(userId);
      
      // Get the video
      const video = await storage.getVideo(videoId);
      if (!video) {
        return res.status(404).json({ message: 'Video not found' });
      }

      // Check if user owns the video or is admin
      if (video.userId !== userId && (!user || user.role !== 'admin')) {
        return res.status(403).json({ message: 'Unauthorized' });
      }
      
      // Only restore if not permanently deleted
      if (video.permanentlyDeleted) {
        return res.status(400).json({ message: 'Cannot restore permanently deleted video' });
      }

      // Update video
      const updatedVideo = await storage.updateVideo(videoId, { 
        isDeleted: false,
        permanentlyDeleted: false 
      });

      res.json({ success: true, video: updatedVideo });
    } catch (error) {
      console.error('Error restoring video:', error);
      res.status(500).json({ message: 'Failed to restore video' });
    }
  });

  app.post('/api/videos/:id/delete', checkAuth, async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      const userId = (req as any).userId;
      
      // Check if user owns the video
      const video = await storage.getVideo(videoId);
      const user = await storage.getUser(userId);

      // Allow both video owner and admins to delete
      if (!video || (!user?.role && video.userId !== userId)) {
        return res.status(403).json({ message: 'Unauthorized' });
      }
      
      // Move to trash by marking as deleted
      await storage.updateVideo(videoId, { 
        isDeleted: true,
        updatedAt: new Date() 
      });
      
      res.json({ success: true, message: 'Video moved to trash' });
    } catch (error) {
      console.error('Error moving video to trash:', error);
      res.status(500).json({ message: 'Failed to move video to trash' });
    }
  });

  app.post('/api/videos/:id/permanent-delete', checkAuth, async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      const userId = (req as any).userId;
      
      // Check if user owns the video
      const video = await storage.getVideo(videoId);
      const user = await storage.getUser(userId);

      // Allow both video owner and admins to delete
      if (!video || (!user?.role && video.userId !== userId)) {
        return res.status(403).json({ message: 'Unauthorized' });
      }
      
      await storage.permanentlyDeleteVideo(videoId);
      res.json({ success: true, message: 'Video permanently deleted' });
    } catch (error) {
      console.error('Error permanently deleting video:', error);
      res.status(500).json({ message: 'Failed to permanently delete video' });
    }
  });

  // Save video progress
  app.post('/api/videos/:id/progress', checkAuth, async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      const userId = (req as any).userId;
      const { progress } = req.body;

      await storage.saveVideoProgress(userId, videoId, progress);
      res.json({ success: true });
    } catch (error) {
      console.error('Error saving video progress:', error);
      res.status(500).json({ message: 'Failed to save video progress' });
    }
  });

  app.get('/api/videos/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: 'Invalid video ID' });
      }

      // Get saved progress if user is logged in
      const token = req.headers.authorization?.split(' ')[1];
      const userId = token && sessions[token] && sessions[token].expires > new Date()
        ? sessions[token].userId
        : undefined;
      
      let savedProgress = 0;
      if (userId) {
        savedProgress = await storage.getVideoProgress(userId, id);
      }

      // Check if this is a request from a like/dislike action to avoid incrementing views
      const referer = req.headers.referer || '';
      const isFromLikeDislikeAction = req.headers['x-from-action'] === 'true' ||
        referer.includes('/like') || referer.includes('/dislike');

      // Pass userId to getVideo to include like/dislike status if user is logged in
      const video = await storage.getVideo(id, userId);

      if (!video) {
        return res.status(404).json({ message: 'Video not found' });
      }

      // Only increment views if not from a like/dislike action
      if (!isFromLikeDislikeAction) {
        await storage.incrementViews(id);
        // Add to watch history if user is logged in
        if (userId) {
          await storage.addToWatchHistory(userId, id);
        }
      }

      // Get user data
      const user = await storage.getUser(video.userId);

      res.json({
        ...video,
        user: user ? {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar,
          subscribers: user.subscribers,
          description: user.description,
          createdAt: user.createdAt
        } : null
      });
    } catch (error) {
      console.error('Error fetching video:', error);
      res.status(500).json({ message: 'Failed to fetch video' });
    }
  });

  // Create new video
  app.post('/api/videos', async (req, res) => {
    try {
      const validatedData = insertVideoSchema.parse(req.body);
      const video = await storage.createVideo(validatedData);
      res.status(201).json(video);
    } catch (error) {
      console.error('Error creating video:', error);
      res.status(400).json({ message: 'Invalid video data' });
    }
  });

  // Update video
  app.put('/api/videos/:id', checkAuth, async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      const userId = (req as any).userId;
      
      // Check if user owns the video
      const video = await storage.getVideo(videoId);
      if (!video || video.userId !== userId) {
        return res.status(403).json({ message: 'Unauthorized' });
      }

      const updatedVideo = await storage.updateVideo(videoId, req.body);
      res.json(updatedVideo);
    } catch (error) {
      console.error('Error updating video:', error);
      res.status(500).json({ message: 'Failed to update video' });
    }
  });

  // Search videos
  app.get('/api/search', async (req, res) => {
    try {
      const query = req.query.q as string || '';
      const categoryId = req.query.categoryId ? parseInt(req.query.categoryId as string) : undefined;

      if (!query) {
        return res.json([]);
      }

      // Convert query to lowercase and remove extra spaces
      const normalizedQuery = query.toLowerCase().trim();
      
      // Get all videos
      const allVideos = await storage.getVideos(100, 0, categoryId);

      // Helper functions for advanced search
      function similarity(s1: string, s2: string): number {
        if (s1.length < s2.length) [s1, s2] = [s2, s1];
        const distances = Array(s2.length + 1).fill(0);
        for (let i = 0; i <= s2.length; i++) distances[i] = i;
        let old = 0;
        for (let i = 0; i < s1.length; i++) {
          let prev = i + 1;
          for (let j = 0; j < s2.length; j++) {
            const temp = distances[j + 1];
            distances[j + 1] = s1[i] === s2[j] ? old : Math.min(old, prev, distances[j]) + 1;
            old = temp;
          }
          old = prev;
        }
        return 1 - distances[s2.length] / Math.max(s1.length, s2.length);
      }

      function getNGrams(text: string, n: number): string[] {
        const ngrams: string[] = [];
        for (let i = 0; i <= text.length - n; i++) {
          ngrams.push(text.slice(i, i + n));
        }
        return ngrams;
      }

      function getPhoneticCode(text: string): string {
        // Simple implementation of Soundex algorithm
        const firstLetter = text.charAt(0).toUpperCase();
        const phonetic = text.toLowerCase()
          .replace(/[aeiouyhw]/g, '0')
          .replace(/[bfpv]/g, '1')
          .replace(/[cgjkqsxz]/g, '2')
          .replace(/[dt]/g, '3')
          .replace(/[l]/g, '4')
          .replace(/[mn]/g, '5')
          .replace(/[r]/g, '6')
          .replace(/[0]/g, '')
          .replace(/(\d)\1+/g, '$1');
        return firstLetter + phonetic.slice(0, 3).padEnd(3, '0');
      }

      const videos = allVideos.map(video => {
        const title = video.title.toLowerCase();
        const description = (video.description || '').toLowerCase();
        const titleWords = title.split(/\s+/);
        const descWords = description.split(/\s+/);
        const queryWords = normalizedQuery.split(/\s+/);

        let score = 0;

        // Calculate various match scores
        queryWords.forEach(qWord => {
          // Exact matches (highest weight)
          if (title.includes(qWord)) score += 10;
          if (description.includes(qWord)) score += 5;

          // Word-level matches
          titleWords.forEach(word => {
            // Levenshtein similarity
            const simScore = similarity(word, qWord);
            if (simScore > 0.8) score += 8;
            else if (simScore > 0.6) score += 6;

            // Phonetic matching
            if (getPhoneticCode(word) === getPhoneticCode(qWord)) score += 7;

            // N-gram matching
            const wordNGrams = getNGrams(word, 3);
            const queryNGrams = getNGrams(qWord, 3);
            const commonNGrams = wordNGrams.filter(ng => queryNGrams.includes(ng));
            score += commonNGrams.length * 2;

            // Partial matches
            if (word.includes(qWord) || qWord.includes(word)) score += 4;
          });

          // Description matches (lower weight)
          descWords.forEach(word => {
            const simScore = similarity(word, qWord);
            if (simScore > 0.8) score += 4;
            if (getPhoneticCode(word) === getPhoneticCode(qWord)) score += 3;
          });
        });

        // Additional scoring factors
        score += Math.min(video.views / 1000, 10); // Popular content boost
        score += Math.min(video.likes / 100, 5); // Well-liked content boost

        return { ...video, searchScore: score };
      })
      .filter(video => video.searchScore > 0)
      .sort((a, b) => {
        // First sort by search score (relevance)
        const scoreDiff = b.searchScore - a.searchScore;
        if (Math.abs(scoreDiff) > 0.1) return scoreDiff;
        
        // If scores are very close, secondary sort by views/likes
        const popularityA = (a.views || 0) + (a.likes || 0) * 2;
        const popularityB = (b.views || 0) + (b.likes || 0) * 2;
        return popularityB - popularityA;
      });

      // Add user data
      const videosWithUser = await Promise.all(videos.map(async (video) => {
        const user = await storage.getUser(video.userId);
        return {
          ...video,
          user: user ? {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatar: user.avatar,
            subscribers: user.subscribers
          } : null
        };
      }));

      res.json(videosWithUser);
    } catch (error) {
      console.error('Error searching videos:', error);
      res.status(500).json({ message: 'Failed to search videos' });
    }
  });

  // Get user channel videos by ID
  app.get('/api/channels/:userId/videos', async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const videos = await storage.getUserVideos(userId);

      // Get user data
      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Add user data to videos
      const videosWithUser = videos.map(video => ({
        ...video,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar,
          subscribers: user.subscribers
        }
      }));

      res.json({
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar,
          subscribers: user.subscribers,
          description: user.description,
          createdAt: user.createdAt
        },
        videos: videosWithUser
      });
    } catch (error) {
      console.error('Error fetching channel videos:', error);
      res.status(500).json({ message: 'Failed to fetch channel videos' });
    }
  });

  // Get user channel videos by username
  app.get('/api/channels/username/:username/videos', async (req, res) => {
    try {
      const username = req.params.username;

      // Get user data by username
      const user = await storage.getUserByUsername(username);

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Get videos for this user
      const videos = await storage.getUserVideos(user.id);

      // Add user data to videos
      const videosWithUser = videos.map(video => ({
        ...video,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar,
          subscribers: user.subscribers
        }
      }));

      res.json({
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar,
          subscribers: user.subscribers,
          description: user.description,
          createdAt: user.createdAt
        },
        videos: videosWithUser
      });
    } catch (error) {
      console.error('Error fetching channel videos:', error);
      res.status(500).json({ message: 'Failed to fetch channel videos' });
    }
  });

  // Get video comments
  app.get('/api/videos/:id/comments', async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      const comments = await storage.getVideoComments(videoId);

      console.log(`Getting comments for video ID ${videoId}. Found ${comments.length} comments:`, comments);

      // Add user data to comments
      const commentsWithUser = await Promise.all(comments.map(async (comment) => {
        // Explicitly log the userId
        console.log(`Comment ID ${comment.id} has userId ${comment.userId}`);

        // If userId is not defined, use fallback user data
        if (!comment.userId) {
          console.log(`Comment ID ${comment.id} has no userId!`);
          return {
            ...comment,
            user: null
          };
        }

        const user = await storage.getUser(comment.userId);
        console.log(`User data for comment ${comment.id}:`, user);

        return {
          ...comment,
          user: user ? {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatar: user.avatar
          } : null
        };
      }));

      // Organize comments (parents and replies)
      const parentComments = commentsWithUser.filter(c => !c.parentId);
      const replies = commentsWithUser.filter(c => c.parentId);

      // Attach replies to parent comments
      const commentsWithReplies = parentComments.map(parent => {
        const commentReplies = replies.filter(reply => reply.parentId === parent.id);
        return {
          ...parent,
          replies: commentReplies
        };
      });

      console.log('Final comments being sent to client:', commentsWithReplies);
      res.json(commentsWithReplies);
    } catch (error) {
      console.error('Error fetching comments:', error);
      res.status(500).json({ message: 'Failed to fetch comments' });
    }
  });

  // Create comment
  app.post('/api/videos/:id/comments', checkAuth, async (req: Request, res: Response) => {
    try {
      const videoId = parseInt(req.params.id);
      // Get the user ID from the authenticated request
      const userId = (req as any).userId;

      if (!userId) {
        return res.status(401).json({ message: 'You must be logged in to comment' });
      }

      const data = {
        ...req.body,
        videoId,
        userId // Use the authenticated user's ID
      };

      const validatedData = insertCommentSchema.parse(data);
      const comment = await storage.createComment(validatedData);

      // Add user data
      const user = await storage.getUser(userId);

      res.status(201).json({
        ...comment,
        user: user ? {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar
        } : null
      });
    } catch (error) {
      console.error('Error creating comment:', error);
      res.status(400).json({ message: 'Invalid comment data' });
    }
  });

  // Get categories
  app.get('/api/categories', async (req, res) => {
    try {
      const categories = await storage.getCategories();
      res.json(categories);
    } catch (error) {
      console.error('Error fetching categories:', error);
      res.status(500).json({ message: 'Failed to fetch categories' });
    }
  });

  // Get user subscriptions
  app.get('/api/users/:userId/subscriptions', async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const subscriptions = await storage.getUserSubscriptions(userId);
      res.json(subscriptions);
    } catch (error) {
      console.error('Error fetching subscriptions:', error);
      res.status(500).json({ message: 'Failed to fetch subscriptions' });
    }
  });

  // Like video
  app.post('/api/videos/:id/like', checkAuth, async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      const userId = (req as any).userId;

      // Skip view increment for this API call completely - don't rely on headers
      const video = await storage.likeVideo(videoId, userId);

      // Include user data in the response to avoid a separate request
      const user = await storage.getUser(video.userId || 0);

      res.json({
        ...video,
        user: user ? {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar,
          subscribers: user.subscribers,
          description: user.description,
          createdAt: user.createdAt
        } : null
      });
    } catch (error) {
      console.error('Error liking video:', error);
      res.status(500).json({ message: 'Failed to like video' });
    }
  });

  // Dislike video
  app.post('/api/videos/:id/dislike', checkAuth, async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      const userId = (req as any).userId;

      // Skip view increment for this API call completely - don't rely on headers
      const video = await storage.dislikeVideo(videoId, userId);

      // Include user data in the response to avoid a separate request
      const user = await storage.getUser(video.userId || 0);

      res.json({
        ...video,
        user: user ? {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatar: user.avatar,
          subscribers: user.subscribers,
          description: user.description,
          createdAt: user.createdAt
        } : null
      });
    } catch (error) {
      console.error('Error disliking video:', error);
      res.status(500).json({ message: 'Failed to dislike video' });
    }
  });

  // Subscribe to a channel
  app.post('/api/channels/:publisherId/subscribe', checkAuth, async (req, res) => {
    try {
      const publisherId = parseInt(req.params.publisherId);
      const subscriberId = (req as any).userId;

      // Prevent subscribing to own channel
      if (publisherId === subscriberId) {
        return res.status(400).json({ message: 'Cannot subscribe to your own channel' });
      }

      // Check if already subscribed
      const alreadySubscribed = await storage.isSubscribed(subscriberId, publisherId);
      if (alreadySubscribed) {
        return res.status(400).json({ message: 'Already subscribed to this channel' });
      }

      const subscription = await storage.createSubscription({
        subscriberId,
        publisherId
      });

      res.status(201).json(subscription);
    } catch (error) {
      console.error('Error subscribing to channel:', error);
      res.status(500).json({ message: 'Failed to subscribe to channel' });
    }
  });

  // Check if user is subscribed to a channel
  app.get('/api/channels/:publisherId/subscribed', checkAuth, async (req, res) => {
    try {
      const publisherId = parseInt(req.params.publisherId);
      const subscriberId = (req as any).userId;

      const isSubscribed = await storage.isSubscribed(subscriberId, publisherId);
      res.json({ isSubscribed });
    } catch (error) {
      console.error('Error checking subscription:', error);
      res.status(500).json({ message: 'Failed to check subscription' });
    }
  });

  // Save video
  app.post('/api/videos/:id/save', checkAuth, async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      const userId = (req as any).userId;

      const success = await storage.saveVideo(videoId, userId);

      // Get video with updated saved status
      const video = await storage.getVideo(videoId, userId);

      res.json({ success, video });
    } catch (error) {
      console.error('Error saving video:', error);
      res.status(500).json({ message: 'Failed to save video' });
    }
  });

  // Unsave video
  app.post('/api/videos/:id/unsave', checkAuth, async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      const userId = (req as any).userId;

      const success = await storage.unsaveVideo(videoId, userId);

      // Get video with updated saved status
      const video = await storage.getVideo(videoId, userId);

      res.json({ success, video });
    } catch (error) {
      console.error('Error unsaving video:', error);
      res.status(500).json({ message: 'Failed to unsave video' });
    }
  });

  // Get saved videos
  app.get('/api/videos/saved', checkAuth, async (req, res) => {
    try {
      const userId = (req as any).userId;

      const videos = await storage.getSavedVideos(userId);
      res.json(videos);
    } catch (error) {
      console.error('Error fetching saved videos:', error);
      res.status(500).json({ message: 'Failed to fetch saved videos' });
    }
  });

  // Check if a video is saved
  // Get watch history
  app.get('/api/users/me/history', checkAuth, async (req, res) => {
    try {
      const userId = (req as any).userId;
      const videos = await storage.getWatchHistory(userId);
      res.json(videos);
    } catch (error) {
      console.error('Error fetching watch history:', error);
      res.status(500).json({ message: 'Failed to fetch watch history' });
    }
  });

  app.get('/api/videos/:id/saved', checkAuth, async (req, res) => {
    try {
      const videoId = parseInt(req.params.id);
      const userId = (req as any).userId;

      const isSaved = await storage.isSaved(videoId, userId);
      res.json({ isSaved });
    } catch (error) {
      console.error('Error checking if video is saved:', error);
      res.status(500).json({ message: 'Failed to check if video is saved' });
    }
  });
  // Create a new playlist
  app.post('/api/playlists', checkAuth, async (req, res) => {
    try {
      const userId = (req as any).userId;
      const { title, description, isPrivate } = req.body;

      const playlist = await storage.createPlaylist({
        userId,
        title,
        description,
        isPrivate: isPrivate || false
      });

      res.status(201).json(playlist);
    } catch (error) {
      console.error('Error creating playlist:', error);
      res.status(500).json({ message: 'Failed to create playlist' });
    }
  });

  // Add video to playlist
  app.post('/api/playlists/:playlistId/videos', checkAuth, async (req, res) => {
    try {
      const playlistId = parseInt(req.params.playlistId);
      const userId = (req as any).userId;
      const { videoId } = req.body;

      // Verify playlist ownership
      const playlist = await storage.getPlaylistById(playlistId);
      if (!playlist || playlist.userId !== userId) {
        return res.status(403).json({ message: 'Unauthorized' });
      }

      const position = await storage.getNextPlaylistPosition(playlistId);
      const playlistVideo = await storage.addVideoToPlaylist({
        playlistId,
        videoId,
        position
      });

      res.status(201).json(playlistVideo);
    } catch (error) {
      console.error('Error adding video to playlist:', error);
      res.status(500).json({ message: 'Failed to add video to playlist' });
    }
  });

  // Get user's playlists
  app.get('/api/playlists', checkAuth, async (req, res) => {
    try {
      const userId = (req as any).userId;
      const playlists = await storage.getUserPlaylists(userId);
      res.json(playlists);
    } catch (error) {
      console.error('Error fetching playlists:', error);
      res.status(500).json({ message: 'Failed to fetch playlists' });
    }
  });

  // Get playlist videos
  app.get('/api/playlists/:id/videos', checkAuth, async (req, res) => {
    try {
      const playlistId = parseInt(req.params.id);
      const videos = await storage.getPlaylistVideos(playlistId);
      res.json(videos);
    } catch (error) {
      console.error('Error fetching playlist videos:', error);
      res.status(500).json({ message: 'Failed to fetch playlist videos' });
    }
  });

  //Feedback Routes
  app.post('/api/feedback', async (req, res) => {
    try {
      const feedback = await storage.createFeedback(req.body);
      res.status(201).json(feedback);
    } catch (error) {
      console.error('Error creating feedback:', error);
      res.status(500).json({ message: 'Failed to save feedback' });
    }
  });

  app.get('/api/feedback', checkAuth, async (req, res) => {
    try {
      const feedback = await storage.getFeedback();
      res.json(feedback);
    } catch (error) {
      console.error('Error fetching feedback:', error);
      res.status(500).json({ message: 'Failed to fetch feedback' });
    }
  });


  const httpServer = createServer(app);
  return httpServer;
}